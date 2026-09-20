/**
 * Grading the rubric with System One (Jev).
 *
 * Twyne's rubric already had the shape TypeSafe's composite-scoring pattern
 * prescribes — a fixed spine of criteria, user-owned weights, a trend line —
 * and was missing only the cheap per-dimension scores underneath. The personas
 * could supply them, but a persona pass is a frontier call per criterion, so
 * it only ever ran on demand.
 *
 * One batched Jev request fills every criterion at once. Measured on the real
 * spine: **378 ms, 1,401 input tokens, $0.0000588** — about 17,000 full passes
 * per dollar. That is cheap enough to run on a pause in typing rather than on
 * a button, which is the entire point.
 *
 * The other half of this module matters more than the grading. Every raw
 * answer — score, confidence and the **full probability distribution** — is
 * cached. Weights, thresholds and confidence floors are then applied over that
 * cache by pure functions. Moving a slider re-renders the report with no
 * inference, no network and no cost, which is what makes a threshold something
 * a writer can learn by dragging instead of guess at once in a settings page.
 */

import type { RubricCriterionSpec } from "../types";
import {
  isScore,
  isBimodal,
  modalLevel,
  scoreOutOf,
  score as scoreQuestion,
  estimateCost,
  type ScoreQuestion,
  type SystemOneAnswer,
  type SystemOneUsage,
} from "./system-one";
import { clampWeight } from "./rubric-criteria";

/** Twyne's criteria are scored out of 10, matching `RubricCriterion.maxScore`. */
export const CRITERION_MAX = 10;

/**
 * The ladder, worst-first. Five levels rather than eleven: Jev returns a
 * probability-weighted value *between* levels, so the resolution comes from
 * the distribution, not from the number of rungs. Asking for eleven would
 * spread mass thinly and depress confidence without adding signal.
 *
 * The wording is deliberately about the reader's experience rather than about
 * a grade, because the model is being asked to predict a reaction.
 */
export const SCORE_LEVELS = [
  "Poor — a serious weakness a reader would notice immediately",
  "Weak — noticeably below standard",
  "Adequate — acceptable but unremarkable",
  "Strong — clearly well executed",
  "Excellent — a distinct strength of the piece",
];

/* ── Building the request ──────────────────────────────────────── */

/**
 * One Score question per enabled criterion. `engagement` is excluded for the
 * same reason `weightedCriteriaScore` excludes it: it is derived from the
 * combined grade, so scoring it here would make the grade partly a function of
 * itself.
 */
export function buildRubricQuestions(
  specs: RubricCriterionSpec[],
): Record<string, ScoreQuestion> {
  const questions: Record<string, ScoreQuestion> = {};
  for (const spec of specs) {
    if (!spec.enabled || spec.id === "engagement") continue;
    questions[spec.id] = scoreQuestion(
      `Rate the draft on ${spec.label}: ${spec.description}.`,
      SCORE_LEVELS,
    );
  }
  return questions;
}

/**
 * The evidence Jev reads. Separate keys rather than one concatenated blob so
 * the model can tell the draft apart from the brief describing it — a draft
 * that fails its own stated goal is the single most useful thing `targetFit`
 * can detect, and it cannot detect it if the goal is buried in the prose.
 */
export function buildRubricState(input: {
  draft: string;
  audience?: string;
  goal?: string;
}): Record<string, string> {
  const state: Record<string, string> = { draft: input.draft };
  if (input.audience) state.audience = input.audience;
  if (input.goal) state.goal = input.goal;
  return state;
}

/* ── Reading the answers ───────────────────────────────────────── */

/** One criterion's cached answer, kept whole so thresholds can move later. */
export interface GradedCriterion {
  id: string;
  /** Rescaled to 0–10 to match the rest of the rubric. */
  score: number;
  /** The raw probability-weighted level, 0..levels-1. */
  level: number;
  /** Distribution concentration, 0..1. Not a correctness estimate. */
  confidence: number;
  /** Level index to probability. The part a scalar throws away. */
  probabilities: Record<string, number>;
  legend: Record<string, string>;
  /** The mean sits in a trough — see `isBimodal`. */
  bimodal: boolean;
  /** Highest-mass level, which is not always the one nearest `score`. */
  modal: number;
}

/** A whole cached pass. Everything a report needs, with nothing applied yet. */
export interface RubricGrade {
  at: number;
  model: string;
  criteria: Record<string, GradedCriterion>;
  usage: SystemOneUsage;
  costUsd: number;
}

export function readRubricAnswers(
  answers: Record<string, SystemOneAnswer>,
  meta: { model: string; usage: SystemOneUsage },
): RubricGrade {
  const criteria: Record<string, GradedCriterion> = {};
  for (const [id, answer] of Object.entries(answers)) {
    // A non-Score answer here means the request and the reader disagree about
    // the question kind. Skip rather than coerce: a wrong number displayed
    // confidently is worse than a missing criterion.
    if (!isScore(answer)) continue;
    criteria[id] = {
      id,
      score: scoreOutOf(answer, CRITERION_MAX),
      level: answer.score,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      legend: answer.legend,
      bimodal: isBimodal(answer),
      modal: modalLevel(answer),
    };
  }
  return {
    at: Date.now(),
    model: meta.model,
    criteria,
    usage: meta.usage,
    costUsd: estimateCost(meta.usage),
  };
}

/* ── Applying thresholds, over the cache only ──────────────────── */

/**
 * The advanced knobs, which live in the deep report beside the evidence rather
 * than in the settings page. Every one of them is applied by the pure
 * functions below, over an already-fetched `RubricGrade`.
 */
