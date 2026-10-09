import { Extension, type Editor } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import { Mapping } from "@tiptap/pm/transform";
import type { ConvexClient } from "convex/browser";
import {
  EMPTY_LIVING_DESK,
  LIVING_DESK_OPEN_KEY,
  LIVING_DESK_TOGGLE_EVENT,
  publishLivingDesk,
  registerLivingDeskController,
  livingDeskController,
  type LivingDeskSnapshot,
  type LivingDeskController,
  type Occurrence,
  type Finding,
} from "../../../utils/living-desk-contract";
import {
  segmentDocument,
  posAtOffset,
  type Segments,
} from "../../../utils/living-desk/segment";
import { analyzeDesk } from "../../../utils/living-desk/analyze";
import {
  deliberateBaseline,
  respectDeliberate,
  type DeliberateBaseline,
} from "../../../utils/living-desk/deliberate";
import { htmlToPlainText } from "../../../utils/anti-tabula-rasa";
import { rubricDraftFingerprint } from "../../../utils/rubric-judgement-result";
import {
  classifyStance,
  type StanceCache,
} from "../../../utils/living-desk/stance";
import {
  buildScore,
  rankFindings,
  ruleValues,
  type Confirmation,
} from "../../../utils/living-desk/score";
import {
  liveReviewSnapshot,
  LIVE_REVIEW_REQUEST_EVENT,
} from "../../../utils/live-review";
import { askJudgement } from "../../../utils/judgement-client";
import {
  systemOneWait,
  spendSystemOne,
  backOffSystemOne,
} from "../../../utils/system-one-budget";

