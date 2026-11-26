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
 * So this grades the filed brief, field by field, inside live review. It
 * asks exactly the questions the brief form asks while the writer types
 * (`brief-strength`), against the same checklists (`brief-facets`), so a
 * brief cannot read Specific at the desk and Vague in review.
 *
 * **What Jev can and cannot do here, stated plainly**, because it would be
 * easy to design past it: Jev does not generate text. It cannot write "your
 * audience is too broad — who specifically?" It can only score and classify.
 * Every hint is therefore authored in code and selected by a classification.
 */

import type {
  ConstraintKind,
  ConstraintTriage,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../types";
import {
  BRIEF_FIELD_ORDER,
  CONSTRAINT_NOTES,
  LEVEL_DIAGNOSES,
  LOAD_BEARING,
  STRENGTH_LABELS,
  STRONG_ENOUGH,
  WRITER_SET,
  isBinding,
  splitConstraints,
  type BriefField,
  type StrengthLevel,
} from "./brief-facets";
import {
  briefStanding,
  buildBriefStrengthQuestions,
  constraintsStrength,
  readBriefStrengths,
  type BriefStanding,
  type FacetView,
  type LineReading,
  type Tension,
} from "./brief-strength";
import type { SystemOneAnswer, SystemOneQuestion } from "./system-one";

export { splitConstraints };
export type { ConstraintKind };

/* ── Field sufficiency ─────────────────────────────────────────── */

/**
 * The five levels, worst first. The discriminator between "Specific" and
 * "Sharp" is whether the answer *excludes* anything: a brief answer that
 * rules nothing out cannot be failed by any draft, and a criterion no draft
 * can fail is not a criterion.
 */
export const SUFFICIENCY_LEVELS = STRENGTH_LABELS.map(
  (label, level) => `${label} — ${LEVEL_DIAGNOSES[level]}`,
);

/** The seven interview fields, with what each is actually for. */
export const FIELD_PROMPTS: Record<keyof ProjectInterviewAnswers, string> = {
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

/**
 * The form's own questions, for every field at once. The whole-brief
 * questions are always asked: a filed brief can have seven adequate answers
 * and still not say what the piece is.
 */
export function buildBriefQuestions(
  brief: ProjectBrief,
): Record<string, SystemOneQuestion> {
  return buildBriefStrengthQuestions(brief.answers, BRIEF_FIELDS, {
    whole: true,
  });
}

/* ── Results ───────────────────────────────────────────────────── */

export interface FieldAssessment {
  field: BriefField;
  level: StrengthLevel;
  /** "Vague", "Partial"… */
  label: string;
  /** 0–10, for callers that still think in rubric points. */
  score: number;
  /** The one thing to add; this is the explanation shown to the writer. */
  diagnosis: string;
  /** The checklist the level came from. Empty for constraints. */
  facets: FacetView[];
  /** A facet the level turns on was a close call. */
  uncertain: boolean;
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
  /** Probability the brief tells a stranger who reads it, what for, and how to tell. */
  sufficiency: number | null;
  /** Probability two parts of the brief pull against each other. */
  contradiction: number | null;
  /** The pair that pulls apart, when one does. */
  tension: Tension | null;
  /** Reader, goal and landing, and whether the brief bears weight. */
  standing: BriefStanding;
  /** Fields to prompt on, weakest first, load-bearing ones ahead of the rest. */
  weakest: FieldAssessment[];
}

const bearing = new Set<BriefField>(LOAD_BEARING);

export function readBriefAssessment(
  brief: ProjectBrief,
  answers: Record<string, SystemOneAnswer>,
): BriefAssessment {
  const reading = readBriefStrengths(brief.answers, BRIEF_FIELDS, answers);

  // A kind the writer set by hand outranks a new reading of the same line.
  const lines: Record<string, LineReading> = { ...reading.lines };
  for (const line of brief.constraintTriage?.lines ?? [])
    if (line.confidence === WRITER_SET && line.text in lines)
      lines[line.text] = { kind: line.kind, confidence: WRITER_SET };

  const fields: FieldAssessment[] = [];
  const assess = (
    field: BriefField,
    level: StrengthLevel,
    hint: string | null,
    facets: FacetView[] = [],
    uncertain = false,
  ) =>
    fields.push({
      field,
      level,
      label: STRENGTH_LABELS[level],
      score: level * 2.5,
      diagnosis: hint ?? LEVEL_DIAGNOSES[level],
      facets,
      uncertain,
      // The three load-bearing answers must reach Specific; elsewhere only a
      // Vague answer is worth interrupting the writer for.
      needsWork: level < (bearing.has(field) ? STRONG_ENOUGH : 2),
    });
  for (const field of BRIEF_FIELD_ORDER) {
    if (field === "constraints") continue;
    const read = reading.fields[field];
    if (read)
      assess(field, read.level, read.hint, read.facets, !!read.uncertain);
  }

  const constraints: ConstraintAssessment[] = [];
  const texts = splitConstraints(brief.answers.constraints ?? "");
  for (const text of texts) {
    const line = lines[text];
    if (!line) continue;
    constraints.push({
      text,
      kind: line.kind,
      confidence: line.confidence,
      // Preferences and uncheckable statements must not drive the veto: the
      // first suppresses advice the writer would have wanted, the second fires
      // arbitrarily because there is nothing to check against.
      enforceable: isBinding(line.kind),
      hint: CONSTRAINT_NOTES[line.kind],
    });
  }
  if (texts.length > 0 && constraints.length === texts.length) {
    const view = constraintsStrength(brief.answers.constraints ?? "", lines);
    assess("constraints", view.level, view.hint);
  }

  const levels: Parameters<typeof briefStanding>[0]["levels"] = {};
  for (const field of LOAD_BEARING) {
    const read = reading.fields[field];
    if (read) levels[field] = { level: read.level, confirmed: true };
  }
  const standing = briefStanding({
    levels,
    sufficiency: reading.sufficiency,
    contradiction: reading.contradiction,
    uncheckable: constraints.filter((c) => c.kind === "uncheckable").length,
  });

  return {
    fields,
    constraints,
    sufficiency: reading.sufficiency,
    contradiction: reading.contradiction,
    tension: reading.tension,
    standing,
    weakest: fields
      .filter((f) => f.needsWork)
      .sort(
        (a, b) =>
          Number(bearing.has(b.field)) - Number(bearing.has(a.field)) ||
          a.level - b.level,
      ),
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
 * Whether the brief is solid enough that downstream judgements mean anything:
 * reader, goal and landing each read Specific or better, the brief tells a
 * stranger enough to write from, no two answers pull apart, and no rule the
 * writer believes binding is one the room cannot check. When this is false,
 * `targetFit` and the note-gate veto are measuring the brief's vagueness
 * rather than the draft's quality, and the honest move is to say so instead
 * of showing a confident-looking score.
 */
export function briefIsLoadBearing(a: BriefAssessment): boolean {
  return a.standing.loadBearing;
}

/** What to say beside a judgement made against a brief that does not hold. */
export const SOFT_BRIEF_NOTE = "Measured against a soft brief";

/**
 * The line to put beside `targetFit` when the brief is not load-bearing, with
 * what is soft about it; null when the brief holds and the score stands.
 */
export function softBriefNote(a: BriefAssessment): string | null {
  if (briefIsLoadBearing(a)) return null;
  const why = a.standing.soft.join("; ");
  return why ? `${SOFT_BRIEF_NOTE}: ${why}.` : `${SOFT_BRIEF_NOTE}.`;
}

/* ── Persisted triage → note gate ──────────────────────────────── */

/** An assessment's constraint reading, pinned to the text it read. */
export function triageFromAssessment(
  brief: ProjectBrief,
  a: BriefAssessment,
): ConstraintTriage | null {
  if (a.constraints.length === 0) return null;
  return {
    source: brief.answers.constraints ?? "",
    lines: a.constraints.map(({ text, kind, confidence }) => ({
      text,
      kind,
      confidence,
    })),
    at: Date.now(),
  };
}

/**
 * What the note gate should veto on. With a current triage, only hard and
 * editorial lines veto; preferences travel separately as context that
 * weighs a note rather than killing it; uncheckable lines are dropped, since
 * a veto against something no one can check fires at random. Without a
 * current triage the raw text is the veto set, as before.
 */
export function noteGateConstraints(brief: ProjectBrief | null | undefined): {
  veto: string;
  preferences: string;
} {
  const raw = brief?.answers.constraints?.trim() ?? "";
  const triage = brief?.constraintTriage;
  if (!raw || !triage || triage.source.trim() !== raw)
    return { veto: raw, preferences: "" };
  const lines = (kinds: ConstraintKind[]) =>
    triage.lines
      .filter((line) => kinds.includes(line.kind))
      .map((line) => `- ${line.text}`)
      .join("\n");
  return {
    veto: lines(["hard", "editorial"]),
    preferences: lines(["preference"]),
  };
}
