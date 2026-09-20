/**
 * Deciding which parts of a draft deserve attention, and what kind.
 *
 * The room currently treats a draft as uniform: convene, and every persona
 * reads the whole thing. But a draft is not uniform — most paragraphs are
 * fine, a few are load-bearing, and one or two are quietly broken. Spending
 * the same frontier budget on each is why the room is slow and why its output
 * is padded with notes about paragraphs that did not need one.
 *
 * Triage fixes the allocation. One cheap pass marks every passage with what it
 * needs and how much the piece rests on it; the expensive passes then go only
 * where both are high. The gate in `note-gate.ts` handles the other end —
 * whether what came back was worth showing.
 *
 * Two engines answer the same question here, so the label set is defined once
 * and shared. Jev gives a calibrated distribution; Needle, running offline as
 * an enum classifier, gives a label and nothing else. Anything reading a
 * triage result must work when `confidence` is absent.
 */

import {
  noul,
  choice as choiceQuestion,
  isChoice,
  isNoul,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "./system-one";

/**
 * What a passage needs, in the writer's terms. These map onto surfaces Twyne
 * already has, which is the constraint that keeps the list honest — a label
 * with nowhere to go is a label that produces noise.
 */
export const TRIAGE_KINDS = [
  "nothing", // leave it alone
  "advice", // a specific change → persona note
  "question", // something only the writer can resolve → margin note
  "evidence", // a claim wanting a source → research target
  "cut", // the passage is not earning its space
] as const;

export type TriageKind = (typeof TRIAGE_KINDS)[number];

/** Phrasings the model picks between. Order matches `TRIAGE_KINDS`. */
const TRIAGE_OPTIONS = [
  "Nothing — this passage is fine as it stands",
  "Advice — a specific change would clearly improve it",
  "Question — something is ambiguous that only the writer can resolve",
  "Evidence — it makes a claim that wants a source",
  "Cut — it repeats, pads, or does not earn its space",
];

const OPTION_TO_KIND = new Map<string, TriageKind>(
  TRIAGE_OPTIONS.map((label, i) => [label, TRIAGE_KINDS[i]]),
);

/**
 * Keep a batch well inside the 64-question cap and the 32k state budget, and
 * chunk anything longer. A long essay costs several requests, which at
 * ~$0.00006 each is still not worth optimising.
 */
export const MAX_PASSAGES_PER_BATCH = 24;

/** Below this, a passage is a fragment — a heading, a one-line transition. */
const MIN_PASSAGE_CHARS = 80;

export interface Passage {
  id: string;
  text: string;
  /** Character offset in the draft, so a result can be mapped back. */
  from: number;
  to: number;
}

/**
 * Split on blank lines, which is how Tiptap serialises blocks, and drop the
 * fragments. Headings and one-line transitions are not passages a reader
 * stumbles on, and asking about them spends questions to learn "nothing".
 */
export function splitPassages(text: string): Passage[] {
  const passages: Passage[] = [];
  let offset = 0;
  let index = 0;
  for (const block of text.split(/\n{2,}/)) {
    const start = text.indexOf(block, offset);
    offset = start + block.length;
    const trimmed = block.trim();
    if (trimmed.length >= MIN_PASSAGE_CHARS) {
      passages.push({
        id: `p${index}`,
        text: trimmed,
        from: start,
        to: start + block.length,
      });
    }
    index += 1;
  }
  return passages;
}

/* ── Questions ─────────────────────────────────────────────────── */

/**
 * Each passage becomes its own `state` key, and two questions referring to it
 * by name. The full draft goes in alongside so "does this repeat something"
 * and "is this load-bearing" are answerable — neither is decidable from the
 * passage alone, which is the whole reason this is not a regex.
 */
export function buildTriageState(
  passages: Passage[],
  draft: string,
): Record<string, string> {
  const state: Record<string, string> = { draft };
  for (const p of passages) state[p.id] = p.text;
  return state;
}

export function buildTriageQuestions(
  passages: Passage[],
): Record<string, SystemOneQuestion> {
  const questions: Record<string, SystemOneQuestion> = {};
  for (const p of passages) {
    questions[`${p.id}_kind`] = choiceQuestion(
      `Considering ${p.id} in the context of the whole draft, what does it most need?`,
      TRIAGE_OPTIONS,
    );
    // Criticality is separate from need on purpose. A broken throwaway line
    // and a subtly weak thesis both come back as "advice"; only the second is
    // worth a frontier call, and nothing but this question distinguishes them.
    questions[`${p.id}_critical`] = noul(
      `Does the draft's central argument depend on ${p.id}? Answer yes only if weakening this passage would weaken the piece's main point.`,
    );
  }
  return questions;
}

/* ── Results ───────────────────────────────────────────────────── */

export interface TriagedPassage {
  passage: Passage;
  kind: TriageKind;
  /** Absent when Needle classified this offline. */
  confidence: number | null;
  /** Probability the argument rests on this passage. Absent offline. */
  criticality: number | null;
  /**
   * What to spend on this passage first. Need and criticality multiplied, so
   * a load-bearing weak spot outranks a broken aside.
   */
  priority: number;
}

/** `nothing` is the absence of need; everything else is worth something. */
function needWeight(kind: TriageKind, confidence: number | null): number {
  if (kind === "nothing") return 0;
  return confidence ?? 0.5;
}

export function readTriage(
  passages: Passage[],
  answers: Record<string, SystemOneAnswer>,
): TriagedPassage[] {
  const out: TriagedPassage[] = [];
  for (const passage of passages) {
    const kindAnswer = answers[`${passage.id}_kind`];
    if (!isChoice(kindAnswer)) continue;
    const kind = OPTION_TO_KIND.get(kindAnswer.choice) ?? "nothing";

    const criticalAnswer = answers[`${passage.id}_critical`];
    const criticality = isNoul(criticalAnswer) ? criticalAnswer.noul : null;

    out.push({
      passage,
      kind,
      confidence: kindAnswer.confidence,
      criticality,
      // Criticality defaults to 0.5 rather than 0 when unknown: an unscored
      // passage should sort among the middle, not be silently discarded.
      priority: needWeight(kind, kindAnswer.confidence) * (criticality ?? 0.5),
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * The passages worth spending a frontier call on. `budget` is the caller's,
 * not a constant here — the room knows how many personas it is about to fan
 * out to and what that costs.
 */
export function selectForAttention(
  triaged: TriagedPassage[],
  budget: number,
  minPriority = 0.25,
): TriagedPassage[] {
  return triaged
    .filter((t) => t.kind !== "nothing" && t.priority >= minPriority)
    .slice(0, budget);
}

/* ── Offline classification ────────────────────────────────────── */

/**
 * The same label set as a flat enum, for Needle's `extract()`. Needle cannot
 * generate, but it can pick from a closed set, which is exactly this problem
 * at lower fidelity: a label, no distribution, no criticality.
 *
 * Offline results carry `confidence: null` and `criticality: null`, so
 * `priority` collapses to a constant and the ordering is arbitrary. That is
 * the honest outcome — without a criticality signal there is no ranking to
 * make, and pretending otherwise would put a made-up number in front of the
 * writer.
 */
export const TRIAGE_ENUM = TRIAGE_KINDS as readonly string[];

export function triageFromLabels(
  passages: Passage[],
  labels: Record<string, string>,
): TriagedPassage[] {
  return passages.map((passage) => {
    const raw = labels[passage.id];
    const kind = (TRIAGE_KINDS as readonly string[]).includes(raw)
      ? (raw as TriageKind)
      : "nothing";
    return {
      passage,
      kind,
      confidence: null,
      criticality: null,
      priority: kind === "nothing" ? 0 : 0.5,
    };
  });
}
