/**
 * What a brief answer is checked for, field by field.
 *
 * A single 0–4 grade tells a writer how they did and nothing about what to
 * do. So each field is read as a short checklist instead: two or three yes/no
 * facets ("names a reader you could seat", "says what they already know"),
 * and the level is derived from which ones hold. The checklist is the
 * feedback; the level is only its summary.
 *
 * Both readers use these definitions. The quick read looks for each facet
 * with the detectors at the bottom of this file; Jev answers each facet's
 * `ask` as a Noul. The form and the filed-brief review therefore grade
 * against one rubric and cannot disagree about what "Specific" means.
 *
 * Jev does not write, so every line a writer sees — facet names, the "Add"
 * line, the stranger's question — is authored here and selected by a
 * judgement.
 */

import type { ConstraintKind, ProjectInterviewAnswers } from "../types";

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

export const BRIEF_FIELD_ORDER: BriefField[] = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

/**
 * The three answers everything downstream is measured against: `targetFit`
 * grades the draft against the reader and the goal, and the landing is the
 * only place the brief says what "worked" means.
 */
export const LOAD_BEARING = ["audience", "goal", "successSignal"] as const;
export type LoadBearingField = (typeof LOAD_BEARING)[number];

export const BEARING_LABELS: Record<LoadBearingField, string> = {
  audience: "Reader",
  goal: "Goal",
  successSignal: "Landing",
};

/** How the form names each department, for links back to a field. */
export const FIELD_DEPARTMENTS: Record<
  BriefField,
  { numeral: string; name: string }
> = {
  workingTitle: { numeral: "I", name: "Title" },
  format: { numeral: "II", name: "Form" },
  audience: { numeral: "III", name: "Reader" },
  goal: { numeral: "IV", name: "Intent" },
  tone: { numeral: "V", name: "Voice" },
  constraints: { numeral: "VI", name: "Non-negotiables" },
  successSignal: { numeral: "VII", name: "Landing" },
};

/* ── Facets ────────────────────────────────────────────────────── */

/**
 * `core` gates Partial: without it the answer could describe any piece.
 * `needed` facets gate Specific: enough of them, and a writer could start.
 * `edge` gates Sharp: the answer rules something out, so a draft can fail it.
 */
export type FacetRole = "core" | "needed" | "edge";

/**
 * How many `needed` facets make an answer Specific, where it is not all of
 * them. A reader's standing toward the subject can be given as what they know
 * or as what they doubt, and a voice as a model or as a prohibition; either
 * is enough to write to, and both are what Sharp asks for. Measured: asking
 * for both on the way to Specific graded plainly usable readers as Partial.
 */
export const NEEDED_QUORUM: Partial<Record<BriefField, number>> = {
  audience: 1,
  tone: 1,
};

export interface FacetDef {
  id: string;
  role: FacetRole;
  /** The ledger line, worded so it reads under either a tick or a cross. */
  name: string;
  /** Jev's yes/no question about the entry. */
  ask: string;
  /** The one thing to add when this is what is missing. */
  add: string;
  /** What a stranger handed the brief would ask about it. */
  question: string;
}

const entry = (field: BriefField) =>
  `Judge only the \`${field}\` entry, read as an answer on a writing brief.`;

