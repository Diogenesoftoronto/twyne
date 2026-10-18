/**
 * Answer strength for the brief, shown while the writer is still answering.
 *
 * `brief-coach` grades a filed brief inside live review, which is too late to
 * be useful at the desk where the brief is written. This is the same rubric
 * worn as a strength meter: every brief answer lands on one of the coach's
 * five levels (Missing → Sharp) and carries one concrete thing to add.
 *
 * Two readers, like a password meter that checks locally before the server
 * does:
 *
 * - **Quick read**, here, on every keystroke. Pure heuristics — length,
 *   generic stand-ins ("general readers", "make it engaging"), and whether
 *   the answer rules anything out. Works offline and for guests.
 * - **Jev**, on a typing pause. The coach's per-field Score plus a Choice
 *   naming what the answer is missing. Jev does not write, so every hint is
 *   authored below and selected by that Choice.
 *
 * A Jev reading is only shown for the exact text it read; the moment the
 * writer types again the quick read takes over until Jev catches up.
 */

import type { ProjectInterviewAnswers } from "../types";
import { FIELD_PROMPTS, SUFFICIENCY_LEVELS } from "./brief-coach";
import {
  choice as choiceQuestion,
  isBimodal,
  isChoice,
  isNoul,
  isScore,
  modalLevel,
  noul,
  score as scoreQuestion,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "./system-one";

export type BriefField = keyof ProjectInterviewAnswers;

/** 0 Missing · 1 Vague · 2 Partial · 3 Specific · 4 Sharp. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export const STRENGTH_LABELS = [
  "Missing",
  "Vague",
  "Partial",
  "Specific",
  "Sharp",
] as const;

/** At or above this an answer is carrying its weight. */
export const STRONG_ENOUGH: StrengthLevel = 3;

export interface StrengthView {
  level: StrengthLevel;
  label: (typeof STRENGTH_LABELS)[number];
  /** What the level means for this answer. */
  diagnosis: string;
  /** The one thing to add, or null when nothing is worth asking for. */
  hint: string | null;
  source: "quick" | "jev";
  /** Jev's distribution was split; the level is its best guess. */
  uncertain?: boolean;
}

/** A Jev reading, pinned to the text it read. */
export interface JudgedStrength extends StrengthView {
  source: "jev";
  value: string;
}

/* ── Authored hints ────────────────────────────────────────────── */

/** What to add next, by field, for the quick read's weak and middle levels. */
const QUICK_HINTS: Record<BriefField, { weak: string; partial: string }> = {
  workingTitle: {
    weak: "Give it a name that hints at the angle, not just the subject.",
    partial:
      "Could the title only belong to this piece? Push it toward the claim.",
  },
  format: {
    weak: "Say the shape: essay, memo, chapter, dispatch — and roughly how long.",
    partial:
      "Add the length or where it will run, so the room can write to size.",
  },
  audience: {
    weak: "Picture one reader. What do they already know, and what do they doubt?",
    partial:
      "Say what this reader already believes or resists, not just who they are.",
  },
  goal: {
    weak: "Say what should change for the reader, not what the piece will cover.",
    partial:
      "Pick the one result that matters most if the others don't happen.",
  },
  tone: {
    weak: "Name how it should feel in a way a generic good piece wouldn't.",
    partial:
      "Add what the voice must avoid — that's what makes a tone checkable.",
  },
  constraints: {
    weak: "List the rules a draft could break: sources, length, words to avoid.",
    partial:
      "Make each one checkable — could someone say yes or no against a draft?",
  },
  successSignal: {
    weak: "Describe something you could observe the reader do or say afterward.",
    partial: "Add a threshold: when would you know it worked well enough?",
  },
};

/**
 * What Jev may say an answer is missing. The last option of each list is the
 * "nothing" option; its hint is null so a complete answer is left alone.
 */
const FIELD_GAPS: Record<
  BriefField,
  { question: string; gaps: Array<[option: string, hint: string | null]> }
> = {
  workingTitle: {
    question: "What, if anything, is the working title missing?",
    gaps: [
      [
        "It names a topic but not what the piece says about it",
        "Try a title that hints at the claim, not just the subject.",
      ],
      [
        "It is a placeholder that could sit on any piece",
        "Even a rough title that commits to an angle helps the room.",
      ],
      ["Nothing important — it already says what the piece is", null],
    ],
  },
  format: {
    question: "What, if anything, is the format answer missing?",
    gaps: [
      [
        "It gives no length or scale",
        "Add a rough length — a page, 1,500 words, a chapter.",
      ],
      [
        "It says nothing about where the piece will run",
        "Say where it will live: a newsletter, a journal, a deck, a talk.",
      ],
      [
        "It gives no structural shape (argument, narrative, list, report)",
        "Name the shape — argument, story, explainer, report.",
      ],
      ["Nothing important — a writer could write to this format", null],
    ],
  },
  audience: {
    question: "What, if anything, is the audience answer missing?",
    gaps: [
      [
        "It names a demographic or category, not an actual reader",
        "Swap the category for one reader you could picture across a table.",
      ],
      [
        "It says nothing about what the reader already knows",
        "Say what this reader already knows, so the room knows what to skip.",
      ],
      [
        "It says nothing about what the reader doubts, resists or wants",
        "Add what this reader is skeptical of or wants from the piece.",
      ],
      ["Nothing important — a writer could picture this reader", null],
    ],
  },
  goal: {
    question: "What, if anything, is the goal answer missing?",
    gaps: [
      [
        "It describes a topic to cover rather than a change to cause",
        "Say what the reader should believe, feel or do afterward — not the topic.",
      ],
      [
        "It lists several goals without saying which one wins",
        "Choose the one result that matters if the others don't happen.",
      ],
      [
        "It never says what the reader should do or think afterward",
        "Finish the sentence: after reading, they will…",
      ],
      ["Nothing important — the goal is clear and singular", null],
    ],
  },
  tone: {
    question: "What, if anything, is the tone answer missing?",
    gaps: [
      [
        "It lists virtues every good piece has (clear, engaging, professional)",
        "Name what makes this voice different from any well-written piece.",
      ],
      [
        "It says nothing about what the voice must avoid",
        "Add one thing the voice must never do — preach, hedge, joke, gush.",
      ],
      [
        "It pulls against the goal or the reader",
        "Check the tone against the reader: would they trust this voice?",
      ],
      ["Nothing important — the tone distinguishes this piece", null],
    ],
  },
  constraints: {
    question: "What, if anything, is the constraints answer missing?",
    gaps: [
      [
        "They are preferences dressed as rules",
        "Keep only what the piece fails without; move wishes to tone.",
      ],
      [
        "Nothing in them could be checked against a draft",
        "Restate each as something a reader could check yes or no.",
      ],
      [
        "They leave out sources or material that must stay",
        "Name the sources, quotes or passages the draft must keep.",
      ],
      ["Nothing important — they are real and checkable", null],
    ],
  },
  successSignal: {
    question: "What, if anything, is the success signal missing?",
    gaps: [
      [
        "It describes a feeling rather than something observable",
        "Describe something you could see happen — a reply, a decision, a retelling.",
      ],
      [
        "It is observed by the writer, not something the reader does",
        "Move it to the reader's side: what do they do or say?",
      ],
      [
        "It has no threshold for when it has worked enough",
        "Add a threshold — how many, by when, or how far.",
      ],
      ["Nothing important — anyone could tell whether it happened", null],
    ],
  },
};

const DIAGNOSES = SUFFICIENCY_LEVELS.map((level) =>
  level.replace(/^[^—]+—\s*/, ""),
);

/* ── Quick read ────────────────────────────────────────────────── */

const GENERIC: Partial<Record<BriefField, RegExp>> = {
  audience:
    /\b(everyone|anyone|anybody|general (?:public|readers?|audience)|the public|people|all ages|readers|a wide audience)\b/i,
  goal: /\b(inform|explore|discuss|talk about|cover|write about|be (?:good|interesting|engaging))\b/i,
  tone: /\b(good|nice|engaging|professional|clear|interesting|friendly|informative|well[- ]written)\b/i,
  constraints: /^(?:none|n\/?a|nothing|no constraints?)\.?$/i,
  successSignal:
    /\b(people like it|they (?:like|enjoy) it|it'?s good|engagement|it goes viral|it resonates)\b/i,
  workingTitle:
    /^(?:untitled|draft|essay|new (?:piece|essay|project)|tbd|title)$/i,
};

/** Words that rule something out: the coach's line between Specific and Sharp. */
const EXCLUDES =
  /\b(not|never|no|without|instead of|rather than|avoid|don'?t|only|except|unless|but)\b/i;

/** Field-specific signs of a concrete answer. */
const CONCRETE: Partial<Record<BriefField, RegExp>> = {
  audience:
    /\b(who|already|knows?|has|have|new to|skeptic\w*|doubt\w*|works? (?:in|at|as))\b/i,
  goal: /\b(so that|convince|persuade|decide|change|believe|act|sign|vote|adopt|stop|start|understand why)\b/i,
  format:
    /\d|\b(words?|pages?|minutes?|chapter|newsletter|journal|blog|deck|talk|op-?ed|column|report|memo|letter)\b/i,
  successSignal:
    /\d|\b(can|will|reply|replies|sign|share|state|explain|ask|buy|cite|forward|decide|retell|quote)\b/i,
  constraints:
    /\d|\b(must|cite|source|quote|keep|under|over|max|minimum|deadline)\b/i,
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clampLevel(n: number): StrengthLevel {
  return Math.max(0, Math.min(4, Math.round(n))) as StrengthLevel;
}

function view(
  level: StrengthLevel,
  hint: string | null,
  source: StrengthView["source"],
  uncertain?: boolean,
): StrengthView {
  return {
    level,
    label: STRENGTH_LABELS[level],
    diagnosis: DIAGNOSES[level] ?? "",
    hint: level >= 4 ? null : hint,
    source,
    ...(uncertain ? { uncertain } : {}),
  };
}

/**
 * The instant local read. Deliberately conservative at the top: a heuristic
 * cannot tell "Specific" from "Sharp" reliably, so only an answer that is
 * long, concrete, and rules something out reaches level 4.
 */
export function quickFieldStrength(
  field: BriefField,
  raw: string,
): StrengthView {
  const value = raw.trim();
  if (!value) return view(0, QUICK_HINTS[field].weak, "quick");
  const words = wordCount(value);
  const generic = GENERIC[field]?.test(value) ?? false;
  const concrete = CONCRETE[field]?.test(value) ?? false;
  const excludes = EXCLUDES.test(value);

  let level: number;
  if (field === "workingTitle") {
    level = generic ? 1 : words >= 3 ? 3 : 2;
  } else if (field === "format") {
    level = words <= 1 ? 2 : concrete ? 3 : 2;
    if (concrete && words >= 4 && excludes) level = 4;
  } else {
    level = words < 4 ? 1 : words < 9 ? 2 : 3;
    if (concrete) level += 1;
    if (generic) level -= words < 12 ? 2 : 1;
    level = Math.min(level, 3);
    if (level >= 3 && excludes && words >= 10) level = 4;
  }

  const final = clampLevel(Math.max(1, level));
  return view(
    final,
    final <= 1 ? QUICK_HINTS[field].weak : QUICK_HINTS[field].partial,
    "quick",
  );
}

/* ── Jev ───────────────────────────────────────────────────────── */

export function buildBriefStrengthState(
  answers: ProjectInterviewAnswers,
): Record<string, string> {
  const state: Record<string, string> = {};
  for (const [field, value] of Object.entries(answers)) {
    const text = String(value ?? "").trim();
    if (text) state[field] = text.slice(0, 4_000);
  }
  return state;
}

/**
 * One batched request: a Score and a gap Choice per requested field, plus the
 * coach's whole-brief sufficiency once there is enough brief to judge.
 */
export function buildBriefStrengthQuestions(
  answers: ProjectInterviewAnswers,
  fields: ReadonlyArray<BriefField>,
): Record<string, SystemOneQuestion> {
  const questions: Record<string, SystemOneQuestion> = {};
  for (const field of fields) {
    if (!answers[field]?.trim()) continue;
    questions[`score_${field}`] = scoreQuestion(
      `Rate ${FIELD_PROMPTS[field]}, judging the \`${field}\` entry in the context of the rest of the brief.`,
      SUFFICIENCY_LEVELS,
    );
    questions[`gap_${field}`] = choiceQuestion(
      `${FIELD_GAPS[field].question} Judge the \`${field}\` entry only.`,
      FIELD_GAPS[field].gaps.map(([option]) => option),
    );
  }
  if (filledFieldCount(answers) >= 4) {
    questions.sufficient = noul(
      "Could a competent writer who has never spoken to this person produce the intended piece from this brief alone, without asking a follow-up question?",
    );
  }
  return questions;
}

/** Below this concentration a gap Choice is a guess, not a diagnosis. */
const GAP_CONFIDENCE_FLOOR = 0.3;
/** Below this a split Score is reported as uncertain. */
const SCORE_CONFIDENCE_FLOOR = 0.35;

export function readBriefStrengths(
  answers: ProjectInterviewAnswers,
  fields: ReadonlyArray<BriefField>,
  response: Record<string, SystemOneAnswer>,
): {
  fields: Partial<Record<BriefField, JudgedStrength>>;
  sufficiency: number | null;
} {
  const out: Partial<Record<BriefField, JudgedStrength>> = {};
  for (const field of fields) {
    const scored = response[`score_${field}`];
    if (!isScore(scored)) continue;
    // A split distribution's mean names the level the model believed least;
    // use the mode instead and say it was a close call.
    const split =
      isBimodal(scored) && scored.confidence < SCORE_CONFIDENCE_FLOOR;
    const level = clampLevel(split ? modalLevel(scored) : scored.score);

    const gapAnswer = response[`gap_${field}`];
    const gaps = FIELD_GAPS[field].gaps;
    let hint: string | null =
      level <= 1 ? QUICK_HINTS[field].weak : QUICK_HINTS[field].partial;
    if (isChoice(gapAnswer) && gapAnswer.confidence >= GAP_CONFIDENCE_FLOOR) {
      const match = gaps.find(([option]) => option === gapAnswer.choice);
      // "Nothing missing" on a weak score is a contradiction; keep the
      // level's hint rather than telling a vague answer it is complete.
      if (match && (match[1] !== null || level >= STRONG_ENOUGH))
        hint = match[1];
    }

    out[field] = {
      ...view(level, hint, "jev", split || undefined),
      source: "jev",
      value: answers[field].trim(),
    };
  }
  const sufficient = response.sufficient;
  return {
    fields: out,
    sufficiency: isNoul(sufficient) ? sufficient.noul : null,
  };
}

/* ── Display ───────────────────────────────────────────────────── */

/** Jev's reading when it read exactly this text; otherwise the quick read. */
export function strengthFor(
  field: BriefField,
  value: string,
  judged: JudgedStrength | undefined,
): StrengthView {
  if (judged && judged.value === value.trim()) return judged;
  return quickFieldStrength(field, value);
}

export function filledFieldCount(answers: ProjectInterviewAnswers): number {
  return Object.values(answers).filter((v) => String(v ?? "").trim()).length;
}

/**
 * The answer to raise next: the weakest filled field below Specific, ties
 * broken by brief order. Unfilled fields are the form's job, not a nudge's.
 */
export function weakestField(
  views: Partial<Record<BriefField, StrengthView>>,
  order: ReadonlyArray<BriefField>,
): BriefField | null {
  let best: BriefField | null = null;
  for (const field of order) {
    const v = views[field];
    if (!v || v.level === 0 || v.level >= STRONG_ENOUGH) continue;
    if (!best || v.level < views[best]!.level) best = field;
  }
  return best;
}
