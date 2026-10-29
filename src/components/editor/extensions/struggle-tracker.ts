import { loadModelBriefForFolio } from "../../../utils/model-context";
/**
 * The struggle tracker — watches how the writer edits each paragraph, and on
 * a pause offers one tool in the margin when the edits say they are stuck.
 *
 * What it records per paragraph is counters and, in memory only, the last
 * few committed versions.
 * Nothing is sent anywhere while the writer types. On a pause, a paragraph
 * whose signals cross the threshold goes to Jev for a second opinion, then
 * the chosen tool is seeded from the writer's own material and — for Reader
 * Questions — filled by the writer's model as it streams. Compare a revision
 * never opens by itself: a repeated rewrite only leaves a margin tick, and
 * the writer opens the bench on the sentence they choose.
 *
 * One tool at a time. Dismissing one quiets that paragraph for a while.
 */
import { Extension, type Editor } from "@tiptap/core";
import { askJudgement } from "../../../utils/judgement-client";
import { Mark, type Node as PmNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { ConvexClient } from "convex/browser";
import type { ProjectBrief } from "../../../types";
import {
  hasConfiguredAiProvider,
  runClientInFlowTool,
} from "../../../utils/ai-client";
import { researchSelection } from "../../../utils/background-research";
import { loadAiSettingsFromIdb, loadMetaFromIdb } from "../../../utils/idb";
import {
  classify,
  fallbackClassification,
  fillSpec,
  readRevision,
  seedSpec,
  IN_FLOW_EVENT,
  IN_FLOW_OPEN_EVENT,
  IN_FLOW_SETTING_EVENT,
  IN_FLOW_SETTING_KEY,
  type ActiveTool,
  type Ask,
  type Classification,
  type InFlowSnapshot,
} from "../../../utils/in-flow-tools";
import { saveTool, type SavedTool } from "../../../utils/saved-tools";
import {
  commitVersion,
  coolDown,
  emptyActivity,
  readStruggle,
  recordEdit,
  splitSentences,
  STRUGGLE_THRESHOLD,
  type BlockActivity,
  type ToolKind,
} from "../../../utils/struggle-signals";
import {
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "../../../utils/system-one-budget";
import {
  loadWritingToolsNotebook,
  saveWritingToolsNotebook,
} from "../../../utils/writing-tools-storage";
import { checkGrammar, isEnglishLanguage } from "../../../utils/grammar";
import { flowSnapshot } from "./flow-conductor";
import { toolSpec } from "../../in-flow/catalog";
import {
  checkTrial,
  revisionEdits,
  sameBinding,
  sentenceAtSelection,
  type RevisionBinding,
  type RevisionReading,
} from "../../../utils/sentence-bench";
import {
  completeSentence,
  emptySentenceLedger,
  mapSentenceLedger,
  reconcileSentenceLedger,
  settleSentenceWording,
  SENTENCE_SETTLE_MS,
  type LedgerSpan,
} from "../../../utils/sentence-ledger";
import { speak } from "../../../utils/speech";
import {
  buildSpanIndex,
  embeddingThreadPairs,
  proposeThreadPairs,
  spanById,
  type IndexedBlock,
} from "../../../utils/span-index";
import {
  bindThreadInstrument,
  EMPTY_THREAD_SNAPSHOT,
  publishThreadInstrument,
  ruleThreads,
  threadInstrumentSnapshot,
  verifyThreadPairs,
} from "../../../utils/thread-instrument";
import type {
  InstrumentRoomRequest,
  InstrumentRoomResult,
} from "../../../utils/instrument-room";
import {
  instrumentRoomAnchorMatches,
  type InstrumentRoomAnchor,
} from "../../../utils/instrument-source";

const key = new PluginKey<DecorationSet>("inFlowAnchor");

/** Ephemeral underline on the passage a tool is about; never a saved mark. */
export const InFlowAnchor = Extension.create({
  name: "inFlowAnchor",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, previous) =>
            tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

const PAUSE_MS = 1200;
const STALL_CHECK_MS = 42_000;
const MAX_TRACKED = 200;
const QUIET_AFTER_NO_MS = 2 * 60_000;

let snapshot: InFlowSnapshot = { active: null, ticks: [] };
let controller: InFlowController | null = null;

export const inFlowSnapshot = () => snapshot;
export const inFlowController = () => controller;

function publish(next: InFlowSnapshot) {
  snapshot = next;
  window.dispatchEvent(
    new CustomEvent<InFlowSnapshot>(IN_FLOW_EVENT, { detail: next }),
  );
}

export interface InFlowController {
  askRoom(
    request: InstrumentRoomRequest,
    toolId: string,
  ): Promise<InstrumentRoomResult>;
  /** Compare a revision: replace the anchored sentence with the writer's trial in one undo step. */
  applyRevision(trial: string): { ok: true } | { ok: false; message: string };
  /** Compare a revision: ask the configured prose model to read the difference, once. */
  readRevision(
    toolId: string,
    binding: RevisionBinding,
  ): Promise<RevisionReading>;
  /** Close without touching the manuscript and return focus to the sentence. */
  closeRevision(): void;
  previewVariant(text: string | null): void;
  hearVariant(text: string): boolean;
  /** An edited transcript becomes the bench's trial, never an automatic edit. */
  acceptSpokenCandidate(text: string): Promise<boolean>;
  selectSentence(index: number): void;
  highlightSentence(index: number | null): void;
  dismiss(): void;
  keep(name: string, config: SavedTool["config"]): Promise<void>;
  research(claim: string): Promise<string | null>;
  jot(text: string): Promise<boolean>;
  openSaved(tool: SavedTool): void;
  openKind(kind: ToolKind, passage?: string): void;
  focusAnchor(): void;
  /** Rhythm Strip: move the comfortable band; kept if the writer keeps the tool. */
  setRhythmBand(min: number, max: number): void;
  /** Re-run Reader Questions for a different imagined reader. */
  reask(angle: string): void;
  /** Viewport rect of the active tool's passage (its sentence, when it has one). */
  anchorRect(): DOMRect | null;
  /** Viewport top of the paragraph at `pos`, for margin ticks. */
  blockTop(pos: number): number | null;
}

/** Document position of a character offset inside a paragraph's text. */
function posAtOffset(node: PmNode, blockPos: number, offset: number): number {
  let seen = 0;
  let result = blockPos + node.nodeSize - 1;
  let found = false;
  node.forEach((child, childOffset) => {
    if (found) return;
    const length = child.isText ? child.text!.length : 0;
    if (child.isText && offset <= seen + length) {
      result = blockPos + 1 + childOffset + (offset - seen);
      found = true;
      return;
    }
    seen += length;
  });
  return result;
}

function isTrackedBlock(node: PmNode | null | undefined): node is PmNode {
  return !!node && node.type.name === "paragraph";
}

export function startInFlowTools(
  editor: Editor,
  options: {
    getClient: () => ConvexClient | null | undefined;
    isSignedIn?: () => boolean;
    folioId: string;
    brief: ProjectBrief | null;
    openPanel?: (panel: "citations") => void;
    onAskRoom?: (
      request: InstrumentRoomRequest,
      anchor: InstrumentRoomAnchor,
    ) => Promise<InstrumentRoomResult>;
  },
): () => void {
  const { folioId, brief } = options;
  let activities = new Map<number, BlockActivity>();
  let dirty = new Set<number>();
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let enabled = false;
  let stopped = false;
  let running = false;
  let generation = 0;
  let active: ActiveTool | null = null;
  let highlight: number | null = null;
  let preview: string | null = null;
  let previewThread: string | null = null;
  let ledger = emptySentenceLedger();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const lint = (text: string) => {
    const language =
      editor.view.dom.closest("[lang]")?.getAttribute("lang") ?? "en";
    if (!isEnglishLanguage(language))
      return Promise.reject(new Error("Harper supports English only"));
    return checkGrammar(text, language);
  };

  const spansForDoc = (): LedgerSpan[] => {
    const spans: LedgerSpan[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!isTrackedBlock(node)) return true;
      splitSentences(node.textContent).forEach((s) =>
        spans.push({
          text: s.text,
          from: posAtOffset(node, pos, s.from),
          to: posAtOffset(node, pos, s.to),
          blockFrom: pos,
        }),
      );
      return false;
    });
    return spans.slice(0, 2000);
  };
  ledger = reconcileSentenceLedger(ledger, spansForDoc(), Date.now());

  const settleLedger = async () => {
    if (stopped || editor.isDestroyed || editor.view.composing) return;
    const token = generation;
    ledger = reconcileSentenceLedger(ledger, spansForDoc(), Date.now());
    const now = Date.now(),
      cursor = editor.state.selection.head;
    for (const entry of ledger.entries) {
      if (
        entry.retired ||
        !completeSentence(entry.text) ||
        entry.wordings.some((w) => w.text === entry.text)
      )
        continue;
      if (
        cursor >= entry.from &&
        cursor <= entry.to &&
        now - entry.changedAt < SENTENCE_SETTLE_MS
      )
        continue;
      try {
        const issues = await lint(entry.text);
        if (stopped || token !== generation) return;
        ledger = {
          ...ledger,
          entries: ledger.entries.map((e) =>
            e.id === entry.id
              ? settleSentenceWording(
                  e,
                  now,
                  cursor,
                  !issues.some((i) => /spelling/i.test(i.kind)),
                )
              : e,
          ),
        };
      } catch {
        return;
      } // An unchecked fragment must never become an attempt.
    }
    for (const [pos, activity] of activities) {
      const blockEntries = ledger.entries.filter(
        (e) => !e.retired && e.blockFrom === pos,
      );
      const attempts: Record<number, string[]> = {},
        rewrites: Record<number, number> = {};
      blockEntries.forEach((e, i) => {
        attempts[i] = e.wordings
          .filter((w) => w.text !== e.text)
          .map((w) => w.text);
        rewrites[i] = Math.max(0, e.wordings.length - 1);
      });
      activities.set(pos, { ...activity, attempts, rewrites });
    }
    if (enabled && !active && !threadInstrumentSnapshot().open) void evaluate();
  };

  const setActive = (next: ActiveTool | null) => {
    active = next;
    // Often called from inside a transaction listener; never dispatch nested.
    queueMicrotask(drawAnchor);
    publish({ active, ticks: ticks() });
  };

  const ticks = (): number[] => {
    const now = Date.now();
    const out: number[] = [];
    for (const [pos, activity] of activities) {
      if (readStruggle(activity, now).score >= 0.35) out.push(pos);
    }
    return out.slice(0, 40);
  };

  const drawAnchor = () => {
    if (stopped || editor.isDestroyed) return;
    const decorations: Decoration[] = [];
    const threads = threadInstrumentSnapshot();
    if (threads.open && !threads.stale) {
      const pair = threads.threads.find((t) => t.id === previewThread);
      for (const span of pair ? [pair.first, pair.second] : []) {
        if (editor.state.doc.textBetween(span.from, span.to) === span.text)
          decorations.push(
            Decoration.inline(span.from, span.to, {
              class: "twyne-thread-span",
              "data-thread-span": span.id,
              title:
                pair?.state === "confirmed"
                  ? `${pair.relation} · ${pair.model} ${pair.probability?.toFixed(2)}`
                  : (pair?.observation ?? ""),
              style:
                "text-decoration:underline dotted 2px;text-underline-offset:.2em;background:var(--color-highlight-sky)",
            }),
          );
      }
    }
    if (active) {
      const node = editor.state.doc.nodeAt(active.from);
      if (isTrackedBlock(node)) {
        const from = active.sentenceFrom ?? active.from + 1;
        const to = active.sentenceTo ?? active.to - 1;
        if (to > from)
          decorations.push(
            Decoration.inline(from, to, {
              class: "twyne-in-flow-span",
              "data-in-flow-tool": active.kind,
            }),
          );
        if (
          preview &&
          active.spec.elements.tool.type === "SentenceLab" &&
          to > from &&
          editor.state.doc.textBetween(from, to) ===
            active.spec.elements.tool.props.sentence
        ) {
          decorations.push(
            Decoration.inline(from, to, {
              class: "sentence-bench-original",
              style: "text-decoration:line-through;opacity:.65",
            }),
          );
          const text = preview;
          decorations.push(
            Decoration.widget(
              to,
              () => {
                const ghost = document.createElement("span");
                ghost.className = "sentence-bench-ghost";
                ghost.textContent = ` ${text}`;
                ghost.style.cssText =
                  "font-style:italic;color:var(--color-ink);background:var(--color-highlight-mint);border-left:1px dashed var(--color-ink-light);padding-left:.3em";
                ghost.setAttribute("aria-hidden", "true");
                return ghost;
              },
              { side: 1 },
            ),
          );
        }
        if (highlight !== null) {
          const s = splitSentences(node.textContent)[highlight];
          if (s)
            decorations.push(
              Decoration.inline(
                posAtOffset(node, active.from, s.from),
                posAtOffset(node, active.from, s.to),
                { class: "twyne-in-flow-sentence" },
              ),
            );
        }
      }
    }
    editor.view.dispatch(
      editor.state.tr
        .setMeta(key, DecorationSet.create(editor.state.doc, decorations))
        .setMeta("addToHistory", false),
    );
  };

  /* ── Tracking ─────────────────────────────────────────────────── */

  const onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
    if (stopped || !tr.docChanged) return;
    generation++;
    if (threadInstrumentSnapshot().open) {
      publishThreadInstrument({
        ...threadInstrumentSnapshot(),
        stale: true,
        status: "ready",
        notice: "The manuscript changed. Reopen Threads to check these spans.",
      });
      previewThread = null;
    }
    // Programmatic writes (loads, our own decorations, remote mirrors) mark
    // themselves out of history; they are not the writer's effort.
    const undo = isHistoryTransaction(tr);
    const counted = undo || tr.getMeta("addToHistory") !== false;
    const now = Date.now();
    const touchedBefore: Array<{ from: number; to: number }> = [];
    tr.mapping.maps.forEach((map, index) => {
      const inverse = tr.mapping.slice(0, index).invert();
      map.forEach((from, to) =>
        touchedBefore.push({
          from: inverse.map(from, -1),
          to: inverse.map(to, 1),
        }),
      );
    });
    ledger = mapSentenceLedger(
      ledger,
      (pos, assoc) => tr.mapping.map(pos, assoc),
      touchedBefore,
      now,
    );
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void settleLedger(), SENTENCE_SETTLE_MS);
    preview = null;

    const remapped = new Map<number, BlockActivity>();
    for (const [pos, activity] of activities) {
      const mapped = tr.mapping.mapResult(pos, 1);
      if (!mapped.deleted && isTrackedBlock(tr.doc.nodeAt(mapped.pos)))
        remapped.set(mapped.pos, activity);
    }
    activities = remapped;
    dirty = new Set(
      [...dirty]
        .map((pos) => tr.mapping.map(pos, 1))
        .filter((pos) => activities.has(pos)),
    );

    if (active) {
      const from = tr.mapping.mapResult(active.from, 1);
      if (from.deleted || !isTrackedBlock(tr.doc.nodeAt(from.pos))) {
        setActive(null);
      } else {
        const node = tr.doc.nodeAt(from.pos)!;
        active = {
          ...active,
          from: from.pos,
          to: from.pos + node.nodeSize,
          sentenceFrom:
            active.sentenceFrom === undefined
              ? undefined
              : tr.mapping.map(active.sentenceFrom, -1),
          sentenceTo:
            active.sentenceTo === undefined
              ? undefined
              : tr.mapping.map(active.sentenceTo, 1),
        };
        if (active.spec.elements.tool.type === "SentenceLab") {
          const element = active.spec.elements.tool;
          const currentText =
            active.sentenceFrom === undefined || active.sentenceTo === undefined
              ? ""
              : tr.doc.textBetween(active.sentenceFrom, active.sentenceTo);
          active = {
            ...active,
            spec: toolSpec({
              ...element,
              props: {
                ...element.props,
                stale:
                  currentText !== element.props.sentence ||
                  (!!element.props.context &&
                    node.textContent !== element.props.context.paragraph),
              },
            }),
          };
        }
        clearTimeout(publishTimer);
        publishTimer = setTimeout(() => {
          // Rhythm is arithmetic on the writer's own sentences: keep it live.
          if (active?.kind === "rhythm-strip") {
            const element = active.spec.elements.tool;
            const block = editor.state.doc.nodeAt(active.from);
            if (element.type === "RhythmStrip" && isTrackedBlock(block)) {
              active = {
                ...active,
                spec: seedSpec("rhythm-strip", block.textContent, {
                  config: {
                    targetMin: element.props.targetMin,
                    targetMax: element.props.targetMax,
                  },
                }),
              };
            }
          }
          publish({ active, ticks: ticks() });
        }, 120);
      }
    }

    if (!counted) return;

    const touched = new Set<number>();
    tr.mapping.maps.forEach((map, i) => {
      const rest = tr.mapping.slice(i + 1);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        const from = rest.map(newStart, -1);
        const to = Math.min(rest.map(newEnd, 1), tr.doc.content.size);
        tr.doc.nodesBetween(from, Math.max(from, to), (node, pos) => {
          if (isTrackedBlock(node)) {
            touched.add(pos);
            return false;
          }
          return true;
        });
      });
    });

    const inverse = tr.mapping.invert();
    for (const pos of touched) {
      const node = tr.doc.nodeAt(pos);
      if (!isTrackedBlock(node)) continue;
      let activity = activities.get(pos);
      if (!activity) {
        const before = tr.before.nodeAt(inverse.map(pos, 1));
        activity = emptyActivity(
          isTrackedBlock(before) ? before.textContent : "",
          now,
        );
      }
      activities.set(
        pos,
        recordEdit(activity, node.textContent, now, { undo }),
      );
      dirty.add(pos);
    }
    if (activities.size > MAX_TRACKED) {
      const oldest = [...activities.entries()]
        .sort((a, b) => a[1].lastEditAt - b[1].lastEditAt)
        .slice(0, activities.size - MAX_TRACKED);
      for (const [pos] of oldest) activities.delete(pos);
    }

    clearTimeout(pauseTimer);
    clearTimeout(stallTimer);
    if (enabled) {
      pauseTimer = setTimeout(() => void evaluate(), PAUSE_MS);
      stallTimer = setTimeout(() => void evaluate(), STALL_CHECK_MS);
    }
  };

  /* ── Evaluation on a pause ────────────────────────────────────── */

  const cursorBlock = (): {
    pos: number;
    node: PmNode;
    atEnd: boolean;
  } | null => {
    const $head = editor.state.selection.$head;
    if ($head.depth < 1 || !isTrackedBlock($head.parent)) return null;
    const pos = $head.before();
    return {
      pos,
      node: $head.parent,
      atEnd: $head.parentOffset >= $head.parent.content.size - 1,
    };
  };

  const ask: Ask = async (input) => {
    const client = options.getClient();
    const wait = systemOneWait();
    if (wait > 0) throw new Error("budget");
    spendSystemOne();
    try {
      // The action takes string values only; lists travel as JSON.
      const state = Object.fromEntries(
        Object.entries(input.state).map(([name, value]) => [
          name,
          typeof value === "string" ? value : JSON.stringify(value),
        ]),
      );
      const modelBrief = await loadModelBriefForFolio(folioId, brief);
      return (await askJudgement(client, {
        state: {
          ...state,
          goal: modelBrief?.answers.goal ?? "",
          audience: modelBrief?.answers.audience ?? "",
          dossier: JSON.stringify(modelBrief?.answers ?? {}),
        },
        questions: input.questions,
      })) as Awaited<ReturnType<Ask>>;
    } catch (error) {
      backOffSystemOne();
      throw error;
    }
  };

  const conductorHoldsPage = () => {
    const flow = flowSnapshot();
    return flow.enabled && (flow.mode === "flow" || flow.mode === "settling");
  };

  const evaluate = async () => {
    if (stopped || !enabled || running || editor.isDestroyed) return;
    if (!editor.isEditable || document.hidden) return;
    if (editor.view.composing) {
      pauseTimer = setTimeout(() => void evaluate(), 400);
      return;
    }
    for (const pos of dirty) {
      const activity = activities.get(pos);
      if (activity) {
        // Paragraph counters still settle here; attempts come only from the checked ledger.
        const committed = commitVersion(activity);
        activities.set(pos, {
          ...committed,
          attempts: activity.attempts,
          rewrites: activity.rewrites,
        });
      }
    }
    dirty.clear();
    publish({ active, ticks: ticks() });
    if (active || threadInstrumentSnapshot().open) return;
    // The conductor has decided the page should be left alone.
    if (conductorHoldsPage()) return;

    const block = cursorBlock();
    if (!block) return;
    const activity = activities.get(block.pos);
    if (!activity) return;
    const now = Date.now();
    const reading = readStruggle(activity, now, { cursorAtEnd: block.atEnd });
    if (reading.score < STRUGGLE_THRESHOLD) return;

    const token = generation;
    running = true;
    let classification: Classification;
    try {
      classification = await classify(
        {
          passage: block.node.textContent,
          versions: activity.versions,
          reading,
          goal: brief?.answers.goal ?? "",
          audience: brief?.answers.audience ?? "",
        },
        ask,
      );
    } catch {
      classification = fallbackClassification(reading);
    } finally {
      running = false;
    }
    if (stopped || token !== generation || active) return;
    const current = activities.get(block.pos);
    if (!current) return;
    // A struggle signal never opens Compare a revision; the tick stays.
    if (!classification.kind || classification.kind === "sentence-lab") {
      activities.set(
        block.pos,
        coolDown(current, Date.now(), QUIET_AFTER_NO_MS),
      );
      return;
    }
    const hint = reading.hints.find((h) => h.kind === classification.kind);
    open(classification.kind, block.pos, {
      activity: current,
      classification,
      sentenceIndex: reading.sentenceIndex,
      reason: hint?.reason ?? "This looked like a good moment for it.",
      tentative: classification.tentative,
      auto: true,
    });
  };

  /* ── Opening and filling a tool ───────────────────────────────── */

  const open = (
    kind: ToolKind,
    blockPos: number,
    opts: {
      activity?: BlockActivity | null;
      classification?: Classification;
      sentenceIndex?: number;
      reason: string;
      tentative?: boolean;
      saved?: SavedTool;
      /** Compare a revision: why no single sentence could be named. */
      refusal?: string;
      /** Compare a revision: a trial handed in, e.g. an edited transcript. */
      trial?: string;
      /** The tracker opened this by itself; the writer did not ask. */
      auto?: boolean;
    },
  ) => {
    const node = editor.state.doc.nodeAt(blockPos);
    if (!isTrackedBlock(node)) return;
    const passage = node.textContent;
    if (!passage.trim()) return;
    if (threadInstrumentSnapshot().open) {
      publishThreadInstrument(EMPTY_THREAD_SNAPSHOT);
      previewThread = null;
    }
    let spec = seedSpec(kind, passage, {
      activity: opts.activity,
      sentenceIndex: opts.sentenceIndex,
      classification: opts.classification,
      config: opts.saved?.config,
    });
    let sentenceFrom: number | undefined;
    let sentenceTo: number | undefined;
    const element = spec.elements.tool;
    if (element.type === "SentenceLab") {
      // The source was named by position before we got here; never by text.
      const span =
        opts.sentenceIndex === undefined
          ? undefined
          : splitSentences(passage)[opts.sentenceIndex];
      if (span && !opts.refusal) {
        sentenceFrom = posAtOffset(node, blockPos, span.from);
        sentenceTo = posAtOffset(node, blockPos, span.to);
        ledger = reconcileSentenceLedger(ledger, spansForDoc(), Date.now());
        const entry = ledger.entries.find(
          (e) => !e.retired && e.from === sentenceFrom && e.to === sentenceTo,
        );
        spec = toolSpec({
          ...element,
          props: {
            ...element.props,
            sentenceId: entry?.id,
            stale: false,
            ...(opts.trial ? { trial: opts.trial.slice(0, 1200) } : {}),
          },
        });
      } else {
        spec = toolSpec({
          ...element,
          props: {
            sentence: element.props.sentence,
            refusal:
              opts.refusal ??
              element.props.refusal ??
              "Put the cursor in a sentence, or select one sentence.",
          },
        });
      }
    } else if (element.type === "ClaimCheck") {
      const target = element.props.claim;
      const sentences = splitSentences(passage);
      const span =
        opts.sentenceIndex !== undefined &&
        sentences[opts.sentenceIndex]?.text === target
          ? sentences[opts.sentenceIndex]
          : sentences.find((s) => s.text === target);
      if (span) {
        sentenceFrom = posAtOffset(node, blockPos, span.from);
        sentenceTo = posAtOffset(node, blockPos, span.to);
      }
    }
    const tool: ActiveTool = {
      id: `${kind}-${Date.now().toString(36)}`,
      kind,
      from: blockPos,
      to: blockPos + node.nodeSize,
      sentenceFrom,
      sentenceTo,
      reason: opts.reason,
      spec,
      status: "filling",
      tentative: opts.tentative ?? false,
      savedId: opts.saved?.id,
      requested: !opts.auto,
    };
    highlight = null;
    preview = null;
    setActive(tool);
    void fill(tool, passage, blockPos);
  };

  const fill = async (tool: ActiveTool, passage: string, blockPos: number) => {
    // Compare a revision makes no request on open; the writer asks, or not.
    if (tool.spec.elements.tool.type === "SentenceLab") {
      if (active?.id === tool.id) setActive({ ...active, status: "ready" });
      return;
    }
    const [settings, modelBrief] = await Promise.all([
      loadAiSettingsFromIdb(),
      loadModelBriefForFolio(folioId, brief),
    ]);
    if (stopped || editor.isDestroyed || active?.id !== tool.id) return;
    const generate =
      settings && hasConfiguredAiProvider(settings)
        ? (request: Parameters<typeof runClientInFlowTool>[0]) =>
            runClientInFlowTool(request, settings)
        : null;
    const stillThis = () => !stopped && active?.id === tool.id;
    const result = await fillSpec(
      tool.spec,
      {
        passage,
        preceding: editor.state.doc.textBetween(
          Math.max(0, blockPos - 3000),
          Math.min(blockPos, editor.state.doc.content.size),
          "\n",
        ),
        goal: [modelBrief?.answers.goal, modelBrief?.answers.constraints]
          .filter(Boolean)
          .join("\n"),
        audience: modelBrief?.answers.audience ?? "",
      },
      generate,
      (spec) => {
        if (stillThis()) setActive({ ...active!, spec });
      },
    );
    if (stillThis())
      setActive({
        ...active!,
        spec: result.spec,
        status: "ready",
        notice: result.notice,
      });
  };

  /**
   * Compare a revision opens on exactly one sentence, named by the live
   * selection or cursor. A passage handed in from elsewhere must occur once;
   * duplicates and multi-sentence selections are refused, never narrowed.
   */
  const openRevision = (passage?: string) => {
    const squash = (t: string) => t.replace(/\s+/g, " ").trim();
    const wanted = passage ? squash(passage) : "";
    const { from, to, $from, $to } = editor.state.selection;
    let target: { pos: number; from: number; to: number } | null = null;
    let refusal: string | undefined;
    let searched = false;
    const inBlock =
      isTrackedBlock($from.parent) && $from.depth >= 1 && $from.sameParent($to);
    const selected = squash(editor.state.doc.textBetween(from, to, " "));
    if (
      $from.depth >= 1 &&
      isTrackedBlock($from.parent) &&
      !$from.sameParent($to) &&
      (!wanted || selected === wanted)
    )
      refusal =
        "The selection crosses paragraphs. Select one sentence to compare a revision.";
    else if (
      inBlock &&
      (!wanted || selected === wanted || (from === to && !wanted))
    ) {
      const pos = $from.before();
      target = {
        pos,
        from: editor.state.doc.textBetween(pos + 1, from).length,
        to: editor.state.doc.textBetween(pos + 1, to).length,
      };
    } else if (wanted) {
      const hits: Array<{ pos: number; from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (!isTrackedBlock(node)) return true;
        const text = node.textContent;
        for (
          let i = text.indexOf(passage!.trim());
          i >= 0 && hits.length < 3;
          i = text.indexOf(passage!.trim(), i + 1)
        )
          hits.push({ pos, from: i, to: i + passage!.trim().length });
        return false;
      });
      if (hits.length === 1) {
        target = hits[0];
        searched = true;
      } else
        refusal = hits.length
          ? "That text appears more than once. Select the sentence you mean in the manuscript, then open Compare a revision."
          : "That text is no longer in the manuscript. Select a sentence and try again.";
    } else refusal = "Put the cursor in a sentence, or select one sentence.";
    let sentenceIndex: number | undefined;
    if (target) {
      const node = editor.state.doc.nodeAt(target.pos)!;
      const named = sentenceAtSelection(
        node.textContent,
        target.from,
        target.to,
      );
      if (named.ok) sentenceIndex = named.index;
      else
        refusal = searched
          ? "That passage has more than one sentence. Put the cursor in the sentence you want, then open Compare a revision."
          : named.message;
    }
    const pos =
      target?.pos ??
      cursorBlock()?.pos ??
      (() => {
        let first: number | null = null;
        editor.state.doc.descendants((node, p) => {
          if (first === null && isTrackedBlock(node) && node.textContent.trim())
            first = p;
          return first === null;
        });
        return first;
      })();
    if (pos === null) return;
    open("sentence-lab", pos, {
      activity: activities.get(pos),
      reason: refusal ? "Choose one sentence." : "The sentence you chose.",
      sentenceIndex,
      refusal,
    });
    // Collapse the selection onto the source so the selection toolbar steps
    // aside; the bench owns focus until it closes.
    const sentenceEnd = active?.sentenceTo;
    if (!refusal && sentenceEnd !== undefined)
      editor.view.dispatch(
        editor.state.tr
          .setSelection(TextSelection.create(editor.state.doc, sentenceEnd))
          .setMeta("addToHistory", false),
      );
  };

  /** Back to the page after the bench closes; layout-free hosts cannot scroll. */
  const returnFocus = () => {
    if (editor.isDestroyed) return;
    editor.view.focus();
    try {
      editor.commands.scrollIntoView();
    } catch {
      /* No layout to scroll in (tests, a detached view). */
    }
  };

  /* ── Controller ───────────────────────────────────────────────── */

  const quiet = (pos: number) => {
    const activity = activities.get(pos);
    if (activity) activities.set(pos, coolDown(activity, Date.now()));
  };

  controller = {
    async askRoom(request, toolId) {
      const element = active?.spec.elements.tool;
      if (
        stopped ||
        !active ||
        active.id !== toolId ||
        editor.isDestroyed ||
        !editor.isEditable ||
        element?.type !== "SentenceLab" ||
        element.props.stale ||
        active.sentenceFrom === undefined ||
        active.sentenceTo === undefined
      )
        return {
          ok: false,
          message:
            "That sentence changed. Reopen the bench before inviting an editor.",
        };
      const anchor: InstrumentRoomAnchor = {
        folioId,
        from: active.sentenceFrom,
        to: active.sentenceTo,
        text: element.props.sentence,
      };
      if (!instrumentRoomAnchorMatches(editor.state.doc, folioId, anchor))
        return {
          ok: false,
          message:
            "That sentence changed. Reopen the bench before inviting an editor.",
        };
      const result = (await options.onAskRoom?.(request, anchor)) ?? {
        ok: false,
        message: "The manuscript is not available for this conversation.",
      };
      if (result.ok && active?.id === toolId) setActive(null);
      return result;
    },
    applyRevision(trial) {
      const refuse = (message: string) => {
        if (active) setActive({ ...active, notice: message });
        return { ok: false as const, message };
      };
      if (!active || stopped || editor.isDestroyed || !editor.isEditable)
        return refuse("The manuscript is not editable right now.");
      const element = active.spec.elements.tool;
      if (element.type !== "SentenceLab" || element.props.refusal)
        return refuse("This bench has no source sentence to replace.");
      const checked = checkTrial(trial);
      if (!checked.ok) return { ok: false, message: checked.message };
      const from = active.sentenceFrom,
        to = active.sentenceTo;
      const block = editor.state.doc.nodeAt(active.from);
      if (
        element.props.stale ||
        from === undefined ||
        to === undefined ||
        !isTrackedBlock(block) ||
        editor.state.doc.textBetween(from, to) !== element.props.sentence ||
        (element.props.context &&
          block.textContent !== element.props.context.paragraph)
      )
        return refuse(
          "The sentence or its paragraph changed since the bench opened. Your revision is kept here; copy it or reopen the bench.",
        );
      const original = element.props.sentence;
      if (checked.text === original)
        return { ok: false, message: "The revision matches the original." };
      // Map each character of the source to its document position. Inline
      // nodes (citations, notes, formulae) carry no text, so they sit between
      // characters and are found by position, not by matching.
      const charPos: number[] = [];
      const charMarks: (readonly Mark[])[] = [];
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return true;
        const start = Math.max(from, pos),
          end = Math.min(to, pos + node.nodeSize);
        for (let p = start; p < end; p++) {
          charPos.push(p);
          charMarks.push(node.marks);
        }
        return false;
      });
      if (charPos.length !== original.length)
        return refuse(
          "This sentence holds structure the bench cannot map safely. Copy the revision and make the change in the manuscript.",
        );
      const edits = revisionEdits(original, checked.text);
      const tr = closeHistory(editor.state.tr);
      for (const edit of [...edits].reverse()) {
        const start = edit.from < charPos.length ? charPos[edit.from] : to;
        const end = edit.to > edit.from ? charPos[edit.to - 1] + 1 : start;
        let inline = false;
        if (end > start)
          editor.state.doc.nodesBetween(start, end, (node, pos) => {
            if (
              !node.isText &&
              node.isInline &&
              pos >= start &&
              pos + node.nodeSize <= end
            )
              inline = true;
            return !inline;
          });
        if (inline)
          return refuse(
            "The revision removes text around a citation, note or other inline element. Make that change in the manuscript so the element is kept, or copy the revision.",
          );
        const marks = charMarks.slice(edit.from, edit.to);
        if (edit.insert && marks.some((set) => !Mark.sameSet(set, marks[0])))
          return refuse(
            "Part of the changed text has different formatting, such as bold or a link. Make that change in the manuscript so the formatting stays where you want it, or copy the revision.",
          );
        if (edit.insert) tr.insertText(edit.insert, start, end);
        else tr.delete(start, end);
      }
      const caret = tr.mapping.map(to, 1);
      const pos = active.from;
      editor.view.dispatch(
        tr
          .setSelection(TextSelection.create(tr.doc, caret))
          .setMeta("twyne:sentence-instrument", {
            action: "rewrite",
            sentenceId: element.props.sentenceId,
            source: "yours",
          }),
      );
      quiet(pos);
      preview = null;
      setActive(null);
      returnFocus();
      return { ok: true };
    },
    async readRevision(toolId, binding) {
      const matches = () => {
        const element = active?.spec.elements.tool;
        if (
          stopped ||
          !active ||
          active.id !== toolId ||
          element?.type !== "SentenceLab" ||
          element.props.stale ||
          element.props.refusal ||
          !element.props.context
        )
          return false;
        return sameBinding(binding, {
          original: element.props.sentence,
          trial: binding.trial,
          before: element.props.context.before,
          after: element.props.context.after,
        });
      };
      const stale: RevisionReading = {
        ok: false,
        reason: "stale",
        message:
          "The sentence changed while the bench was open. Reopen it to read the difference.",
      };
      if (!matches()) return stale;
      const [settings, modelBrief] = await Promise.all([
        loadAiSettingsFromIdb(),
        loadModelBriefForFolio(folioId, brief),
      ]);
      if (!matches()) return stale;
      const generate =
        settings && hasConfiguredAiProvider(settings)
          ? (request: Parameters<typeof runClientInFlowTool>[0]) =>
              runClientInFlowTool(request, settings)
          : null;
      const result = await readRevision(
        binding,
        {
          goal: [modelBrief?.answers.goal, modelBrief?.answers.constraints]
            .filter(Boolean)
            .join("\n"),
          audience: modelBrief?.answers.audience ?? "",
        },
        generate,
      );
      return matches() ? result : stale;
    },
    closeRevision() {
      if (!active) return;
      const caret = active.sentenceTo ?? active.from + 1;
      quiet(active.from);
      highlight = null;
      preview = null;
      setActive(null);
      if (editor.isDestroyed) return;
      editor.view.dispatch(
        editor.state.tr
          .setSelection(
            TextSelection.create(
              editor.state.doc,
              Math.min(caret, editor.state.doc.content.size),
            ),
          )
          .setMeta("addToHistory", false),
      );
      returnFocus();
    },
    previewVariant(text) {
      preview = text && checkTrial(text).ok ? text.trim() : null;
      queueMicrotask(drawAnchor);
    },
    hearVariant(text) {
      if (!active || stopped || editor.isDestroyed || !text.trim())
        return false;
      const element = active.spec.elements.tool;
      if (element.type !== "SentenceLab") return false;
      const before =
        splitSentences(element.props.context?.before ?? "").at(-1)?.text ?? "";
      const after =
        splitSentences(element.props.context?.after ?? "")[0]?.text ?? "";
      void speak({
        id: `sentence-bench-${active.id}`,
        text: [before, text, after].filter(Boolean).join(" "),
        label: "Sentence bench",
        client: options.getClient(),
        signedIn: options.isSignedIn?.() ?? false,
      });
      return true;
    },
    async acceptSpokenCandidate(text) {
      const element = active?.spec.elements.tool;
      if (
        !active ||
        element?.type !== "SentenceLab" ||
        element.props.stale ||
        element.props.refusal ||
        !checkTrial(text).ok
      )
        return false;
      setActive({
        ...active,
        spec: toolSpec({
          ...element,
          props: { ...element.props, trial: text.trim() },
        }),
        notice:
          "Your edited transcript is the revision. Compare it before use.",
      });
      return true;
    },
    selectSentence(index) {
      if (!active) return;
      const node = editor.state.doc.nodeAt(active.from);
      if (!isTrackedBlock(node)) return;
      const s = splitSentences(node.textContent)[index];
      if (!s) return;
      editor
        .chain()
        .focus()
        .setTextSelection({
          from: posAtOffset(node, active.from, s.from),
          to: posAtOffset(node, active.from, s.to),
        })
        .scrollIntoView()
        .run();
    },
    highlightSentence(index) {
      highlight = index;
      queueMicrotask(drawAnchor);
    },
    dismiss() {
      if (active) quiet(active.from);
      highlight = null;
      preview = null;
      setActive(null);
    },
    async keep(name, config) {
      if (!active) return;
      const saved = await saveTool({ kind: active.kind, name, config });
      if (active)
        setActive({
          ...active,
          savedId: saved.id,
          notice: "Saved to your tools.",
        });
    },
    async research(claim) {
      options.openPanel?.("citations");
      const result = await researchSelection({ anchor: claim, folioId });
      return result.ok
        ? null
        : (result.message ?? "The Apparatus could not start.");
    },
    async jot(text) {
      try {
        const notebook = await loadWritingToolsNotebook(folioId);
        notebook.scraps = [
          ...notebook.scraps,
          { id: `scrap-${Date.now().toString(36)}`, text },
        ];
        await saveWritingToolsNotebook(folioId, notebook);
        return true;
      } catch {
        return false;
      }
    },
    openSaved(tool) {
      if (tool.kind === "sentence-lab") {
        openRevision();
        return;
      }
      const block = cursorBlock();
      if (!block) return;
      open(tool.kind, block.pos, {
        activity: activities.get(block.pos),
        reason: `From Saved tools: ${tool.name}.`,
        saved: tool,
      });
    },
    openKind(kind, passage) {
      if (kind === "sentence-lab") {
        openRevision(passage);
        return;
      }
      let pos: number | null = null;
      const needle = passage?.trim().slice(0, 120);
      const cursor = cursorBlock();
      if (cursor && (!needle || cursor.node.textContent.includes(needle)))
        pos = cursor.pos;
      if (needle && pos === null) {
        editor.state.doc.descendants((node, nodePos) => {
          if (pos !== null) return false;
          if (isTrackedBlock(node) && node.textContent.includes(needle)) {
            pos = nodePos;
            return false;
          }
          return true;
        });
      }
      pos ??= cursorBlock()?.pos ?? null;
      if (pos === null) {
        // No cursor in a paragraph: the longest paragraph is the best guess.
        let longest = -1;
        editor.state.doc.descendants((node, nodePos) => {
          if (isTrackedBlock(node) && node.textContent.length > longest) {
            longest = node.textContent.length;
            pos = nodePos;
          }
          return !isTrackedBlock(node);
        });
      }
      if (pos === null) return;
      open(kind, pos, {
        activity: activities.get(pos),
        reason: "Opened for this passage.",
        sentenceIndex: (() => {
          const node = editor.state.doc.nodeAt(pos!);
          if (!isTrackedBlock(node)) return undefined;
          const sentences = splitSentences(node.textContent);
          const head = editor.state.selection.head;
          const at = sentences.findIndex(
            (s) =>
              head >= posAtOffset(node, pos!, s.from) &&
              head <= posAtOffset(node, pos!, s.to),
          );
          return at < 0 ? undefined : at;
        })(),
      });
      editor
        .chain()
        .setTextSelection(pos + 1)
        .scrollIntoView()
        .run();
    },
    setRhythmBand(min, max) {
      if (!active || active.kind !== "rhythm-strip") return;
      const block = editor.state.doc.nodeAt(active.from);
      if (!isTrackedBlock(block)) return;
      const targetMin = Math.max(1, Math.min(80, Math.round(min)));
      setActive({
        ...active,
        spec: seedSpec("rhythm-strip", block.textContent, {
          config: {
            targetMin,
            targetMax: Math.max(targetMin + 1, Math.min(120, Math.round(max))),
          },
        }),
      });
    },
    reask(angle) {
      if (!active || active.kind !== "reader-questions") return;
      const pos = active.from;
      open("reader-questions", pos, {
        activity: activities.get(pos),
        reason: active.reason,
        saved: {
          id: active.savedId ?? "",
          kind: "reader-questions",
          name: "",
          config: { angle: angle.trim().slice(0, 200) },
          savedAt: 0,
        },
      });
    },
    anchorRect() {
      if (!active || editor.isDestroyed) return null;
      try {
        const from = active.sentenceFrom ?? active.from + 1;
        const start = editor.view.coordsAtPos(from);
        const dom = editor.view.nodeDOM(active.from);
        const block =
          dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
        return new DOMRect(
          block?.left ?? start.left,
          start.top,
          block?.width ?? 0,
          Math.max(0, (block?.bottom ?? start.bottom) - start.top),
        );
      } catch {
        return null;
      }
    },
    blockTop(pos) {
      if (editor.isDestroyed) return null;
      const dom = editor.view.nodeDOM(pos);
      return dom instanceof HTMLElement
        ? dom.getBoundingClientRect().top
        : null;
    },
    focusAnchor() {
      if (!active) return;
      editor
        .chain()
        .focus()
        .setTextSelection(active.sentenceFrom ?? active.from + 1)
        .scrollIntoView()
        .run();
    },
  };

  const threadIndex = () => {
    const blocks: IndexedBlock[] = [];
    let sectionId = "section-1",
      section = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        sectionId = `section-${++section}`;
        return false;
      }
      if (!isTrackedBlock(node)) return true;
      blocks.push({
        text: node.textContent,
        from: pos,
        sectionId,
        positionAt: (offset) => posAtOffset(node, pos, offset),
      });
      return false;
    });
    ledger = reconcileSentenceLedger(ledger, spansForDoc(), Date.now());
    return buildSpanIndex(blocks, ledger.entries);
  };
  bindThreadInstrument({
    async askRoom(request, threadId, fingerprint) {
      const current = threadInstrumentSnapshot();
      const thread = current.threads.find((item) => item.id === threadId);
      if (
        stopped ||
        editor.isDestroyed ||
        !editor.isEditable ||
        !current.open ||
        current.stale ||
        current.index.fingerprint !== fingerprint ||
        !thread
      )
        return {
          ok: false,
          message:
            "These passages changed. Reopen Threads before inviting an editor.",
        };
      const anchor: InstrumentRoomAnchor = {
        folioId,
        from: thread.first.from,
        to: thread.first.to,
        text: thread.first.text,
        related: [
          {
            from: thread.second.from,
            to: thread.second.to,
            text: thread.second.text,
          },
        ],
      };
      if (!instrumentRoomAnchorMatches(editor.state.doc, folioId, anchor))
        return {
          ok: false,
          message:
            "These passages changed. Reopen Threads before inviting an editor.",
        };
      const result = (await options.onAskRoom?.(request, anchor)) ?? {
        ok: false,
        message: "The manuscript is not available for this conversation.",
      };
      if (
        result.ok &&
        threadInstrumentSnapshot().index.fingerprint === fingerprint
      ) {
        previewThread = null;
        publishThreadInstrument(EMPTY_THREAD_SNAPSHOT);
      }
      return result;
    },
    async suggestWithEmbeddings() {
      const initial = threadInstrumentSnapshot();
      const focus = initial.focusId && spanById(initial.index, initial.focusId);
      if (
        !initial.open ||
        initial.stale ||
        !focus ||
        focus.text.length > 2000 ||
        initial.status === "reading"
      )
        return false;
      const token = generation;
      const fresh = () =>
        !stopped &&
        token === generation &&
        threadInstrumentSnapshot().open &&
        !threadInstrumentSnapshot().stale &&
        threadInstrumentSnapshot().index.fingerprint ===
          initial.index.fingerprint;
      try {
        const { localWritingStatus, embedWritingPassages } = await import(
          "../../../utils/local-writing-models"
        );
        if (
          (await localWritingStatus("embeddings")).phase !== "ready" ||
          !fresh()
        )
          return false;
        const { LOCAL_WRITING_PACKS } = await import(
          "../../../utils/local-writing-manifest"
        );
        const spans = [
          focus,
          ...initial.index.spans
            .filter(
              (s) =>
                s.id !== focus.id &&
                s.sectionId === focus.sectionId &&
                s.text.length <= 2000,
            )
            .sort(
              (a, b) =>
                Math.abs(a.ordinal - focus.ordinal) -
                Math.abs(b.ordinal - focus.ordinal),
            )
            .slice(0, 31),
        ];
        if (spans.length < 2) return false;
        publishThreadInstrument({
          ...initial,
          status: "reading",
          notice:
            "Comparing up to 32 complete sentences on this device. Similarity does not establish a relation.",
        });
        const vectors = await embedWritingPassages(spans.map((s) => s.text));
        if (!fresh()) return false;
        const lexical = proposeThreadPairs(initial.index, focus.id);
        const neighbours = embeddingThreadPairs(
          initial.index,
          focus.id,
          spans.map((s) => s.id),
          vectors,
          LOCAL_WRITING_PACKS.embeddings.repo,
        );
        const pairs = [
          ...lexical,
          ...neighbours.filter((p) => !lexical.some((l) => l.id === p.id)),
        ].slice(0, 12);
        const next = {
          ...initial,
          threads: ruleThreads(initial.index, pairs),
          status: "ready" as const,
          notice: neighbours.length
            ? "On-device cosine scores propose neighbors; each relation remains unverified until judged."
            : "No sentence vector cosine reached 0.450 in this bounded section. Local wording and reference candidates remain available.",
        };
        publishThreadInstrument(next);
        const threads = await verifyThreadPairs(initial.index, pairs, ask);
        if (fresh()) publishThreadInstrument({ ...next, threads });
        return true;
      } catch {
        if (fresh())
          publishThreadInstrument({
            ...initial,
            status: "ready",
            notice:
              "On-device comparison was unavailable. Local wording and reference candidates remain available.",
          });
        return false;
      }
    },
    open(passage) {
      if (stopped || editor.isDestroyed) return;
      const index = threadIndex();
      const needle = passage?.trim();
      const focus = index.spans.find((span) =>
        needle
          ? span.text.includes(needle) || needle.includes(span.text)
          : editor.state.selection.head >= span.from &&
            editor.state.selection.head <= span.to,
      );
      const pairs = proposeThreadPairs(index, focus?.id);
      setActive(null);
      previewThread = null;
      const token = generation;
      const initial = {
        open: true,
        index,
        threads: ruleThreads(index, pairs),
        status: "reading" as const,
        stale: false,
        focusId: focus?.id,
        notice: index.limited
          ? "Showing the first 2,000 complete sentence spans."
          : undefined,
      };
      publishThreadInstrument(initial);
      void verifyThreadPairs(index, pairs, ask).then((threads) => {
        const current = threadInstrumentSnapshot();
        if (
          stopped ||
          token !== generation ||
          !current.open ||
          current.index.fingerprint !== index.fingerprint
        )
          return;
        publishThreadInstrument({ ...initial, status: "ready", threads });
      });
    },
    close() {
      previewThread = null;
      publishThreadInstrument(EMPTY_THREAD_SNAPSHOT);
      queueMicrotask(drawAnchor);
    },
    jump(spanId) {
      const current = threadInstrumentSnapshot(),
        span = spanById(current.index, spanId);
      if (
        !span ||
        current.stale ||
        editor.isDestroyed ||
        editor.state.doc.textBetween(span.from, span.to) !== span.text
      )
        return false;
      editor
        .chain()
        .setTextSelection({ from: span.from, to: span.to })
        .scrollIntoView()
        .run();
      return true;
    },
    spanRange(spanId) {
      const current = threadInstrumentSnapshot(),
        span = spanById(current.index, spanId);
      if (
        !span ||
        current.stale ||
        editor.isDestroyed ||
        editor.state.doc.textBetween(span.from, span.to) !== span.text
      )
        return null;
      try {
        const start = editor.view.domAtPos(span.from);
        const end = editor.view.domAtPos(span.to);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
      } catch {
        return null;
      }
    },
    preview(threadId) {
      previewThread = threadId;
      queueMicrotask(drawAnchor);
    },
    removeRepeated(threadId, removeSpanId) {
      const current = threadInstrumentSnapshot();
      const thread = current.threads.find((t) => t.id === threadId);
      if (
        !thread ||
        current.stale ||
        !editor.isEditable ||
        editor.isDestroyed ||
        thread.hypothesis !== "exact-wording" ||
        ![thread.firstId, thread.secondId].includes(removeSpanId)
      )
        return false;
      if (
        [thread.first, thread.second].some(
          (span) =>
            editor.state.doc.textBetween(span.from, span.to) !== span.text,
        )
      )
        return false;
      const span =
        removeSpanId === thread.firstId ? thread.first : thread.second;
      const block = editor.state.doc.nodeAt(span.blockFrom);
      if (!isTrackedBlock(block)) return false;
      let from = span.from,
        to = span.to;
      const end = span.blockFrom + block.nodeSize - 1;
      while (to < end && /^\s$/.test(editor.state.doc.textBetween(to, to + 1)))
        to++;
      if (to === span.to)
        while (
          from > span.blockFrom + 1 &&
          /^\s$/.test(editor.state.doc.textBetween(from - 1, from))
        )
          from--;
      editor.view.dispatch(
        closeHistory(editor.state.tr)
          .delete(from, to)
          .setMeta("twyne:sentence-instrument", {
            action: "remove-repeat",
            sentenceId: removeSpanId,
            threadId,
          }),
      );
      publishThreadInstrument(EMPTY_THREAD_SNAPSHOT);
      previewThread = null;
      return true;
    },
  });

  /* ── Settings and lifecycle ───────────────────────────────────── */

  const settings = async () => {
    const [live, inFlow] = await Promise.all([
      loadMetaFromIdb<boolean>("live-review-enabled"),
      loadMetaFromIdb<boolean>(IN_FLOW_SETTING_KEY),
    ]);
    if (stopped) return;
    enabled = live !== false && inFlow !== false;
    if (!enabled) {
      clearTimeout(pauseTimer);
      clearTimeout(stallTimer);
      setActive(null);
    }
  };
  const onOpen = (event: Event) => {
    const detail = (event as CustomEvent<{ kind: ToolKind; passage?: string }>)
      .detail;
    if (detail?.kind) controller?.openKind(detail.kind, detail.passage);
  };

  editor.on("transaction", onTransaction);
  const onSelection = ({ transaction }: { transaction: Transaction }) => {
    // Typing emits selection updates too; it must retain the five-second timer.
    if (transaction.docChanged) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void settleLedger(), 150);
  };
  editor.on("selectionUpdate", onSelection);
  settleTimer = setTimeout(() => void settleLedger(), SENTENCE_SETTLE_MS);
  window.addEventListener(IN_FLOW_SETTING_EVENT, settings);
  window.addEventListener("twyne:live-review-setting", settings);
  window.addEventListener(IN_FLOW_OPEN_EVENT, onOpen);
  void settings();
  publish({ active: null, ticks: [] });

  return () => {
    stopped = true;
    clearTimeout(pauseTimer);
    clearTimeout(stallTimer);
    clearTimeout(publishTimer);
    clearTimeout(settleTimer);
    editor.off("transaction", onTransaction);
    editor.off("selectionUpdate", onSelection);
    window.removeEventListener(IN_FLOW_SETTING_EVENT, settings);
    window.removeEventListener("twyne:live-review-setting", settings);
    window.removeEventListener(IN_FLOW_OPEN_EVENT, onOpen);
    controller = null;
    bindThreadInstrument(null);
    publishThreadInstrument(EMPTY_THREAD_SNAPSHOT);
    publish({ active: null, ticks: [] });
  };
}