export const FIELD_FACETS: Record<BriefField, FacetDef[]> = {
  workingTitle: [
    {
      id: "named",
      role: "core",
      name: "A real title, not a placeholder.",
      ask: `${entry("workingTitle")} Is it an actual title for a piece of writing, rather than a placeholder such as "Untitled", "Draft", "Essay", "TBD" or a string of filler?`,
      add: "Give it a name you could say across a desk. Rough is fine.",
      question: "What is this piece called?",
    },
    {
      id: "angle",
      role: "edge",
      name: "Hints at the angle, not just the subject.",
      ask: `${entry("workingTitle")} Does the title hint at what the piece says or the story it tells, so that it would be the wrong title for a different piece on the same subject?`,
      add: "Push the title toward what the piece says, not just what it is about.",
      question: "What does the title promise the piece will say?",
    },
  ],
  format: [
    {
      id: "shape",
      role: "core",
      name: "A named form.",
      ask: `${entry("format")} Does it name a recognisable form of writing, such as an essay, memo, chapter, op-ed, talk, grant proposal or newsletter issue?`,
      add: "Name the form: essay, memo, chapter, dispatch, talk.",
      question: "What form does this take?",
    },
    {
      id: "size",
      role: "needed",
      name: "A length to write to.",
      ask: `${entry("format")} Does it give a length or scale a writer could write to, such as a word count, a page count, a duration or a number of parts, stated as an actual quantity?`,
      add: "Add a rough length: a page, 1,500 words, twenty minutes.",
      question: "How long is it?",
    },
    {
      id: "venue",
      role: "edge",
      name: "Where it will run.",
      ask: `${entry("format")} Does it say where the piece will run or how it will reach its reader, such as a named publication, a newsletter, a meeting, a stage or a submission portal?`,
      add: "Say where it will run: a newsletter, a journal, a meeting, a stage.",
      question: "Where will this run?",
    },
  ],
  audience: [
    {
      id: "reader",
      role: "core",
      name: "A reader you could seat across a table.",
      ask: `${entry("audience")} Does it identify a particular kind of reader, by role, situation or community, specific enough that you could pick such a person out of a crowd, rather than a broad category such as "everyone", "general readers", "people interested in the topic" or a bare demographic?`,
      add: "Swap the category for one reader you could picture: their job, their situation, the week they are having.",
      question: "Who exactly is reading this?",
    },
    {
      id: "knows",
      role: "needed",
      name: "What they already know or have tried.",
      ask: `${entry("audience")} Does it say something concrete about what this reader already knows, believes, has done or has lived through that bears on the piece? Answer no when it only lists words like "knows" or "experienced" without saying what.`,
      add: "What has this reader already read, tried or decided? That tells the room what to skip.",
      question: "What does this reader already know?",
    },
    {
      id: "wants",
      role: "needed",
      name: "What they doubt or want from it.",
      ask: `${entry("audience")} Does it say something concrete about this reader's attitude going in: what they doubt, regret, resist, fear or want? Answer no when it only lists words like "skeptical" or "wants" without saying about what.`,
      add: "What does this reader doubt, or want out of the next ten minutes? That tells the room what to argue.",
      question: "What does this reader doubt, or want from it?",
    },
    {
      id: "narrow",
      role: "edge",
      name: "Narrow enough to rule a draft out.",
      ask: `${entry("audience")} Is the reader described narrowly enough that a competent draft on the same subject, written for a general reader, would clearly be the wrong draft for them? Answer no when the entry is a list of traits with no subject matter.`,
      add: "Say who this is not for. A reader the piece can afford to lose makes the rest easier to write.",
      question: "Who is this not for?",
    },
  ],
  goal: [
    {
      id: "aim",
      role: "core",
      name: "A purpose that belongs to this piece.",
      ask: `${entry("goal")} Does it state a purpose particular to this piece, more than aims any piece could claim such as "inform people", "be interesting", "explore the topic" or "write about" a subject?`,
      add: "Say what this piece is for in a way that could not be said of the next one.",
      question: "What is this piece for?",
    },
    {
      id: "change",
      role: "needed",
      name: "What changes for the reader.",
      ask: `${entry("goal")} Does it say what should be different in the reader afterward, naming something specific they will understand, believe, decide, feel or do? Answer no when it describes what the piece itself will explain or cover, or lists verbs without saying what about.`,
      add: "Finish the sentence: after reading, they will…",
      question: "After reading, what should the reader do or believe?",
    },
    {
      id: "single",
      role: "needed",
      name: "One result that wins.",
      ask: `${entry("goal")} Does it commit to one main result, rather than listing several aims of equal weight or stringing verbs together?`,
      add: "Pick the one result that still counts if the others do not happen.",
      question: "Which one result matters most?",
    },
    {
      id: "missable",
      role: "edge",
      name: "Clear enough that a draft could miss it.",
      ask: `${entry("goal")} Could a competent, on-topic draft clearly fail this goal by aiming at a different result, because the goal names the specific belief, decision or action it is after?`,
      add: "Name the result you are not going for, so a draft that chases it reads as off-brief.",
      question: "What would a draft that missed the point look like?",
    },
  ],
  tone: [
    {
      id: "distinct",
      role: "core",
      name: "A voice, not just good writing.",
      ask: `${entry("tone")} Does it describe a particular voice with at least one word or image that would not apply to most competent writing? Answer no when every descriptor is a general virtue such as "clear", "engaging", "professional", "friendly", "accessible", "not boring" or "well written".`,
      add: "Name what sets this voice apart from any well-written piece.",
      question: "What should it sound like?",
    },
    {
      id: "imitable",
      role: "needed",
      name: "Something a writer could imitate.",
      ask: `${entry("tone")} Does it give a writer something concrete to imitate: a comparison, a named writer or publication, a stance toward the reader, or a habit of the sentences?`,
      add: "Give the room something to imitate: a comparison, a writer, a habit of the sentences.",
      question: "What does that voice sound like in a sentence?",
    },
    {
      id: "avoid",
      role: "needed",
      name: "What the voice must never do.",
      ask: `${entry("tone")} Does it explicitly rule something out, naming a specific habit, register or device the voice must not use (for example "no exclamation marks", "never cute", "no nostalgia")?`,
      add: "Add one thing the voice must never do: preach, hedge, joke, gush.",
      question: "What must it never sound like?",
    },
  ],
  // Constraints are read line by line rather than by facet; see
  // `constraintsLevel`.
  constraints: [],
  successSignal: [
    {
      id: "observable",
      role: "core",
      name: "Something you could watch happen.",
      ask: `${entry("successSignal")} Does it name a specific event someone could witness or count, saying who does what about what, rather than a feeling, a quality of the draft, or verbs with no object?`,
      add: "Describe something you could see happen: a reply, a decision, a retelling.",
      question: "How would anyone tell that it worked?",
    },
    {
      id: "theirs",
      role: "needed",
      name: "Done by the reader, not felt by you.",
      ask: `${entry("successSignal")} Is the signal something a reader or other outside party does or says, rather than the writer's own satisfaction with the piece?`,
      add: "Move it to the reader's side. What do they do or say?",
      question: "What does the reader do when it has worked?",
    },
    {
      id: "threshold",
      role: "needed",
      name: "A line between worked and almost.",
      ask: `${entry("successSignal")} Does it draw a line between success and a near miss: a stated number of people or acts, a deadline, or a single act by one specific, identified person or body? "A reader", "readers", "people" or a bare percentage do not draw that line.`,
      add: "Add the line: how many, by when, or which exact act.",
      question: "How much of that counts as success?",
    },
    {
      id: "earned",
      role: "edge",
      name: "A polished draft could still fail it.",
      ask: `${entry("successSignal")} Is the signal tied to this piece's particular purpose, so that general praise, enjoyment, popularity or engagement would not count as meeting it?`,
      add: "Make it something a polished draft could still fail to earn.",
      question: "What would almost working look like?",
    },
  ],
};

/* ── Scales ────────────────────────────────────────────────────── */

/**
 * One graded scale per field, for the number on the meter.
 *
 * The checklist says which things an answer has; it cannot say how far along
 * an answer is, and a writer who sharpens "nurses" to "ICU nurses" deserves
 * to see the needle move before any tick flips. That is a question of
 * degree, which is what Jev's Score is for: five levels in the field's own
 * terms, each a concrete situation, returning a position that can land
 * between two of them.
 *
 * The level shown is still the checklist's, because it can be explained
 * line by line (and on the fixtures it is the more accurate of the two).
 * The scale places the answer within that level, and a scale that disagrees
 * with the checklist by more than a level marks the reading a close call.
 */
export const FIELD_SCALES: Partial<
  Record<BriefField, { ask: string; levels: string[] }>
