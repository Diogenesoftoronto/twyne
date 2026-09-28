/**
 * The struggle tracker — watches how the writer edits each paragraph, and on
 * a pause offers one tool in the margin when the edits say they are stuck.
 *
 * What it records per paragraph is counters and, in memory only, the last
 * few committed versions (Sentence Lab shows the writer their own attempts).
 * Nothing is sent anywhere while the writer types. On a pause, a paragraph
 * whose signals cross the threshold goes to Jev for a second opinion, then
 * the chosen tool is seeded from the writer's own material and — for the two
 * tools that need words — filled by the writer's model as it streams.
 *
 * One tool at a time. Dismissing one quiets that paragraph for a while.
 */
import { Extension, type Editor } from "@tiptap/core";
import { askJudgement } from "../../../utils/judgement-client";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isHistoryTransaction } from "@tiptap/pm/history";
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
  applyVariant(text: string): void;
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
    folioId: string;
    brief: ProjectBrief | null;
    openPanel?: (panel: "citations") => void;
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
    // Programmatic writes (loads, our own decorations, remote mirrors) mark
    // themselves out of history; they are not the writer's effort.
    const undo = isHistoryTransaction(tr);
    const counted = undo || tr.getMeta("addToHistory") !== false;
    const now = Date.now();

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

    generation++;
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
    if (!client) throw new Error("offline");
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
      return (await askJudgement(client, {
        state,
        questions: input.questions,
      })) as Awaited<ReturnType<Ask>>;
    } catch (error) {
      backOffSystemOne();
      throw error;
    }
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
      if (activity) activities.set(pos, commitVersion(activity));
    }
    dirty.clear();
    publish({ active, ticks: ticks() });
    if (active) return;

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
    if (!classification.kind) {
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
    },
  ) => {
    const node = editor.state.doc.nodeAt(blockPos);
    if (!isTrackedBlock(node)) return;
    const passage = node.textContent;
    if (!passage.trim()) return;
    const spec = seedSpec(kind, passage, {
      activity: opts.activity,
      sentenceIndex: opts.sentenceIndex,
      classification: opts.classification,
      config: opts.saved?.config,
    });
    let sentenceFrom: number | undefined;
    let sentenceTo: number | undefined;
    const element = spec.elements.tool;
    if (element.type === "SentenceLab" || element.type === "ClaimCheck") {
      const target =
        element.type === "SentenceLab"
          ? element.props.sentence
          : element.props.claim;
      const span = splitSentences(passage).find((s) => s.text === target);
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
    };
    highlight = null;
    setActive(tool);
    void fill(tool, passage, blockPos);
  };

  const fill = async (tool: ActiveTool, passage: string, blockPos: number) => {
    const settings = await loadAiSettingsFromIdb();
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
        goal: brief?.answers.goal ?? "",
        audience: brief?.answers.audience ?? "",
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

  /* ── Controller ───────────────────────────────────────────────── */

  const quiet = (pos: number) => {
    const activity = activities.get(pos);
    if (activity) activities.set(pos, coolDown(activity, Date.now()));
  };

  controller = {
    applyVariant(text) {
      if (!active || editor.isDestroyed) return;
      const node = editor.state.doc.nodeAt(active.from);
      if (!isTrackedBlock(node)) return;
      const element = active.spec.elements.tool;
      if (element.type !== "SentenceLab") return;
      let from = active.sentenceFrom;
      let to = active.sentenceTo;
      const current =
        from !== undefined && to !== undefined
          ? editor.state.doc.textBetween(from, to)
          : "";
      if (current !== element.props.sentence) {
        // The sentence moved or changed since the tool opened; find it again.
        const span = splitSentences(node.textContent).find(
          (s) => s.text === element.props.sentence,
        );
        if (!span) {
          setActive({
            ...active,
            notice: "That sentence has changed since the tool opened.",
          });
          return;
        }
        from = posAtOffset(node, active.from, span.from);
        to = posAtOffset(node, active.from, span.to);
      }
      const pos = active.from;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: from!, to: to! }, text)
        .run();
      quiet(pos);
      setActive(null);
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
      setActive(null);
    },
    async keep(name, config) {
      if (!active) return;
      const saved = await saveTool({ kind: active.kind, name, config });
      if (active)
        setActive({
          ...active,
          savedId: saved.id,
          notice: "Kept in Your tools.",
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
      const block = cursorBlock();
      if (!block) return;
      open(tool.kind, block.pos, {
        activity: activities.get(block.pos),
        reason: `From Your tools: ${tool.name}.`,
        saved: tool,
      });
    },
    openKind(kind, passage) {
      let pos: number | null = null;
      const needle = passage?.trim().slice(0, 120);
      if (needle) {
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
        reason: "Opened from the rubric.",
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
    editor.off("transaction", onTransaction);
    window.removeEventListener(IN_FLOW_SETTING_EVENT, settings);
    window.removeEventListener("twyne:live-review-setting", settings);
    window.removeEventListener(IN_FLOW_OPEN_EVENT, onOpen);
    controller = null;
    publish({ active: null, ticks: [] });
  };
}
