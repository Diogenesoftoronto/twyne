/**
 * TypeSafe "System One" (Jev) — typed questions and answers.
 *
 * Jev does not generate text. It answers a fixed set of questions about some
 * state, and returns a calibrated probability distribution for each one. That
 * is the whole surface: three question kinds, three answer shapes.
 *
 *   Noul    probability of yes, 0..1
 *   Choice  pick one option, plus the probability of every option
 *   Score   ordered levels, returning a probability-weighted value
 *
 * This module is transport-free on purpose. It builds requests and reads
 * answers; `convex/systemOne.ts` is the only place that holds the API key and
 * talks to the network, because the key must never reach the browser bundle.
 *
 * Costs, measured against the live API rather than quoted from the docs: the
 * full 11-criterion rubric spine batched into one request took 378 ms and
 * 1,401 input tokens — $0.0000588, or roughly 17,000 rubric passes per dollar.
 * Output tokens are free. This is cheap enough to run on a typing pause.
 */

/* ── Questions ─────────────────────────────────────────────────── */

/** Probability that the answer is yes. */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

/** Pick exactly one of `criteria`. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: string[];
}

/**
 * Ordered levels, worst first. The answer is a probability-weighted value
 * across them, so it can land between two levels.
 */
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/**
 * One request. Independent questions over the same `state` run in parallel
 * and barely change latency, so batch aggressively — but they cannot see each
 * other's answers. A second round-trip is only justified when an answer is
 * needed to *fetch* new evidence.
 *
 * Budget: 64k context per request, of which 32k is for `state`.
 */
export interface SystemOneRequest {
  model?: string;
  state: Record<string, unknown>;
  questions: Record<string, SystemOneQuestion>;
}

/* ── Answers ───────────────────────────────────────────────────── */

export interface NoulAnswer {
  type: "noul";
  /** 0 (no) to 1 (yes). */
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  /** The highest-probability option. */
  choice: string;
  /** Every option mapped to its probability; sums to 1. */
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted across levels; can land between them. */
  score: number;
  /** Level index (as a string key) back to its description. */
  legend: Record<string, string>;
  /** Level index to probability; sums to 1. */
  probabilities: Record<string, number>;
  confidence: number;
}

export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: SystemOneUsage;
}

/** Input tokens only — output is not billed. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export function estimateCost(usage: SystemOneUsage): number {
  return usage.input_tokens * USD_PER_INPUT_TOKEN;
}

/* ── Builders ──────────────────────────────────────────────────── */

export function noul(instructions: string): NoulQuestion {
  return { type: "noul", instructions };
}

export function choice(
  instructions: string,
  criteria: string[],
): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

/** `criteria` must be ordered worst-to-best; the index is the level. */
export function score(instructions: string, criteria: string[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}

/* ── Reading answers ───────────────────────────────────────────── */

export function isNoul(a: SystemOneAnswer | undefined): a is NoulAnswer {
  return a?.type === "noul";
}

export function isChoice(a: SystemOneAnswer | undefined): a is ChoiceAnswer {
  return a?.type === "choice";
}

export function isScore(a: SystemOneAnswer | undefined): a is ScoreAnswer {
  return a?.type === "score";
}

/**
 * Whether a Score's distribution is bimodal — mass at both ends with a trough
 * in the middle, which is exactly where the weighted mean lands.
 *
 * This is not hypothetical. A measured answer came back `score: 1.43`,
 * `confidence: 0.14`, `probabilities: {0: 0.21, 1: 0.16, 2: 0.63}`: the scalar
 * points at the level the model assigned the *least* mass to. Any threshold on
 * the scalar alone would have been wrong. Callers below their confidence floor
 * should branch on the distribution or decline to show a grade at all.
 */
export function isBimodal(answer: ScoreAnswer): boolean {
  const levels = Object.keys(answer.probabilities)
    .map(Number)
    .sort((a, b) => a - b);
  if (levels.length < 3) return false;

  const nearest = Math.round(answer.score);
  const pAtMean = answer.probabilities[String(nearest)] ?? 0;
  const peak = Math.max(...Object.values(answer.probabilities));

  // The mean sits in a trough: some level is at least twice as likely as the
  // one the mean actually names.
  return peak > pAtMean * 2;
}

/**
 * The level the model gave the most mass to, which is not always the level
 * nearest `score`. Use this when `isBimodal` is true and you still must pick.
 */
export function modalLevel(answer: ScoreAnswer): number {
  let best = 0;
  let bestP = -1;
  for (const [level, p] of Object.entries(answer.probabilities)) {
    if (p > bestP) {
      bestP = p;
      best = Number(level);
    }
  }
  return best;
}

/**
 * Rescale a Score onto 0..max (Twyne's rubric is 0–10) using the number of
 * levels the question declared, not a hardcoded assumption.
 */
export function scoreOutOf(answer: ScoreAnswer, max: number): number {
  const levels = Object.keys(answer.legend).length;
  if (levels < 2) return 0;
  return (answer.score / (levels - 1)) * max;
}

/* ── Confidence semantics ──────────────────────────────────────── */

/**
 * What `confidence` does and does not mean, kept here so call sites cannot
 * quietly reinvent it:
 *
 * - For a Noul there is no confidence field at all. A Noul near 0.5 means
 *   *equally likely yes or no* — it does not mean "medium intensity". Reading
 *   a Noul as a magnitude is the most common way to misuse this API.
 * - For Choice and Score, confidence measures how concentrated the probability
 *   distribution is. It is **not** a correctness estimate and **not**
 *   permission to act. Low confidence often just means several answers are
 *   equally fine.
 *
 * Empirically this tracks objectivity, which is the useful part: on a
 * deliberately bad draft, `integrity` scored 0.01 at confidence 0.99 while the
 * genuinely subjective `targetFit` scored 2.38 at confidence 0.43. That makes
 * confidence a good trigger for escalating to a frontier model, and a bad
 * trigger for taking an action on the user's behalf.
 */
export function confidenceOf(answer: SystemOneAnswer): number | null {
  return isNoul(answer) ? null : answer.confidence;
}