> = {
  workingTitle: {
    ask: "How much does the `workingTitle` entry say about the piece?",
    levels: [
      "Nothing: the entry is empty or unreadable",
      "A placeholder: Untitled, Draft, TBD, or filler words",
      "A label for the kind of piece rather than a title, such as 'My blog post' or 'Essay about work'",
      "A real title that names the subject",
      "A title that hints at what the piece says or the story it tells, so it would be the wrong title for another piece on the same subject",
    ],
  },
  format: {
    ask: "How fully does the `format` entry say what the writer has to produce?",
    levels: [
      "Nothing: no form of writing is given",
      "No recognisable form: 'a piece', 'something to post', or a list of formats and units",
      "A named form only, such as essay, memo, talk or chapter",
      "A named form with an actual length or scale to write to",
      "A named form, an actual length, and where it will run or how it reaches its reader",
    ],
  },
  audience: {
    ask: "How particular is the reader described in the `audience` entry?",
    levels: [
      "Nobody: no reader is described",
      "Anyone at all: 'everyone', 'general readers', people merely interested in the topic, or a list of traits with no subject",
      "A recognisable kind of reader, such as a role, profession or community, with nothing said about what they know or want",
      "A particular reader in a particular situation: the entry also says what they already know or have done, or what they doubt or want",
      "A reader pinned down from both sides, what they know and what they doubt or want, narrowly enough that a piece written for a general reader would be the wrong piece",
    ],
  },
  goal: {
    ask: "How definite is the result the `goal` entry is after?",
    levels: [
      "Nothing: no goal is stated",
      "An aim any piece could claim: inform, explore, be interesting, write about a subject, or verbs with nothing after them",
      "A direction particular to this piece, stated as what the piece will explain or cover, or as several results of equal weight",
      "One result in the reader: something specific they will understand, believe, decide, feel or do",
      "One result named so exactly, a particular decision, belief or action by particular people, that an on-topic draft aiming elsewhere would plainly miss it",
    ],
  },
  tone: {
    ask: "How well could a writer reproduce the voice described in the `tone` entry?",
    levels: [
      "Nothing: no tone is given",
      "Only virtues any competent piece has: clear, engaging, professional, friendly, well written, not boring",
      "A voice with a character of its own, named in a word or two, with nothing to imitate and nothing ruled out",
      "A voice a writer could reproduce: it gives a comparison or model to imitate, or names something specific the voice must not do",
      "A voice given both ways: something to imitate and something specific it must never do",
    ],
  },
  successSignal: {
    ask: "How checkable is the sign of success in the `successSignal` entry?",
    levels: [
      "Nothing: no sign of success is given",
      "A feeling or a quality: people like it, it resonates, the writer is proud of it, or verbs with nothing after them",
      "Something a reader could be seen to do or say, with no line between success and a near miss",
      "An observable act by a reader or other outside party with a line drawn: how many, by when, or one act by one identified person",
      "A counted or dated act that only this piece doing its particular job would produce, so that general praise or popularity would not meet it",
    ],
  },
};

/**
 * The meter's number, 0–100. Each level owns a quarter of the range (Vague
 * 0–24, Partial 25–49, Specific 50–74, Sharp 75–100), and `progress` is how
 * far through its quarter the answer is, so the number and the level can
 * never disagree and the notches fill continuously.
 */
export function meterScore(level: StrengthLevel, progress: number): number {
  if (level <= 0) return 0;
  const within = Math.max(0, Math.min(level >= 4 ? 1 : 0.96, progress));
  return Math.round((level - 1 + within) * 25);
}

/** The facets the next level still turns on, for measuring progress. */
export function nextTierFacets(
  field: BriefField,
  level: StrengthLevel,
): FacetDef[] {
  const defs = FIELD_FACETS[field];
  if (level <= 1) return defs.filter((d) => d.role === "core");
  if (level === 2) return defs.filter((d) => d.role === "needed");
  if (level === 3) return defs.filter((d) => d.role !== "core");
  return defs;
}

/** What each level means, as a diagnosis rather than a grade. */
export const LEVEL_DIAGNOSES = [
  "there is nothing usable here",
  "this could describe almost any piece",
  "a direction, but the key decision is still open",
  "a writer could act on this without asking a follow-up",
  "it rules things out, not just in",
] as const;

/** A Noul at or above this counts as yes for a core or needed facet. */
export const FACET_MET = 0.5;
/** Sharp is a claim about exclusion; ask for a clearer yes. */
export const EDGE_MET = 0.6;
/** Inside this band a facet is a close call. */
export const FACET_CLOSE: [number, number] = [0.35, 0.65];

/**
 * The level a set of facet results amounts to. Empty text is Missing and is
 * the caller's business; this starts at Vague.
 */
export function deriveLevel(
  field: BriefField,
  met: Record<string, boolean | null | undefined>,
): StrengthLevel {
  const of = (role: FacetRole) =>
    FIELD_FACETS[field].filter((f) => f.role === role);
  const held = (role: FacetRole) =>
    of(role).filter((f) => met[f.id] === true).length;
  if (held("core") < of("core").length) return 1;
  const needed = of("needed").length;
  if (held("needed") < Math.min(needed, NEEDED_QUORUM[field] ?? needed))
    return 2;
  if (held("needed") < needed || held("edge") < of("edge").length) return 3;
  return 4;
}

/** The facet to fix first: the first unmet one in core → needed → edge order. */
export function firstUnmetFacet(
  field: BriefField,
  met: Record<string, boolean | null | undefined>,
): FacetDef | null {
  for (const role of ["core", "needed", "edge"] as const) {
    const miss = FIELD_FACETS[field].find(
      (f) => f.role === role && met[f.id] !== true,
    );
    if (miss) return miss;
  }
  return null;
}

/** Why a stand-in phrase earns its underline, by field. */
export const STAND_IN_NOTES: Partial<Record<BriefField, string>> = {
  audience: "fits the reader of almost any piece.",
  goal: "could be the goal of almost any piece.",
  tone: "describes any well-written piece.",
  successSignal: "would be true of any piece that isn't bad.",
};

/* ── Readings: which kind of answer is this? ───────────────────── */

export interface Archetype {
  id: string;
  /** The option Jev chooses among. */
  option: string;
  /** The same reading as the writer sees it on a button. */
  label: string;
}

export interface ArchetypeSet {
  ask: string;
  /** Said above the two readings when the answer fits both. */
  lead: string;
  /** The question filed to Particulars. */
  prompt: string;
  options: Archetype[];
}

/**
 * A vague answer is one a draft could satisfy in two incompatible ways. Each
 * set below lists the ways; when Jev spreads its probability across two of
 * them, that spread *is* the vagueness, and the top two become a question.
 */
