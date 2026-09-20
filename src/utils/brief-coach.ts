/**
 * Helping the writer sharpen a brief, before it poisons everything downstream.
 *
 * The brief is the root input. `targetFit` grades the draft against its goal
 * and audience; the note gate vetoes advice that breaks its constraints;
 * triage weighs criticality against what the piece is trying to do. All three
 * inherit whatever vagueness the brief has. "General readers" and "make it
 * good" produce judgements that are perfectly well-formed and worth nothing,
 * and the writer has no way to see that the problem started here.
 *
 * So this grades the brief itself, field by field, and says which answers are
 * carrying weight and which are decoration.
 *
 * **What Jev can and cannot do here, stated plainly**, because it would be
 * easy to design past it: Jev does not generate text. It cannot write "your
 * audience is too broad — who specifically?" It can only score and classify.
 * Every hint in this module is therefore authored in code and selected by a
 * classification. That is a real limit, and it is also why the level
 * descriptions below are written as diagnoses rather than grades — the level a
 * field lands on *is* the explanation the writer gets.
 */

import type { ProjectBrief, ProjectInterviewAnswers } from "../types";
import {
  noul,
  choice as choiceQuestion,
  score as scoreQuestion,
  isScore,
  isChoice,
  isNoul,
  scoreOutOf,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "./system-one";

/* ── Field sufficiency ─────────────────────────────────────────── */

/**
 * Worst-first. The discriminator between "Specific" and "Sharp" is whether
 * the answer *excludes* anything: a brief answer that rules nothing out cannot
 * be failed by any draft, and a criterion no draft can fail is not a criterion.
 */
const SUFFICIENCY_LEVELS = [
  "Missing — there is nothing usable here",
  "Vague — this could describe almost any piece",
  "Partial — a direction, but the key decision is still open",
  "Specific — a writer could act on this without asking a follow-up",
  "Sharp — it rules things out, not just in",
];

/** The seven interview fields, with what each is actually for. */
const FIELD_PROMPTS: Record<keyof ProjectInterviewAnswers, string> = {
  workingTitle:
    "the working title — whether it says what the piece is about, rather than gesturing at a topic",
  format:
    "the format — whether the length, shape and venue are clear enough to write to",
  audience:
    "the audience — whether it identifies actual readers with particular prior knowledge, rather than a demographic",
  goal: "the goal — whether it says what the piece should accomplish, not merely what it should cover",
  tone: "the tone — whether it distinguishes this piece from a generically well-written one",
  constraints:
    "the constraints — whether a reader could check a draft against them and say yes or no",
  successSignal:
    "the success signal — whether it names something observable that would show the piece worked",
};

export const BRIEF_FIELDS = Object.keys(
  FIELD_PROMPTS,
) as (keyof ProjectInterviewAnswers)[];

/* ── Constraint interrogation ──────────────────────────────────── */

/**
 * "Is this a real non-negotiable?" — the question the writer asked for.
 *
 * It matters mechanically, not just editorially. The note gate vetoes any
 * persona note that breaks a constraint, so a *preference* recorded as a
 * constraint will silently suppress good advice, and an *uncheckable*
 * constraint will make the veto fire at random. Sorting these is what keeps
 * that gate honest.
 */
const CONSTRAINT_KINDS = [
  "hard", // external, not the writer's to relax
  "editorial", // the writer's firm choice
  "preference", // would rather, but the piece survives
  "uncheckable", // cannot tell whether a draft complies
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

const CONSTRAINT_OPTIONS = [
  "Hard — imposed from outside (legal, contractual, platform, factual) and not the writer's to relax",
  "Editorial — the writer's own firm decision about what this piece is",
  "Preference — the writer would rather, but the piece still works if it is broken",
  "Uncheckable — no one could look at a draft and say whether it complies",
];

const CONSTRAINT_TO_KIND = new Map<string, ConstraintKind>(
  CONSTRAINT_OPTIONS.map((label, i) => [label, CONSTRAINT_KINDS[i]]),
);

/** One constraint per line or bullet; that is how writers actually type them. */
export function splitConstraints(text: string): string[] {
  return text
    .split(/\n+|(?:^|\s)[•·–—-]\s+|;\s*/)
    .map((s) => s.trim().replace(/^[-•·–—]\s*/, ""))
    .filter((s) => s.length > 3)
    .slice(0, 12);
}

/* ── Questions ─────────────────────────────────────────────────── */

export function buildBriefState(brief: ProjectBrief): Record<string, string> {
  const state: Record<string, string> = {};
  for (const field of BRIEF_FIELDS) {
    const value = brief.answers[field];
    if (value) state[field] = value;
  }
  // Attachments are part of the brief's information content: a thin `goal`
  // backed by three annotated sources is not the same as a thin goal alone.
  if (brief.attachments.length) {
    state.attachments = brief.attachments
      .map((a) => `${a.title}: ${a.why}`)
      .join("\n");
  }
  return state;
}

export function buildBriefQuestions(
  brief: ProjectBrief,
): Record<string, SystemOneQuestion> {
  const questions: Record<string, SystemOneQuestion> = {};

  for (const field of BRIEF_FIELDS) {
    if (!brief.answers[field]) continue;
    questions[`field_${field}`] = scoreQuestion(
      `Rate ${FIELD_PROMPTS[field]}.`,
      SUFFICIENCY_LEVELS,
    );
  }

  // The whole-brief question is deliberately not the mean of the fields. A
  // brief can have seven adequate answers and still not say what the piece is,
  // and the sum is the thing the writer actually needs to know about.
  questions.sufficient = noul(
    "Could a competent writer who has never spoken to this person produce the intended piece from this brief alone, without asking a follow-up question?",
  );
  questions.contradictory = noul(
    "Do any two parts of this brief pull against each other — for example a tone that fights the goal, or a constraint that makes the success signal unreachable?",
  );

  const constraintTexts = splitConstraints(brief.answers.constraints ?? "");
  for (let i = 0; i < constraintTexts.length; i++) {
    questions[`constraint_${i}`] = choiceQuestion(
      `The writer listed this as a constraint: "${constraintTexts[i]}". Which kind is it?`,
      CONSTRAINT_OPTIONS,
    );
  }

  return questions;
}

/* ── Results ───────────────────────────────────────────────────── */

export interface FieldAssessment {
  field: keyof ProjectInterviewAnswers;
  /** 0–10. */
  score: number;
  confidence: number;
  /** The level it landed on — this is the explanation shown to the writer. */
  diagnosis: string;
  /** Worth prompting the writer about. */
  needsWork: boolean;
}

export interface ConstraintAssessment {
  text: string;
  kind: ConstraintKind;
  confidence: number;
  /** True non-negotiables are the ones the note gate should veto on. */
  enforceable: boolean;
  hint: string;
}

export interface BriefAssessment {
  fields: FieldAssessment[];
  constraints: ConstraintAssessment[];
  /** Probability a stranger could write the piece from this brief. */
  sufficiency: number | null;
  /** Probability two parts of the brief pull against each other. */
  contradiction: number | null;
  /** Fields to prompt on, weakest first. */
  weakest: FieldAssessment[];
}

/** Below this a field is worth prompting about. */
const NEEDS_WORK_BELOW = 5;

/**
 * The hints. Authored here rather than generated, for the reason given at the
 * top of the file — Jev classifies, it does not write.
 */
const CONSTRAINT_HINTS: Record<ConstraintKind, string> = {
  hard: "A real non-negotiable. Advice that breaks it will be suppressed.",
  editorial:
    "Your call rather than an external rule — still enforced, but you can relax it if the piece needs it.",
  preference:
    "This reads as a preference. Left as a constraint it will suppress advice that might have been worth hearing; consider moving it to tone.",
  uncheckable:
    "No one could look at a draft and say whether this was met, so it cannot be enforced. Restate it as something observable.",
};

export function readBriefAssessment(
  brief: ProjectBrief,
  answers: Record<string, SystemOneAnswer>,
): BriefAssessment {
  const fields: FieldAssessment[] = [];
  for (const field of BRIEF_FIELDS) {
    const a = answers[`field_${field}`];
    if (!isScore(a)) continue;
    const score = scoreOutOf(a, 10);
    fields.push({
      field,
      score,
      confidence: a.confidence,
      diagnosis: a.legend[String(Math.round(a.score))] ?? "",
      needsWork: score < NEEDS_WORK_BELOW,
    });
  }

  const constraints: ConstraintAssessment[] = [];
  const constraintTexts = splitConstraints(brief.answers.constraints ?? "");
  for (let i = 0; i < constraintTexts.length; i++) {
    const text = constraintTexts[i];
    const a = answers[`constraint_${i}`];
    if (!isChoice(a)) continue;
    const kind = CONSTRAINT_TO_KIND.get(a.choice) ?? "editorial";
    constraints.push({
      text,
      kind,
      confidence: a.confidence,
      // Preferences and uncheckable statements must not drive the veto: the
      // first suppresses advice the writer would have wanted, the second fires
      // arbitrarily because there is nothing to check against.
      enforceable: kind === "hard" || kind === "editorial",
      hint: CONSTRAINT_HINTS[kind],
    });
  }

  const sufficientAnswer = answers.sufficient;
  const contradictoryAnswer = answers.contradictory;

  return {
    fields,
    constraints,
    sufficiency: isNoul(sufficientAnswer) ? sufficientAnswer.noul : null,
    contradiction: isNoul(contradictoryAnswer)
      ? contradictoryAnswer.noul
      : null,
    weakest: fields
      .filter((f) => f.needsWork)
      .sort((a, b) => a.score - b.score),
  };
}

/**
 * The constraints the note gate should actually enforce. Feeding it the raw
 * `constraints` string means enforcing preferences and uncheckable wishes
 * alike; this is the filtered set.
 */
export function enforceableConstraints(a: BriefAssessment): string[] {
  return a.constraints.filter((c) => c.enforceable).map((c) => c.text);
}

/**
 * Whether the brief is solid enough that downstream judgements mean anything.
 * When this is false, `targetFit` and the note-gate veto are measuring the
 * brief's vagueness rather than the draft's quality, and the honest move is to
 * say so instead of showing a confident-looking score.
 */
export function briefIsLoadBearing(a: BriefAssessment): boolean {
  if (a.sufficiency !== null && a.sufficiency < 0.4) return false;
  const graded = a.fields.filter((f) =>
    ["audience", "goal", "successSignal"].includes(f.field),
  );
  if (graded.length === 0) return false;
  return graded.every((f) => f.score >= NEEDS_WORK_BELOW);
}
