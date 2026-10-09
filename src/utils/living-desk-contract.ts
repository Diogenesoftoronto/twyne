/**
 * The living desk: findings about the whole piece that stay live while the
 * writer edits, plus a score that moves with each fix.
 *
 * This module is the only contract between the engine (the editor extension
 * in `components/editor/extensions/living-desk.ts` and the pure analysis
 * under `utils/living-desk/`) and the interface (`components/living-desk/`).
 * It is dependency-free so either side can import it without loading the
 * other. Positions are ProseMirror document positions at `updatedAt`; the
 * engine maps its own decorations, the interface never edits the document.
 */

export const LIVING_DESK_EVENT = "twyne:living-desk";
/** Toggle the desk panel. `detail.open` forces a state; absent flips it. */
export const LIVING_DESK_TOGGLE_EVENT = "twyne:living-desk-toggle";
/** Persisted per device: whether the desk panel is open. */
export const LIVING_DESK_OPEN_KEY = "living-desk-open";

export type DeskLevel =
  | "word"
  | "sentence"
  | "paragraph"
  | "section"
  | "piece"
  | "collection";

/** A lens recolours the manuscript for one kind of finding. */
export type LensId = "stance" | "naming" | "style" | "presence";

/** Who decided: code, the judgement model, or a text model. */
export type Provenance = "rule" | "jev" | "model";

export type FindingState = "open" | "improving" | "resolved" | "deliberate";

export type FindingAction = "fix-one" | "fix-all" | "deliberate" | "jump";

export interface Occurrence {
  /** Stable while the span exists, e.g. `stance:812`. */
  id: string;
  from: number;
  to: number;
  /** The span as it reads in the manuscript. */
  text: string;
  /** About 40 characters either side, already trimmed to word boundaries. */
  before: string;
  after: string;
  /** Index into `LivingDeskSnapshot.sections`. */
  section: number;
  /** 1-based paragraph number in the whole document, for “¶4”. */
  paragraph: number;
  /** Replacement for exactly `[from, to)`; absent when no mechanical fix exists. */
  fix?: string;
  /** Classification, e.g. `editorial`, `inclusive`, `group`, `quoted`. */
  label?: string;
  /** Probability of `label` when a model supplied it. */
  probability?: number;
  /** One short observable reason, e.g. “the author alone”. */
  note?: string;
  provenance: Provenance;
  /** False when shown only for context (an inclusive “we” left alone). */
  flagged: boolean;
}

export interface Finding {
  /** Stable across recomputes, e.g. `stance`, `naming:hollins`, `style:serial-comma`. */
  id: string;
  lens: LensId;
  level: DeskLevel;
  /** Observable and specific: “Editorial “we” in an “I” essay”. */
  title: string;
  /** One live line: “3 editorial “we” · 41 “I””. */
  metric: string;
  /** Flagged occurrences still open. */
  count: number;
  /** Key into `LiveScore.criteria`. */
  criterion: string;
  /** Estimated lift in the 0–10 estimate if resolved; null when not estimable. */
  impact: number | null;
  /** Edits needed to resolve. */
  effort: number;
  state: FindingState;
  /** Flagged occurrences first, then context occurrences. */
  occurrences: Occurrence[];
  actions: FindingAction[];
  provenance: Provenance;
  /** Shown instead of the occurrences when the writer marked it deliberate. */
  deliberateNote?: string;
}

export interface SectionInfo {
  index: number;
  /** Heading text, or “Opening” for text before the first heading. */
  title: string;
  from: number;
  to: number;
  words: number;
}

export interface PresenceRow {
  /** Canonical name. */
  entity: string;
  /** Other spellings seen, which also feed a naming finding. */
  variants: string[];
  /** Mentions per section, aligned with `sections`. */
  counts: number[];
}