export const FIELD_ARCHETYPES: Partial<Record<BriefField, ArchetypeSet>> = {
  audience: {
    ask: "Which stance does the reader described in the `audience` entry take toward this piece?",
    lead: "This answer fits two different readers. One draft cannot serve both:",
    prompt: "Which reader is this for?",
    options: [
      {
        id: "newcomer",
        option:
          "Newcomer — little background, needs the basics before anything else",
        label: "New to the subject and needs the basics",
      },
      {
        id: "practitioner",
        option:
          "Practitioner — does this work already and wants something usable",
        label: "Does this work and wants something usable",
      },
      {
        id: "skeptic",
        option: "Skeptic — has heard the case before and doubts it",
        label: "Has heard the case and doubts it",
      },
      {
        id: "decider",
        option: "Decision-maker — has a choice to make and needs grounds",
        label: "Has a decision to make and needs grounds",
      },
      {
        id: "expert",
        option: "Expert — knows the field and will check the reasoning",
        label: "Knows the field and will check the reasoning",
      },
      {
        id: "ally",
        option: "Ally — already agrees and wants it said well",
        label: "Already agrees and wants it said well",
      },
    ],
  },
  goal: {
    ask: "Which kind of result is the `goal` entry after?",
    lead: "This goal reads two ways. They call for different drafts:",
    prompt: "Which result is the piece after?",
    options: [
      {
        id: "understand",
        option:
          "Understand — the reader can explain something they could not before",
        label: "They understand something they did not before",
      },
      {
        id: "believe",
        option: "Believe — the reader changes their mind about a claim",
        label: "They change their mind about a claim",
      },
      {
        id: "decide",
        option: "Decide — the reader makes a particular choice",
        label: "They make a particular choice",
      },
      {
        id: "do",
        option: "Do — the reader takes a specific action",
        label: "They take a specific action",
      },
      {
        id: "feel",
        option: "Feel — the reader is moved, unsettled, consoled or amused",
        label: "They feel something",
      },
    ],
  },
  format: {
    ask: "Which shape will the piece described by the `format` entry most likely take?",
    lead: "This form can take two shapes. The outline differs:",
    prompt: "Which shape does the piece take?",
    options: [
      {
        id: "argument",
        option: "Argument — builds a case toward a conclusion",
        label: "An argument that builds to a conclusion",
      },
      {
        id: "narrative",
        option: "Narrative — tells what happened, in scenes or in sequence",
        label: "A story told in scenes or sequence",
      },
      {
        id: "explainer",
        option: "Explainer — walks through how or why something works",
        label: "An explainer of how or why something works",
      },
      {
        id: "report",
        option: "Report — sets out findings or the state of things",
        label: "A report of findings",
      },
      {
        id: "guide",
        option: "Guide — tells the reader how to do something",
        label: "A guide to doing something",
      },
      {
        id: "reflection",
        option: "Reflection — thinks a question through without a verdict",
        label: "A reflection without a verdict",
      },
    ],
  },
  successSignal: {
    ask: "According to the `successSignal` entry, what shows that the piece worked?",
    lead: "This landing could be seen two ways. They need different endings:",
    prompt: "What shows the piece has landed?",
    options: [
      {
        id: "saysBack",
        option: "Says it back — a reader can state the point or retell it",
        label: "A reader can say the point back",
      },
      {
        id: "acts",
        option:
          "Acts — a reader decides, signs, buys or changes what they do",
        label: "A reader acts on it",
      },
      {
        id: "passesOn",
        option: "Passes it on — a reader forwards, shares, cites or quotes it",
        label: "A reader passes it on",
      },
      {
        id: "gatekeeper",
        option:
          "Gatekeeper approves — an editor, reviewer, funder or boss says yes",
        label: "A gatekeeper says yes",
      },
      {
        id: "number",
        option: "A number moves — signups, replies, sales or scores",
        label: "A number moves",
      },
      {
        id: "writer",
        option: "The writer is satisfied — it feels right to its author",
        label: "It feels right to you",
      },
    ],
  },
};

/** The top reading must fall short of this for an answer to count as split. */
export const SPLIT_TOP_BELOW = 0.6;
/** …and the runner-up must hold at least this much. */
export const SPLIT_SECOND_AT_LEAST = 0.22;

/* ── Whole brief ───────────────────────────────────────────────── */

/** What a stranger would ask first, one authored question per field. */
export const FIRST_QUESTIONS: Record<BriefField, string> = {
  workingTitle: "What is this piece called?",
  format: "What form does this take, and how long is it?",
  audience: "Who exactly is reading this, and what do they already know?",
  goal: "After reading, what should the reader do or believe?",
  tone: "What should it sound like?",
  constraints: "What is off-limits, and what has to stay in?",
  successSignal: "How would anyone tell that it worked?",
};

export interface TensionPair {
  a: BriefField;
  b: BriefField;
  /** The option Jev chooses among. */
  option: string;
  /** What the pull costs, as the writer reads it. */
  reason: string;
}

export const TENSION_PAIRS: TensionPair[] = [
  {
    a: "tone",
    b: "audience",
    option:
      "`tone` against `audience` — the voice would put off or talk past the reader described",
    reason: "That voice loses the reader you named.",
  },
  {
    a: "tone",
    b: "goal",
    option:
      "`tone` against `goal` — the voice works against what the piece is meant to achieve",
    reason: "That voice works against what the piece is for.",
  },
  {
    a: "audience",
    b: "goal",
    option:
      "`audience` against `goal` — the reader described cannot do, or does not need, what the goal asks",
    reason: "This reader cannot do, or does not need, what the goal asks.",
  },
  {
    a: "format",
    b: "goal",
    option:
      "`format` against `goal` — the form is too small or the wrong shape for the goal",
    reason: "The form is too small, or the wrong shape, for that goal.",
  },
  {
    a: "constraints",
    b: "goal",
    option:
      "`constraints` against `goal` — a stated rule would stop the piece doing what the goal asks",
    reason: "A rule you set stops the piece doing what the goal asks.",
  },
  {
    a: "constraints",
    b: "successSignal",
    option:
      "`constraints` against `successSignal` — a stated rule puts the success signal out of reach",
    reason: "A rule you set puts the landing out of reach.",
  },
  {
    a: "constraints",
    b: "format",
    option:
      "`constraints` against `format` — a stated rule does not fit inside the form",
    reason: "A rule you set does not fit inside the form.",
  },
  {
    a: "goal",
    b: "successSignal",
    option:
      "`goal` against `successSignal` — the signal would not show that the goal was met",
    reason: "That landing would not show the goal was met.",
  },
  {
    a: "audience",
    b: "successSignal",
    option:
      "`audience` against `successSignal` — the signal depends on someone other than the reader described",
    reason: "That landing depends on someone other than the reader you named.",
  },
];

/* ── Constraints ───────────────────────────────────────────────── */

export const CONSTRAINT_KINDS = [
  "hard", // external, not the writer's to relax
  "editorial", // the writer's firm choice
  "preference", // would rather, but the piece survives
  "uncheckable", // cannot tell whether a draft complies
] as const;

const _kindsMatchType: ReadonlyArray<ConstraintKind> = CONSTRAINT_KINDS;
void _kindsMatchType;