export interface RubricThresholds {
  /**
   * Hide a criterion whose confidence is below this. Default 0 — show
   * everything and mark it — because hiding by default teaches the writer
   * nothing about why a criterion vanished.
   */
  confidenceFloor: number;
  /**
   * Below this confidence, offer to spend a frontier persona pass on the
   * criterion. Confidence tracks objectivity, so this naturally escalates the
   * subjective criteria and leaves the mechanical ones alone.
   */
  escalateBelow: number;
  /** A score at or under this is called out as a weakness. */
  weakAtOrBelow: number;
  /** A score at or above this is called out as a strength. */
  strongAtOrAbove: number;
}

export const DEFAULT_THRESHOLDS: RubricThresholds = {
  confidenceFloor: 0,
  escalateBelow: 0.5,
  weakAtOrBelow: 4,
  strongAtOrAbove: 8,
};

export type CriterionVerdict = "weak" | "strong" | "middling";

export interface CriterionView extends GradedCriterion {
  verdict: CriterionVerdict;
  /** Below the floor: shown greyed with a reason, not silently dropped. */
  belowFloor: boolean;
  /** Worth a frontier second opinion. */
  escalate: boolean;
  /** Don't trust the scalar; the distribution disagrees with it. */
  unreliableScalar: boolean;
  weight: number;
}

/**
 * Project a cached pass through the current specs and thresholds.
 *
 * Pure and synchronous by design: this is the function a slider's `onInput`
 * calls. If it ever needs to await anything, the caching design has been
 * broken and a drag will start firing network requests.
 */
export function viewRubricGrade(
  grade: RubricGrade,
  specs: RubricCriterionSpec[],
  thresholds: RubricThresholds = DEFAULT_THRESHOLDS,
): CriterionView[] {
  const views: CriterionView[] = [];
  for (const spec of specs) {
    if (!spec.enabled) continue;
    const graded = grade.criteria[spec.id];
    if (!graded) continue;
    views.push({
      ...graded,
      weight: clampWeight(spec.weight),
      belowFloor: graded.confidence < thresholds.confidenceFloor,
      escalate: graded.confidence < thresholds.escalateBelow,
      // A bimodal distribution means the weighted mean landed where the model
      // put the least mass, so the *score* is not describing the answer even
      // though it is perfectly well-formed.
      unreliableScalar: graded.bimodal,
      verdict:
        graded.score <= thresholds.weakAtOrBelow
          ? "weak"
          : graded.score >= thresholds.strongAtOrAbove
            ? "strong"
            : "middling",
    });
  }
  return views;
}

/**
 * Plain `{id: score}`, ready for the existing `weightedCriteriaScore`. Kept
 * separate so the writer's weights keep their single implementation instead of
 * gaining a second one here.
 */
export function gradeScores(grade: RubricGrade): Record<string, number> {
  return Object.fromEntries(
    Object.values(grade.criteria).map((c) => [c.id, c.score]),
  );
}

/**
 * How far the thresholds have drifted from the shipped defaults, so the report
 * can say so. A writer who has tuned four knobs and forgotten is otherwise
 * looking at a report they can no longer interpret.
 */
export function driftedKeys(t: RubricThresholds): (keyof RubricThresholds)[] {
  return (Object.keys(DEFAULT_THRESHOLDS) as (keyof RubricThresholds)[]).filter(
    (k) => t[k] !== DEFAULT_THRESHOLDS[k],
  );
}

/* ── Running a pass ────────────────────────────────────────────── */

/**
 * The transport, narrowed to what this module needs. Declared structurally
 * rather than importing the Convex client so the grading logic stays testable
 * without a backend, and so the caller decides which client instance to use.
 */
export interface JudgementCaller {
  (input: {
    state: Record<string, string>;
    questions: Record<string, ScoreQuestion>;
  }): Promise<{
    ok: boolean;
    model?: string;
    answers?: Record<string, unknown>;
    usage?: SystemOneUsage;
    error?: string;
  }>;
}

export type RubricPass =
  | { ok: true; grade: RubricGrade }
  | { ok: false; error: string };

/**
 * One batched pass over the writer's enabled criteria.
 *
 * Measured on the real spine: **378 ms, 1,401 input tokens, $0.0000588**. The
 * whole rubric is a single request because Jev evaluates every question
 * against the same state in parallel, so an eleventh criterion costs the
 * tokens of its own wording and nothing else.
 *
 * Returns a result rather than throwing. This is the second rung of a ladder
 * whose lower rung — the deterministic static score — has already produced a
 * number, so a failure here degrades the report instead of emptying it.
 */
export async function runRubricPass(
  ask: JudgementCaller,
  input: { draft: string; audience?: string; goal?: string },
  specs: RubricCriterionSpec[],
): Promise<RubricPass> {
  const questions = buildRubricQuestions(specs);
  if (Object.keys(questions).length === 0) {
    return { ok: false, error: "no criteria enabled" };
  }
  if (!input.draft.trim()) return { ok: false, error: "empty draft" };

  let response: Awaited<ReturnType<JudgementCaller>>;
  try {
    response = await ask({ state: buildRubricState(input), questions });
  } catch {
    return { ok: false, error: "unreachable" };
  }

  if (!response.ok || !response.answers) {
    return { ok: false, error: response.error ?? "no answers" };
  }
  return {
    ok: true,
    grade: readRubricAnswers(
      response.answers as Record<string, SystemOneAnswer>,
      {
        model: response.model ?? "unknown",
        usage: response.usage ?? { input_tokens: 0, output_tokens: 0 },
      },
    ),
  };
}