const key = new PluginKey<DecorationSet>("livingDeskDecorations");
export const LivingDeskDecorations = Extension.create({
  name: "livingDeskDecorations",
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

/** Last complete pass, for profiling without adding work to a transaction listener. */
export let livingDeskRecomputeMs = 0;

export function startLivingDesk(
  editor: Editor,
  options: {
    getClient: () => ConvexClient | null | undefined;
    folioId: string;
  },
): () => void {
  let stopped = false,
    running = false,
    lastEdit = Date.now(),
    revision = 0;
  let ruleTimer: ReturnType<typeof setTimeout> | undefined;
  let judgementTimer: ReturnType<typeof setTimeout> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let confirmation: Confirmation | null = null;
  let confirmedToken = "";
  let segments: Segments = { blocks: [], sections: [], plainText: "" };
  let analysis: ReturnType<typeof analyzeDesk> | null = null;
  const cache: StanceCache = new Map();
  const retained = new Map<string, Finding>();
  const peaks = new Map<string, number>();
  const deliberate = new Set<string>();
  const baselines = new Map<string, DeliberateBaseline>();
  const deliberateKey = `living-desk-deliberate:${options.folioId}`;
  const baselineKey = `${deliberateKey}:occurrences`;
  let flashes: { from: number; to: number }[] = [];
  let pendingMapping = new Mapping();
  let snapshot: LivingDeskSnapshot = {
    ...EMPTY_LIVING_DESK,
    folioId: options.folioId,
    judgement: "idle",
  };
  try {
    snapshot.open =
      window.localStorage.getItem(LIVING_DESK_OPEN_KEY) === "true";
    const ids: unknown = JSON.parse(
      window.localStorage.getItem(deliberateKey) ?? "[]",
    );
    if (Array.isArray(ids))
      ids
        .filter((id): id is string => typeof id === "string")
        .forEach((id) => deliberate.add(id));
    const savedBaselines: unknown = JSON.parse(
      window.localStorage.getItem(baselineKey) ?? "[]",
    );
    if (Array.isArray(savedBaselines))
      savedBaselines.forEach((entry: unknown) => {
        if (
          !Array.isArray(entry) ||
          typeof entry[0] !== "string" ||
          !Array.isArray(entry[1])
        )
          return;
        const pairs = entry[1].filter(
          (pair: unknown): pair is [string, number] =>
            Array.isArray(pair) &&
            typeof pair[0] === "string" &&
            typeof pair[1] === "number" &&
            Number.isFinite(pair[1]) &&
            pair[1] >= 0,
        );
        baselines.set(entry[0], new Map(pairs));
      });
  } catch {
    /* Storage can be disabled; the desk still works for this session. */
  }

  const mapPositions = () => {
    if (!pendingMapping.maps.length) return;
    snapshot = {
      ...snapshot,
      findings: snapshot.findings.map((f) => ({
        ...f,
        occurrences: f.occurrences.map((o) => ({
          ...o,
          from: pendingMapping.map(o.from, 1),
          to: pendingMapping.map(o.to, -1),
        })),
      })),
    };
    pendingMapping = new Mapping();
  };
  const draw = () => {
    if (stopped || editor.isDestroyed) return;
    mapPositions();
    const dom = editor.view.dom;
    const lens =
      snapshot.findings.find((f) => f.id === snapshot.focusedFinding)?.lens ??
      snapshot.lens;
    if (lens) dom.setAttribute("data-ld-lens", lens);
    else dom.removeAttribute("data-ld-lens");
    if (snapshot.focusedFinding)
      dom.setAttribute("data-ld-focus", snapshot.focusedFinding);
    else dom.removeAttribute("data-ld-focus");
    const decorations: Decoration[] = [];
    for (const f of snapshot.findings) {
      if (f.lens !== lens || f.state === "deliberate") continue;
      for (const o of f.occurrences) {
        if (
          o.from < 0 ||
          o.to > editor.state.doc.content.size ||
          o.from >= o.to
        )
          continue;
        const previewing = o.id === snapshot.previewing && o.fix !== undefined;
        decorations.push(
          Decoration.inline(o.from, o.to, {
            class: `ld-occ ld-occ--${o.flagged ? "flagged" : "context"}${f.id === snapshot.focusedFinding ? " ld-occ--focused" : ""}${previewing ? " ld-occ--previewing" : ""}`,
            "data-ld-lens": f.lens,
            "data-ld-label": o.label ?? "",
            "data-ld-id": o.id,
          }),
        );
        if (previewing)
          decorations.push(
            Decoration.widget(
              o.to,
              () => {
                const ghost = document.createElement("span");
                ghost.className = "ld-ghost";
                ghost.textContent = o.fix!;
                ghost.setAttribute("data-ld-id", o.id);
                ghost.setAttribute("aria-hidden", "true");
                return ghost;
              },
              { side: 1, key: `ghost:${o.id}:${o.fix}` },
            ),
          );
      }
    }
    flashes
      .filter((f) => f.from < f.to && f.to <= editor.state.doc.content.size)
      .forEach((f) =>
        decorations.push(
          Decoration.inline(f.from, f.to, { class: "ld-flash" }),
        ),
      );
    editor.view.dispatch(
      editor.state.tr
        .setMeta(key, DecorationSet.create(editor.state.doc, decorations))
        .setMeta("addToHistory", false),
    );
  };
  const publish = () => {
    if (stopped) return;
    snapshot = { ...snapshot, updatedAt: Date.now() };
    draw();
    publishLivingDesk(snapshot);
  };
  const captureReview = () => {
    const review = liveReviewSnapshot().result;
    if (!review || review.folioId !== options.folioId || !review.rubric) return;
    const token = `${review.at}:${review.fingerprint}`;
    if (token === confirmedToken) return;
    confirmedToken = token;
    const rules = ruleValues(segments.plainText, snapshot.findings);
    // A saved reading carries its own static baseline; never pretend an old
    // review measured the current paragraph features.
    Object.keys(rules).forEach((name) => {
      if (name === "consistency") return;
      const value =
        review.rubric!.staticScore?.perFeature[
          name as keyof typeof review.rubric.staticScore.perFeature
        ];
      if (typeof value === "number") rules[name] = value;
    });
    confirmation = { review: review.rubric, at: review.at, rules };
    snapshot.score = {
      ...snapshot.score,
      // An old loaded reading is a confirmed grade of its own draft, not this
      // draft. Keep ≈ until an exact fingerprint comparison proves freshness.
      editsSinceConfirmed: Math.max(1, snapshot.score.editsSinceConfirmed),
      lastChange: null,
    };
    const atRevision = revision;
    void rubricDraftFingerprint(htmlToPlainText(editor.getHTML()))
      .then((fingerprint) => {
        if (
          stopped ||
          atRevision !== revision ||
          token !== confirmedToken ||
          fingerprint !== review.fingerprint
        )
          return;
        if (confirmation)
          confirmation = {
            ...confirmation,
            rules: ruleValues(segments.plainText, snapshot.findings),
          };
        snapshot = {
          ...snapshot,
          score: { ...snapshot.score, editsSinceConfirmed: 0 },
        };
        recompute();
      })
      .catch(() => {
        /* Without a digest, keep the reading visibly stale. */
      });
  };
  const recompute = (fixedParagraph?: number) => {
    if (stopped || editor.isDestroyed) return;
    const started = performance.now();
    segments = segmentDocument(editor.state.doc);
    pendingMapping = new Mapping();
    // Do not silently call a cursor excerpt a whole-piece ledger or grade.
    // Phase 1 is bounded to 80k characters; larger pieces keep their outline.
    if (segments.plainText.length > 80_000) {
      analysis = null;
      snapshot = {
        ...snapshot,
        sections: segments.sections,
        findings: [],
        presence: [],
        score: { ...EMPTY_LIVING_DESK.score },
        analysisStatus: "limited",
      };
      livingDeskRecomputeMs = performance.now() - started;
      publish();
      return;
    }
    analysis = analyzeDesk(segments, cache);
    const current = new Set(analysis.findings.map((f) => f.id));
    const findings = analysis.findings.map((f) => {
      const peak = Math.max(peaks.get(f.id) ?? 0, f.count);
      peaks.set(f.id, peak);
      if (deliberate.has(f.id)) {
        const baseline =
          baselines.get(f.id) ?? deliberateBaseline(f, segments.blocks);
        baselines.set(f.id, baseline);
        f = respectDeliberate(f, segments.blocks, baseline);
      } else if (f.count && f.count < peak) f = { ...f, state: "improving" };
      retained.set(f.id, f);
      return f;
    });
    retained.forEach((old, id) => {
      if (current.has(id)) return;
      const resolved: Finding = {
        ...old,
        count: 0,
        effort: 0,
        impact: 0,
        state: deliberate.has(id) ? "deliberate" : "resolved",
        occurrences: [],
        metric:
          old.lens === "stance"
            ? `0 editorial “we” · ${analysis!.stance.singular} singular pronouns`
            : "0 exceptions remain",
      };
      retained.set(id, resolved);
      findings.push(resolved);
    });
    const before = snapshot.score;
    snapshot = {
      ...snapshot,
      sections: segments.sections,
      presence: analysis.presence,
      findings,
      analysisStatus: "ready",
    };
    captureReview();
    let score = buildScore(
      segments.plainText,
      findings,
      confirmation,
      snapshot.score.editsSinceConfirmed,
      snapshot.score.lastChange,
    );
    if (fixedParagraph !== undefined) {
      const changes = score.criteria
        .filter((c) => c.source === "rule")
        .map((c) => ({
          criterion: c.key,
          delta:
            c.value -
            (before.criteria.find((old) => old.key === c.key)?.value ??
              c.value),
        }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      score = {
        ...score,
        lastChange: changes[0]
          ? { ...changes[0], source: `¶${fixedParagraph}`, at: Date.now() }
          : null,
      };
    }
    snapshot = {
      ...snapshot,
      score,
      findings: rankFindings(findings, score.estimate !== null),
    };
    livingDeskRecomputeMs = performance.now() - started;
    publish();
  };
  const queueRules = () => {
    clearTimeout(ruleTimer);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    idle = undefined;
    ruleTimer = setTimeout(() => {
      if (window.requestIdleCallback)
        idle = window.requestIdleCallback(
          () => {
            idle = undefined;
            recompute();
          },
          { timeout: 800 },
        );
      else recompute();
    }, 400);
  };
  const queueJudgement = (delay = 2000) => {
    clearTimeout(judgementTimer);
    judgementTimer = setTimeout(() => void readStance(), delay);
  };
  const readStance = async () => {
    if (
      stopped ||
      running ||
      !analysis?.stance.finding ||
      document.hidden ||
      navigator.onLine === false
    )
      return;
    const wait = Math.max(systemOneWait(), lastEdit + 2000 - Date.now());
    if (wait > 0) {
      queueJudgement(wait);
      return;
    }
    if (
      !analysis.stance.candidates.some(
        (c) => !cache.get(c.cacheKey)?.has(c.offset),
      )
    )
      return;
    const token = revision;
    running = true;
    snapshot = { ...snapshot, judgement: "reading" };
    publish();
    spendSystemOne();
    try {
      const result = await classifyStance(analysis.stance, cache, (request) =>
        askJudgement(options.getClient(), request),
      );
      if (stopped) return;
      snapshot = { ...snapshot, judgement: result.ok ? "idle" : "offline" };
      if (!result.ok) backOffSystemOne();
      if (token === revision) recompute();
      else publish();
      if (result.remaining || token !== revision)
        queueJudgement(Math.max(2000, systemOneWait()));
    } catch {
      backOffSystemOne();
      if (!stopped) {
        snapshot = { ...snapshot, judgement: "offline" };
        publish();
        queueJudgement(Math.max(2000, systemOneWait()));
      }
    } finally {
      running = false;
    }
  };
  const onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
    if (stopped || !tr.docChanged) return;
    revision++;
    lastEdit = Date.now();
    if (!tr.getMeta("y-sync$") && tr.getMeta("addToHistory") !== false)
      snapshot = {
        ...snapshot,
        score: {
          ...snapshot.score,
          editsSinceConfirmed: snapshot.score.editsSinceConfirmed + 1,
        },
      };
    // Record mappings in O(transaction steps); mapping every ledger occurrence
    // is deferred until a pause or an explicit interaction.
    pendingMapping.appendMapping(tr.mapping);
    flashes = flashes.map((f) => ({
      from: tr.mapping.map(f.from, 1),
      to: tr.mapping.map(f.to, -1),
    }));
    if (isHistoryTransaction(tr)) {
      flashes = [];
      clearTimeout(flashTimer);
      snapshot = {
        ...snapshot,
        score: { ...snapshot.score, lastChange: null },
      };
      recompute();
    } else queueRules();
    queueJudgement();
  };
  const findOccurrence = (id: string) => {
    mapPositions();
    return snapshot.findings
      .flatMap((f) => f.occurrences)
      .find((o) => o.id === id);
  };
  const verify = (o: Occurrence): { from: number; to: number } | null => {
    const doc = editor.state.doc;
    if (
      o.from >= 0 &&
      o.to <= doc.content.size &&
      doc.textBetween(o.from, o.to, "", "\ufffc") === o.text
    )
      return { from: o.from, to: o.to };
    const fresh = segmentDocument(doc);
    const block = fresh.blocks.find(
      (b) => b.paragraph === o.paragraph && b.kind === "paragraph",
    );
    if (!block) return null;
    const matches: number[] = [];
    let cursor = 0;
    while (cursor <= block.text.length) {
      const index = block.text.indexOf(o.text, cursor);
      if (index < 0) break;
      const before = block.text
        .slice(Math.max(0, index - o.before.length - 2), index)
        .trimEnd();
      const after = block.text
        .slice(
          index + o.text.length,
          index + o.text.length + o.after.length + 2,
        )
        .trimStart();
      // A nearby identical pronoun with a different sentence is a different
      // occurrence, even if it happens to be the only remaining match.
      if (
        (o.before || o.after) &&
        before.endsWith(o.before.trimEnd()) &&
        after.startsWith(o.after.trimStart())
      )
        matches.push(index);
      cursor = index + Math.max(1, o.text.length);
    }
    if (matches.length !== 1) return null;
    const at = matches[0];
    const span = {
      from: posAtOffset(block, at),
      to: posAtOffset(block, at + o.text.length, true),
    };
    return doc.textBetween(span.from, span.to, "", "\ufffc") === o.text
      ? span
      : null;
  };
  const stale = (findingId: string, occurrenceId: string) => {
    snapshot = {
      ...snapshot,
      findings: snapshot.findings.map((f) =>
        f.id !== findingId
          ? f
          : {
              ...f,
              occurrences: f.occurrences.map((o) =>
                o.id !== occurrenceId
                  ? o
                  : {
                      ...o,
                      fix: undefined,
                      note: "This changed since it was found",
                    },
              ),
            },
      ),
    };
    publish();
  };
  const apply = (findingId: string, ids: string[]): number => {
    mapPositions();
    const f = snapshot.findings.find((item) => item.id === findingId);
    if (!f || f.state === "deliberate" || !editor.isEditable) return 0;
    const fixes: { o: Occurrence; from: number; to: number }[] = [];
    for (const id of ids) {
      const o = f.occurrences.find(
        (item) => item.id === id && item.flagged && item.fix !== undefined,
      );
      if (!o) continue;
      const span = verify(o);
      if (!span) {
        stale(findingId, id);
        continue;
      }
      fixes.push({ o, ...span });
    }
    fixes.sort((a, b) => b.from - a.from);
    if (
      !fixes.length ||
      fixes.some((fix, i) => i > 0 && fix.to > fixes[i - 1].from)
    )
      return 0;
    const tr = closeHistory(editor.state.tr);
    const ranges: { from: number; to: number }[] = [];
    for (const fix of fixes) {
      ranges.forEach((range) => {
        const change = fix.o.fix!.length - (fix.to - fix.from);
        range.from += change;
        range.to += change;
      });
      tr.insertText(fix.o.fix!, fix.from, fix.to);
      ranges.push({ from: fix.from, to: fix.from + fix.o.fix!.length });
    }
    editor.view.dispatch(tr);
    // Isolate the next typing transaction from this undo event as well.
    editor.view.dispatch(
      closeHistory(editor.state.tr).setMeta("addToHistory", false),
    );
    clearTimeout(ruleTimer);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    idle = undefined;
    flashes = ranges;
    snapshot = { ...snapshot, previewing: null };
    recompute(fixes[fixes.length - 1].o.paragraph);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashes = [];
      publish();
    }, 1200);
    return fixes.length;
  };
  const jump = (from: number, to = from) => {
    const max = editor.state.doc.content.size;
    editor.view.dispatch(
      editor.state.tr
        .setSelection(
          TextSelection.create(
            editor.state.doc,
            Math.min(max, from),
            Math.min(max, to),
          ),
        )
        .scrollIntoView(),
    );
    editor.view.focus();
  };
  const controller: LivingDeskController = {
    setOpen(open) {
      snapshot = { ...snapshot, open };
      try {
        window.localStorage.setItem(LIVING_DESK_OPEN_KEY, String(open));
      } catch {
        /* optional persistence */
      }
      publish();
    },
    setLens(lens) {
      snapshot = { ...snapshot, lens, focusedFinding: null, previewing: null };
      publish();
    },
    focus(findingId) {
      const f = snapshot.findings.find((item) => item.id === findingId);
      snapshot = {
        ...snapshot,
        focusedFinding: f?.id ?? null,
        lens: f?.lens ?? snapshot.lens,
        previewing: null,
      };
      publish();
    },
    preview(occurrenceId) {
      snapshot = {
        ...snapshot,
        previewing:
          occurrenceId && findOccurrence(occurrenceId)?.fix !== undefined
            ? occurrenceId
            : null,
      };
      publish();
    },
    applyFix(findingId, occurrenceId) {
      return apply(findingId, [occurrenceId]) === 1;
    },
    applyAll(findingId) {
      return apply(
        findingId,
        snapshot.findings
          .find((f) => f.id === findingId)
          ?.occurrences.filter((o) => o.flagged && o.fix !== undefined)
          .map((o) => o.id) ?? [],
      );
    },
    markDeliberate(findingId, on) {
      if (on) {
        deliberate.add(findingId);
        mapPositions();
        segments = segmentDocument(editor.state.doc);
        const finding = snapshot.findings.find((f) => f.id === findingId);
        if (finding)
          baselines.set(
            findingId,
            deliberateBaseline(finding, segments.blocks),
          );
      } else {
        deliberate.delete(findingId);
        baselines.delete(findingId);
      }
      try {
        window.localStorage.setItem(
          deliberateKey,
          JSON.stringify([...deliberate]),
        );
        window.localStorage.setItem(
          baselineKey,
          JSON.stringify(
            [...baselines].map(([id, baseline]) => [id, [...baseline]]),
          ),
        );
      } catch {
        /* optional persistence */
      }
      recompute();
    },
    jumpTo(id) {
      const o = findOccurrence(id);
      if (o) {
        const span = verify(o);
        if (span) jump(span.from, span.to);
      }
    },
    jumpToSection(index) {
      const section = snapshot.sections[index];
      if (section) jump(section.from);
    },
    spineFraction(pos) {
      try {
        const dom = editor.view.dom;
        return Math.max(
          0,
          Math.min(
            1,
            (editor.view.coordsAtPos(pos).top -
              dom.getBoundingClientRect().top) /
              Math.max(1, dom.scrollHeight),
          ),
        );
      } catch {
        return null;
      }
    },
    confirm() {
      window.dispatchEvent(
        new window.CustomEvent(LIVE_REVIEW_REQUEST_EVENT, {
          detail: { folioId: options.folioId },
        }),
      );
    },
  };
  const unregister = registerLivingDeskController(controller);
  const onToggle = (event: Event) =>
    controller.setOpen(
      (event as CustomEvent<{ open?: boolean }>).detail?.open ?? !snapshot.open,
    );
  const onKeydown = () => {
    if (snapshot.focusedFinding) {
      snapshot = { ...snapshot, focusedFinding: null };
      editor.view.dom.removeAttribute("data-ld-focus");
      setTimeout(publish, 0);
    }
  };
  const onReview = () => recompute();
  const onResume = () => {
    if (!document.hidden) queueJudgement();
  };
  window.addEventListener(LIVING_DESK_TOGGLE_EVENT, onToggle);
  window.addEventListener("twyne:live-review", onReview);
  window.addEventListener("online", onResume);
  window.addEventListener("twyne:ai-settings-saved", onResume);
  document.addEventListener("visibilitychange", onResume);
  editor.view.dom.addEventListener("keydown", onKeydown);
  editor.on("transaction", onTransaction);
  recompute();
  queueJudgement();
  return () => {
    stopped = true;
    clearTimeout(ruleTimer);
    clearTimeout(judgementTimer);
    clearTimeout(flashTimer);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    editor.off("transaction", onTransaction);
    window.removeEventListener(LIVING_DESK_TOGGLE_EVENT, onToggle);
    window.removeEventListener("twyne:live-review", onReview);
    window.removeEventListener("online", onResume);
    window.removeEventListener("twyne:ai-settings-saved", onResume);
    document.removeEventListener("visibilitychange", onResume);
    if (!editor.isDestroyed) {
      editor.view.dom.removeEventListener("keydown", onKeydown);
      editor.view.dom.removeAttribute("data-ld-focus");
      editor.view.dom.removeAttribute("data-ld-lens");
      editor.view.dispatch(
        editor.state.tr
          .setMeta(key, DecorationSet.empty)
          .setMeta("addToHistory", false),
      );
    }
    if (livingDeskController() === controller) unregister();
  };
}