/** What the room does with a line of each kind. */
export const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  hard: "Hard · vetoes",
  editorial: "Editorial · vetoes",
  preference: "Preference · weighs",
  uncheckable: "Uncheckable · ignored",
};

export const CONSTRAINT_NOTES: Record<ConstraintKind, string> = {
  hard: "An outside rule. A note that breaks it is withheld.",
  editorial: "Your rule. A note that breaks it is withheld.",
  preference:
    "Read with your tone, not as a veto, so a note that sharpens the argument is not thrown out for breaking it.",
  uncheckable:
    "No one could hold a draft against this and say yes or no. Name what breaking it would look like: a word to ban, an opening to avoid, a number.",
};

/**
 * How a line is read. One Choice over all four kinds never picked
 * "uncheckable" on the fixtures — "make it feel fresh" came back as the
 * writer's firm decision, which it is, and that is exactly the line the note
 * gate must not veto on. So checkability is asked on its own, twice from
 * opposite sides, and the kind is asked only among the three that remain.
 */
export const CONSTRAINT_KIND_OPTIONS = [
  "Hard — imposed from outside the writer: a law, a contract, a publication's limit, an embargo, a platform rule",
  "Editorial — the writer's own firm rule for this piece",
  "Preference — a wish: the writer would rather, ideally, if possible",
];
const KIND_OF_OPTION: ConstraintKind[] = ["hard", "editorial", "preference"];

export const constraintAsks = (line: string) => ({
  checkable: `The writer listed this rule for a piece of writing: "${line}". Could an editor hold a finished draft against this rule and say, yes or no, whether the draft followed it, without asking the writer what they meant?`,
  vague: `The writer listed this rule for a piece of writing: "${line}". Is the rule too vague or subjective to check, so that two careful editors could disagree about whether a given draft follows it?`,
  kind: `The writer listed this rule for a piece of writing: "${line}". Which kind of rule is it?`,
});

/**
 * A confidence of exactly 1 is reserved for a kind the writer set by hand, so
 * a later reading knows not to overrule it.
 */
export const WRITER_SET = 1;
const judged = (confidence: number) =>
  Math.max(0, Math.min(0.99, confidence));

/** Below this a firm line is one nobody could check a draft against. */
export const CHECKABLE_AT = 0.45;

/**
 * A line's kind from its three answers. A wish is a preference whether or not
 * it is checkable; a firm line nobody could check is uncheckable; what is
 * left is binding, and only then does hard-versus-editorial matter.
 */
export function constraintKindFrom(reading: {
  checkable: number;
  vague: number;
  /** The chosen option and its probability. */
  kind: { option: string; p: number };
}): { kind: ConstraintKind; confidence: number } {
  const chosen =
    KIND_OF_OPTION[CONSTRAINT_KIND_OPTIONS.indexOf(reading.kind.option)] ??
    "editorial";
  if (chosen === "preference")
    return { kind: "preference", confidence: judged(reading.kind.p) };
  const check = (reading.checkable + (1 - reading.vague)) / 2;
  if (check < CHECKABLE_AT)
    return { kind: "uncheckable", confidence: judged(1 - check / CHECKABLE_AT) };
  return {
    kind: chosen,
    confidence: judged(
      Math.min(reading.kind.p, (check - CHECKABLE_AT) / (1 - CHECKABLE_AT)),
    ),
  };
}

/** Whether a kind stops a note outright. */
export function isBinding(kind: ConstraintKind): boolean {
  return kind === "hard" || kind === "editorial";
}

/** "None", "n/a" and the like: the writer saying there are no rules. */
const NONE_DECLARED = /^(?:none|n\/?a|nothing|no(?:ne)? (?:constraints?|rules?|limits?)|no|nil|-+)[.!]?$/i;

export function declaresNoConstraints(text: string): boolean {
  const value = text.trim();
  return !value || NONE_DECLARED.test(value);
}

/**
 * One constraint per line, bullet, semicolon or sentence; that is how writers
 * actually type them. Commas and mid-line dashes are left alone: "no jargon,
 * ever" and "under 1,800 words — the journal's limit" are each one rule.
 */