export interface ScoreCriterion {
  key: string;
  label: string;
  /** 0–10. */
  value: number;
  /** Change since the last confirmed read; 0 when unchanged. */
  delta: number;
  /** `rule` updates on every edit; `review` only on a confirmed read. */
  source: "rule" | "review";
  /** What the criterion is judged over. */
  scope: "paragraph" | "piece";
}

export interface LiveScore {
  /** Last confirmed whole-piece grade on a 0–10 scale; null if never read. */
  confirmed: number | null;
  confirmedAt: number | null;
  /** The confirmed letter grade, when the review produced one. */
  confirmedLetter: string | null;
  /** Current estimate on a 0–10 scale, null before there is enough draft. */
  estimate: number | null;
  /** Edits since the confirmed read; 0 means the estimate equals the confirmed grade. */
  editsSinceConfirmed: number;
  /** Most recent change, for the delta flag: which criterion, by how much, from where. */
  lastChange: {
    criterion: string;
    delta: number;
    source: string;
    at: number;
  } | null;
  criteria: ScoreCriterion[];
}

export interface LivingDeskSnapshot {
  /** Phase 1 analyses stop above 80k characters; the outline remains available. */
  analysisStatus?: "ready" | "limited";
  folioId: string | null;
  open: boolean;
  lens: LensId | null;
  focusedFinding: string | null;
  /** Occurrence currently previewed as ghost text in the manuscript. */
  previewing: string | null;
  sections: SectionInfo[];
  /** Open findings by impact, then improving, then resolved and deliberate. */
  findings: Finding[];
  presence: PresenceRow[];
  score: LiveScore;
  /** `offline` means rule-only: no judgement model is reachable. */
  judgement: "idle" | "reading" | "offline";
  updatedAt: number;
}

export interface LivingDeskController {
  setOpen(open: boolean): void;
  setLens(lens: LensId | null): void;
  /** Open a finding: sets its lens and emphasises its occurrences. */
  focus(findingId: string | null): void;
  /** Ghost-preview an occurrence's fix in place; null clears. */
  preview(occurrenceId: string | null): void;
  /** Apply one fix as a single undoable transaction. False if the span moved. */
  applyFix(findingId: string, occurrenceId: string): boolean;
  /** Apply every flagged fix as one undoable transaction; returns how many. */
  applyAll(findingId: string): number;
  markDeliberate(findingId: string, deliberate: boolean): void;
  /** Select the span and scroll it into view. */
  jumpTo(occurrenceId: string): void;
  /** Jump to the first position inside a section. */
  jumpToSection(index: number): void;
  /** 0..1 position of `pos` down the manuscript's rendered height. */
  spineFraction(pos: number): number | null;
  /** Ask for a whole-piece read now. */
  confirm(): void;
}

export const EMPTY_LIVING_DESK: LivingDeskSnapshot = {
  folioId: null,
  open: false,
  lens: null,
  focusedFinding: null,
  previewing: null,
  sections: [],
  findings: [],
  presence: [],
  score: {
    confirmed: null,
    confirmedAt: null,
    confirmedLetter: null,
    estimate: null,
    editsSinceConfirmed: 0,
    lastChange: null,
    criteria: [],
  },
  judgement: "offline",
  updatedAt: 0,
};

let snapshot: LivingDeskSnapshot = EMPTY_LIVING_DESK;
let controller: LivingDeskController | null = null;

export const livingDeskSnapshot = (): LivingDeskSnapshot => snapshot;
export const livingDeskController = (): LivingDeskController | null =>
  controller;

/** Engine only. */
export function publishLivingDesk(next: LivingDeskSnapshot): void {
  snapshot = next;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LivingDeskSnapshot>(LIVING_DESK_EVENT, { detail: next }),
  );
}

/** Engine only. Returns an unregister function. */
export function registerLivingDeskController(
  next: LivingDeskController,
): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
    publishLivingDesk({ ...EMPTY_LIVING_DESK, open: snapshot.open });
  };
}