export function splitConstraints(text: string): string[] {
  if (declaresNoConstraints(text)) return [];
  return text
    .split(/\n+|\s[•·]\s+|;\s*|(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim().replace(/^[-•·–—*]\s*/, ""))
    .filter((s) => s.length > 3)
    .slice(0, 12);
}

/**
 * Constraints have no facets: each line either binds, weighs, or cannot be
 * checked, and the level says how much of the list the room can use.
 */
export function constraintsLevel(
  kinds: ReadonlyArray<ConstraintKind>,
): StrengthLevel {
  if (kinds.length === 0) return 0;
  const uncheckable = kinds.filter((k) => k === "uncheckable").length;
  if (uncheckable === kinds.length) return 1;
  const binding = kinds.filter(isBinding).length;
  if (uncheckable > 0 || binding === 0) return 2;
  return binding === kinds.length ? 4 : 3;
}

/* ── Quick read: lexical detectors ─────────────────────────────── */

export interface Span {
  start: number;
  end: number;
}

interface Token extends Span {
  text: string;
  lower: string;
  /** A digit string or a spelled-out number. */
  number: boolean;
  /** Capitalised mid-sentence, or an acronym: hard to fake by accident. */
  proper: boolean;
}

const STOP = new Set(
  `a an the and or but if so of to in on at for from by with without about into
  over under than then that this these those it its is are was were be been being
  as not no nor do does did done can could will would should may might must have
  has had having i we you they he she them their our your my me us him her who
  whom whose which what when where why how all any some each every more most less
  least very really just only also too there here up out off again own same such
  both few other others rather instead still even ever never always etc via per
  don't doesn't didn't isn't aren't wasn't can't won't shouldn't it's that's`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words that sound like content and commit to nothing. */
const GENERIC = new Set(
  `thing things stuff good great nice better best interesting engaging
  professional clear informative friendly people person everyone everybody anyone
  anybody someone somebody reader readers audience audiences public piece pieces
  draft drafts content topic topics subject subjects something anything
  everything lot lots way ways kind kinds sort sorts general broad wide various
  many much important quality well bad boring dull fluff writing written work
  works worked right wrong new old big small high low real really actual
  actually basically simply main key overall whole type types level levels
  success successful value valuable useful helpful relevant appropriate fresh
  authentic compelling polished strong solid worthwhile`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Cue words: the vocabulary of a good brief answer. On their own they are
 * exactly what a gamed answer is made of ("must cite sources, not over max"),
 * so a cue is only evidence when it is followed by something it is about.
 */
const CUES = new Set(
  `already know knows known knowing familiar tried signed read piloted bought
  built ran used experienced veteran veterans beginner beginners
  want wants wanted need needs doubt doubts doubted skeptic skeptics skeptical
  sceptic sceptical resist resists fear fears worry worries distrust distrusts
  regret regrets hope hopes wary unconvinced
  convince persuade decide decides believe believes act acts sign signs vote
  votes adopt adopts stop stops start starts switch fund funds approve approves
  buy buys cancel cancels change changes agree agrees leave leaves understand
  understands inform explore discuss cover explain explains
  like likes enjoy enjoys share shares shared reply replies replied cite cites
  cited quote quotes forward forwards ask asks asking asked state states retell
  retells ignore ignores engagement resonates resonate viral
  must cite source sources keep max maximum min minimum deadline limit limits
  avoid avoids
  word words page pages minute minutes blog memo essay article post`
    .split(/\s+/)
    .filter(Boolean),
);

const NUMBER_WORDS = new Set(
  `one two three four five six seven eight nine ten eleven twelve twenty thirty
  forty fifty hundred thousand half dozen first second third once twice`
    .split(/\s+/)
    .filter(Boolean),
);

const TOKEN = /\d[\d,.]*\d%?|\d%?|[\p{L}][\p{L}'’-]*/gu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const word = m[0];
    const start = m.index;
    const lower = word.toLowerCase().replace(/[’']s$/, "");
    const before = text.slice(0, start).trimEnd();
    const sentenceStart = before === "" || /[.!?\n;:]$/.test(before);
    const capital = /^\p{Lu}/u.test(word);
    const acronym = /^\p{Lu}{2,}s?$/u.test(word);
    tokens.push({
      text: word,
      lower,
      start,
      end: start + word.length,
      number: /^\d/.test(word) || NUMBER_WORDS.has(lower),
      proper:
        acronym || (capital && !sentenceStart && !STOP.has(lower) && !GENERIC.has(lower)),
    });
  }
  return tokens;
}

const wordsOf = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

/**
 * Words that only name the field itself. "A voice that sounds like a style"
 * says nothing about a voice; "keep to the rules" names no rule.
 */
const FIELD_META: Record<BriefField, Set<string>> = {
  workingTitle: wordsOf("title titles name working draft untitled tbd"),
  format: wordsOf("format form length long short medium size"),
  audience: wordsOf("non-readers interested curious backgrounds ages"),
  goal: wordsOf("goal goals aim aims purpose result results outcome point"),
  tone: wordsOf(
    "tone voice style sound sounds register feel feels vibe manner language accessible readable",
  ),
  constraints: wordsOf(
    "rule rules limit limits allowed constraint constraints guideline guidelines requirement requirements boundaries make feel should sure ensure try break",
  ),
  successSignal: wordsOf(
    "signal signals sign landing lands succeeded succeed feeling feel feels time",
  ),
};

/** The field being read, so its meta words are not mistaken for content. */
let reading: BriefField | null = null;

function isContent(t: Token): boolean {
  if (reading && FIELD_META[reading].has(t.lower)) return false;
  if (t.proper) return true;
  if (t.number) return false;
  return (
    t.lower.length >= 3 &&
    !STOP.has(t.lower) &&
    !GENERIC.has(t.lower) &&
    !CUES.has(t.lower)
  );
}

export interface LexicalProfile {
  tokens: number;
  /** Distinct words that say something about this piece. */
  content: number;
  /** Distinct tokens over tokens; low means the answer repeats itself. */
  distinctRatio: number;
  /** Proper names and acronyms. */
  proper: number;
  /** A number attached to something: "1,500 words", "two of three". */
  quantity: Span | null;
}

function quantitySpan(tokens: Token[]): Span | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.number) continue;
    // "1 2 3 words" is a list of numbers, not a length.
    if (tokens[i - 1]?.number && tokens[i - 1].lower !== "of") continue;
    if (t.text.endsWith("%")) {
      // A bare percentage measures nothing; it needs something to be a
      // percentage of.
      const subject = tokens.slice(i + 1, i + 4).find(isContent);
      if (subject) return { start: t.start, end: subject.end };
      continue;
    }
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    if (!next) continue;
    // "two of three reviewers", "1,500 words", "800-word", "three editors".
    if (next.lower === "of" && after?.number)
      return { start: t.start, end: (tokens[i + 3] ?? after).end };
    // "five replies" counts; "10 people" and "three things" do not.
    if (
      isContent(next) ||
      UNITS.has(next.lower) ||
      (CUES.has(next.lower) && next.lower.length >= 4)
    )
      return { start: t.start, end: next.end };
  }
  return null;
}

/** "Ten-minute", "two-page": a hyphenated number tokenizes as one word. */
const HYPHEN_QUANTITY =
  /\b(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety|half)-(?:word|page|minute|hour|slide|part|chapter|paragraph|line|character|day|week)s?\b/i;

const UNITS = new Set(
  `word words page pages minute minutes hour hours day days week weeks month
  months year years chapter chapters slide slides paragraph paragraphs part
  parts section sections character characters k`
    .split(/\s+/)
    .filter(Boolean),
);

export function lexicalProfile(
  text: string,
  field: BriefField | null = null,
): LexicalProfile {
  reading = field;
  const tokens = tokenize(text);
  const distinct = new Set(tokens.map((t) => t.lower));
  const content = new Set(tokens.filter(isContent).map((t) => t.lower));
  return {
    tokens: tokens.length,
    content: content.size,
    distinctRatio: tokens.length ? distinct.size / tokens.length : 1,
    proper: tokens.filter((t) => t.proper).length,
    quantity: quantitySpan(tokens) ?? spanOf(HYPHEN_QUANTITY, text),
  };
}

/**
 * A cue followed by what it is about: the next few words hold a content word
 * before another cue interrupts. "already know the ridership data" passes at
 * "know"; "already know and doubt and want" never does.
 */
function cueWithObject(tokens: Token[], cues: RegExp): Span | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!cues.test(tokens[i].lower)) continue;
    for (let j = i + 1; j < tokens.length && j <= i + 4; j++) {
      const t = tokens[j];
      if (isContent(t)) return { start: tokens[i].start, end: t.end };
      if (CUES.has(t.lower) || cues.test(t.lower)) break;
    }
  }
  return null;
}

/** The words a field's generic answers are made of, for the stand-in underline. */
const STAND_INS: Partial<Record<BriefField, RegExp>> = {
  audience:
    /\b(?:everyone|everybody|anyone|anybody|the general public|general (?:public|readers?|audiences?)|the public|people(?: (?:who are )?interested in [\w ]+?)?|all ages|a (?:wide|broad|general) audience|readers)\b/i,
  goal: /\b(?:inform(?: (?:people|readers|them))?|explore|discuss|talk about|cover|write about|raise awareness|be (?:good|interesting|engaging|informative))\b/i,
  tone: /\b(?:good|nice|engaging|professional|clear|interesting|friendly|informative|well[- ]written|readable|accessible|not boring)\b/i,
  successSignal:
    /\b(?:people (?:like|enjoy|love) it|(?:they|readers) (?:like|enjoy|love) it|it'?s good|engagement|it goes viral|it resonates|positive feedback|good feedback|come away feeling|feel(?:s|ing)? (?:proud|good|right|happy|satisfied|that)|worthwhile|learned something|find it (?:\w+ )?(?:interesting|useful|helpful|enjoyable)|consider it a success|(?:i'?m|i am|we'?re|we are) (?:happy|proud|satisfied|pleased))\b/i,
  workingTitle:
    /^(?:untitled|draft|essay|new (?:piece|essay|project)|tbd|title|working title)(?:\s*\d+)?$/i,
};

/** Further marks of a reader who is nobody in particular. */
const AUDIENCE_FILLER =
  /\b(?:interested in|of all (?:ages|kinds|backgrounds)|wants? to learn|curious|and backgrounds|students, professionals)\b/gi;

function countMatches(pattern: RegExp, text: string): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return text.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

/** Where a field's generic stand-in sits in the answer, if it has one. */
export function standInSpan(field: BriefField, text: string): Span | null {
  const m = STAND_INS[field]?.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

// Verbs and prepositions only. An adjective ("skeptical experts") says who is
// doubtful without saying of what, which is how a stuffed answer is built.
const KNOWS =
  /^(?:already|knows?|known|familiar|tried|signed|read|piloted|bought|built|ran|used|trained|worked|works?|never|after|since|during)$/;
const WANTS =
  /^(?:wants?|wanted|needs?|doubts?|doubted|resists?|fears?|worr\w+|distrusts?|regrets?|hopes?|thinks?|without|against|before)$/;
const CHANGE =
  /^(?:convince|persuade|decides?|believes?|signs?|votes?|adopts?|stops?|starts?|switch\w*|funds?|approves?|buys?|cancels?|agrees?|leaves?|understand\w*|gets?|make|makes|feels?|calls?|recommends?|accepts?|renews?|says?)$/;
const IMITABLE = /^(?:like|imagine|think)$/;
const AVOID = /^(?:no|never|not|without|avoid|avoids|don't|dont|nothing)$/;
const FORMS =
  /\b(?:essays?|memos?|chapters?|dispatch(?:es)?|proposals?|profiles?|polemics?|articles?|posts?|blogs?|newsletters?|op-?eds?|columns?|reports?|letters?|talks?|speech(?:es)?|stor(?:y|ies)|reviews?|papers?|thes[ie]s|scripts?|decks?|briefs?|guides?|tutorials?|explainers?|features?|poems?|books?|novels?|grants?|abstracts?|emails?|threads?|case stud(?:y|ies)|white ?papers?|zines?|sermons?|eulog(?:y|ies)|manifestos?|monographs?|pitch(?:es)?)\b/i;
const VENUE =
  /\b(?:for|in|on|at|to)\s+(?:the |a |an |my |our )?(?:\p{Lu}[\p{L}'’-]+|newsletter|journal|magazine|conference|meeting|board|blog|site|website|substack|podcast|stage|class|seminar|committee|portal|press)/u;
const FIRST_PERSON = /\b(?:i|we)\s+(?:feel|am|are|will (?:be|feel)|like|love|think)\b|\b(?:i'?m|we'?re) (?:happy|proud|satisfied|pleased)\b/i;
// Case-sensitive on purpose: "by Friday" is a deadline, "before they" is not.
const TIME_BOUND =
  /\b(?:[Bb]y|[Bb]efore|[Ww]ithin|[Aa]fter|[Uu]ntil)\s+(?:the\s+)?(?:\d|\p{Lu}|next|end|first|week|month|deadline|meeting|renewal|launch|vote)/u;
const UNPROMPTED = /\b(?:unprompted|without being asked|on their own|in their own words)\b/i;

export interface QuickFacet {
  id: string;
  /** True when the detector saw it. A quick read cannot assert absence. */
  seen: boolean;
  /** The words that showed it. */
  span: Span | null;
}

export interface QuickRead {
  level: StrengthLevel;
  facets: QuickFacet[];
  standIn: Span | null;
  profile: LexicalProfile;
}

function facet(id: string, span: Span | null | boolean): QuickFacet {
  if (typeof span === "boolean") return { id, seen: span, span: null };
  return { id, seen: !!span, span };
}

/**
 * The local read of one field: which facets a regex can see, and the level
 * they add up to. Capped at Specific — telling Specific from Sharp is a
 * judgement about what an answer excludes, and that is Jev's to make.
 */
export function quickRead(field: BriefField, raw: string): QuickRead {
  const text = raw.trim();
  const profile = lexicalProfile(text, field);
  const standIn = text ? standInSpan(field, text) : null;
  if (!text) return { level: 0, facets: [], standIn: null, profile };

  const tokens = tokenize(text);
  // An answer that repeats itself is padding, whatever words it repeats.
  const padded = profile.tokens >= 6 && profile.distinctRatio < 0.7;
  const substance = profile.content >= 2 || profile.proper >= 1;
  let facets: QuickFacet[] = [];

  if (field === "workingTitle") {
    const said = tokens.some(
      (t) =>
        !STOP.has(t.lower) &&
        !FIELD_META.workingTitle.has(t.lower) &&
        !t.number,
    );
    facets = [facet("named", !standIn && said)];
  } else if (field === "format") {
    const form = FORMS.exec(text);
    const venue = VENUE.exec(text);
    facets = [
      facet(
        "shape",
        form
          ? { start: form.index, end: form.index + form[0].length }
          : profile.content >= 1,
      ),
      facet("size", profile.quantity),
      facet(
        "venue",
        venue
          ? { start: venue.index, end: venue.index + venue[0].length }
          : null,
      ),
    ];
  } else if (field === "audience") {
    // A stand-in can be rescued by what follows it ("people who run night
    // shifts"); two of them are the whole answer however long it runs.
    const fillers =
      countMatches(STAND_INS.audience!, text) +
      countMatches(AUDIENCE_FILLER, text);
    const reader =
      fillers >= 2
        ? false
        : fillers === 1
          ? profile.content >= 2
          : profile.content >= 1 || profile.proper >= 1;
    facets = [
      facet("reader", reader),
      facet("knows", cueWithObject(tokens, KNOWS)),
      facet("wants", cueWithObject(tokens, WANTS)),
    ];
  } else if (field === "goal") {
    const listy =
      (text.match(/\band\b/gi)?.length ?? 0) >= 2 ||
      (text.match(/[,;]/g)?.length ?? 0) >= 3 ||
      /\b(?:and also|as well as|plus)\b/i.test(text);
    facets = [
      facet("aim", substance),
      facet("change", cueWithObject(tokens, CHANGE)),
      facet("single", substance && !listy),
    ];
  } else if (field === "tone") {
    const imitable = cueWithObject(tokens, IMITABLE);
    const avoid = cueWithObject(tokens, AVOID);
    // Several stock virtues and nothing to hold on to is the generic answer
    // at length.
    const stock = countMatches(STAND_INS.tone!, text);
    facets = [
      facet(
        "distinct",
        profile.content >= 1 && !(stock >= 2 && !imitable && !avoid),
      ),
      facet("imitable", imitable),
      facet("avoid", avoid),
    ];
  } else if (field === "successSignal") {
    const threshold =
      profile.quantity ?? spanOf(TIME_BOUND, text) ?? spanOf(UNPROMPTED, text);
    facets = [
      facet("observable", substance && !standIn),
      facet("theirs", substance && !FIRST_PERSON.test(text)),
      facet("threshold", threshold),
    ];
  }

  if (padded)
    facets = facets.map((f) =>
      FIELD_FACETS[field].find((d) => d.id === f.id)?.role === "core"
        ? f
        : { ...f, seen: false, span: null },
    );

  // Stricter than Jev's rule on purpose: the first look asks for every
  // needed facet before it says Specific, and never says Sharp.
  const defs = FIELD_FACETS[field];
  const seen = (role: FacetRole) =>
    defs
      .filter((d) => d.role === role)
      .every((d) => facets.find((f) => f.id === d.id)?.seen);
  const level: StrengthLevel = !seen("core") ? 1 : !seen("needed") ? 2 : 3;
  reading = null;
  return { level, facets, standIn, profile };
}

function spanOf(pattern: RegExp, text: string): Span | null {
  const m = pattern.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

const RULE_OPENER =
  /\b(?:no|never|must|only|every|each|all|always|maximum|minimum|max|min|do not|don't|cannot|can't)\b/i;

/** Rule words that are the frame of a constraint, never its content. */
const RULE_FRAME = wordsOf(
  "must keep never only use avoid cite cites source sources max maximum min minimum every each all",
);

/**
 * Whether a constraint line has something a draft could be held against: a
 * quantity, a name, a quoted word, or at least two words that are about the
 * piece rather than about rules.
 */
export function lineHasAnchor(line: string): boolean {
  const profile = lexicalProfile(line, "constraints");
  if (profile.quantity || profile.proper >= 1 || /["“”‘’']\w/.test(line)) {
    reading = null;
    return true;
  }
  const about = new Set(
    tokenize(line)
      .filter(
        (t) =>
          t.lower.length >= 3 &&
          !t.number &&
          !STOP.has(t.lower) &&
          !RULE_FRAME.has(t.lower) &&
          !FIELD_META.constraints.has(t.lower) &&
          !GENERIC.has(t.lower),
      )
      .map((t) => t.lower),
  );
  reading = null;
  // "No listicles" is a whole rule in two words; a frame word needs only one
  // word to be about.
  return about.size >= (RULE_OPENER.test(line) ? 1 : 2);
}

/** The quick level for a constraints answer, read line by line. */
export function quickConstraintsLevel(text: string): StrengthLevel {
  const lines = splitConstraints(text);
  if (lines.length === 0) return declaresNoConstraints(text) ? 0 : 1;
  const profile = lexicalProfile(text, "constraints");
  reading = null;
  const padded = profile.tokens >= 6 && profile.distinctRatio < 0.7;
  const anchored = lines.filter(lineHasAnchor).length;
  if (anchored === 0) return 1;
  return !padded && anchored === lines.length ? 3 : 2;
}

/* ── Clauses ───────────────────────────────────────────────────── */

export interface Clause extends Span {
  text: string;
}

/**
 * Cut an answer into the phrases a reader would hear as separate claims, so
 * Jev can point at one of them. The cut is by punctuation and by the
 * conjunctions that start a new qualification.
 */
export function cutClauses(text: string): Clause[] {
  const breaks =
    /(?:,(?!\d)|[;:—–\n])+|[.!?]+(?=\s|$)|\s+(?=(?:who|whom|whose|that|which|but|because|without|while|although|so that|rather than|instead of|unless|and)\b)/gi;
  const raw: Clause[] = [];
  let last = 0;
  const push = (start: number, end: number) => {
    const slice = text.slice(start, end);
    const lead = slice.length - slice.trimStart().length;
    const trimmed = slice.trim();
    if (trimmed)
      raw.push({
        text: trimmed,
        start: start + lead,
        end: start + lead + trimmed.length,
      });
  };
  for (const m of text.matchAll(breaks)) {
    push(last, m.index);
    last = m.index + (/^\s+$/.test(m[0]) ? 0 : m[0].length);
  }
  push(last, text.length);

  // A one-word fragment is not a claim; fold it into its neighbour.
  const clauses: Clause[] = [];
  for (const clause of raw) {
    const prev = clauses[clauses.length - 1];
    const short = clause.text.split(/\s+/).length < 2;
    if (prev && (short || prev.text.split(/\s+/).length < 2)) {
      prev.end = clause.end;
      prev.text = text.slice(prev.start, prev.end);
    } else clauses.push({ ...clause });
  }
  return clauses.slice(0, 8);
}

/** Choice options must be unique; number the clauses so they always are. */
export function clauseOptions(clauses: ReadonlyArray<Clause>): string[] {
  return clauses.map((c, i) => `${i + 1}. “${c.text}”`);
}
