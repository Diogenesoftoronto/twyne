/**
 * Answer strength for the brief, shown while the writer is still answering.
 *
 * Every brief answer is read against its field's checklist in
 * `brief-facets`: which facets hold, which do not, and the one thing to add.
 * The level (Missing → Sharp) is derived from that checklist rather than
 * asked for, so a writer can always see why an answer sits where it does.
 *
 * Two readers, like a password meter that checks locally before the server
 * does:
 *
 * - **Quick read**, here, on every keystroke. Lexical detectors look for each
 *   facet. It is built to be hard to flatter: a cue word only counts when it
 *   is followed by what it is about, repetition is padding, and it never
 *   awards Sharp. Works offline and for guests.
 * - **Jev**, on a pause. One batched request: a Noul per facet, a Choice per
 *   constraint line, a Choice over each field's readings (a flat spread is
 *   the vagueness), a Choice picking the stand-in phrase, and the whole-brief
 *   questions. Jev does not write, so every line shown is authored and
 *   selected by those answers.
 *
 * A Jev reading is only shown for the exact text it read. While the writer
 * types on, the quick read takes over but stays within one level of the last
 * reading of a similar text, so typing cue words cannot run the meter up.
 */

import type {
  ConstraintKind,
  ConstraintTriage,
  DossierProbe,
  ProjectInterviewAnswers,
} from "../types";
import {
  BEARING_LABELS,
  BRIEF_FIELD_ORDER,
  CONSTRAINT_LABELS,
  CONSTRAINT_NOTES,
  CONSTRAINT_KIND_OPTIONS,
  EDGE_MET,
  FACET_CLOSE,
  FACET_MET,
  FIELD_ARCHETYPES,
  FIELD_FACETS,
  FIELD_SCALES,
  FIRST_QUESTIONS,
  LEVEL_DIAGNOSES,
  LOAD_BEARING,
  SPLIT_SECOND_AT_LEAST,
  SPLIT_TOP_BELOW,
  STAND_IN_NOTES,
  STRENGTH_LABELS,
  STRONG_ENOUGH,
  TENSION_PAIRS,
  clauseOptions,
  constraintAsks,
  constraintKindFrom,
  constraintsLevel,
  cutClauses,
  declaresNoConstraints,
  deriveLevel,
  firstUnmetFacet,
  isBinding,
  lineHasAnchor,
  meterScore,
  nextTierFacets,
  quickConstraintsLevel,
  quickRead,
  splitConstraints,
  type BriefField,
  type FacetRole,
  type LoadBearingField,
  type Span,
  type StrengthLevel,
} from "./brief-facets";
import {
  choice as choiceQuestion,
  isChoice,
  isNoul,
  isScore,
  noul,
  score as scoreQuestion,
  type ChoiceAnswer,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "./system-one";

export { STRENGTH_LABELS, STRONG_ENOUGH };
export type { BriefField, StrengthLevel };

/* ── Views ─────────────────────────────────────────────────────── */

export interface FacetView {
  id: string;
  role: FacetRole;
  name: string;
  /** Yes, no, or — for a quick read that saw nothing either way — null. */
  met: boolean | null;
  /** Unmet, but close: one more specific word may carry it. */
  near?: boolean;
  /** Jev's probability that the facet holds. */
  p?: number;
  /** The words in the answer that show it, or that stand in for it. */
  quote?: string;
  /** What is wrong with the quoted words, when the facet is unmet. */
  note?: string;
}

/** An answer that fits two readings a single draft cannot both serve. */
export interface ReadingSplit {
  field: BriefField;
  lead: string;
  prompt: string;
  options: [string, string];
}

export interface ConstraintLineView {
  text: string;
  /** Null until Jev has read the line. */
  kind: ConstraintKind | null;
  label: string | null;
  note: string | null;
  confidence: number;
  /** The writer set this kind by hand. */
  pinned?: boolean;
}

export interface StrengthView {
  level: StrengthLevel;
  /**
   * The number on the meter, 0–100, a quarter of the range to each level. It
   * moves with every edit, so a writer can see an answer getting closer to
   * the next level before it arrives. Absent when no constraints are declared.
   */
  score?: number;
  /** Change in `score` since the last judgement of this field. */
  delta?: number;
  label: string;
  /** What the level means for this answer. */
  diagnosis: string;
  /** The one thing to add, or null when nothing is worth asking for. */
  hint: string | null;
  source: "quick" | "jev";
  /** A facet the level turns on was a close call. */
  uncertain?: boolean;
  /** The checklist behind the level. Absent for constraints. */
  facets?: FacetView[];
  /** The generic phrase to underline in the answer. */
  standIn?: Span | null;
  /** The phrase doing the most work. */
  carries?: Span | null;
  split?: ReadingSplit | null;
  /** Constraints only: each line as the room will use it. */
  lines?: ConstraintLineView[];
  /** Constraints only: the writer declared none, which is a valid answer. */
  noneDeclared?: boolean;
}

/** A Jev reading, pinned to the text it read. */
export interface JudgedStrength extends StrengthView {
  source: "jev";
  value: string;
}

export interface LineReading {
  kind: ConstraintKind;
  confidence: number;
  pinned?: boolean;
}

function view(
  level: StrengthLevel,
  hint: string | null,
  source: StrengthView["source"],
  extra: Partial<StrengthView> & { progress?: number } = {},
): StrengthView {
  const { progress = 0, ...rest } = extra;
  extra = rest;
  return {
    level,
    score: meterScore(level, progress),
    label: STRENGTH_LABELS[level],
    diagnosis: LEVEL_DIAGNOSES[level],
    hint: level >= 4 ? null : hint,
    source,
    ...extra,
  };
}

function quote(text: string, span: Span | null | undefined): string | undefined {
  if (!span) return undefined;
  const words = text.slice(span.start, span.end).trim();
  return words || undefined;
}

/** "2 of 3": how many of the facets a writer must clear are cleared. */
export function facetTally(v: StrengthView): { met: number; of: number } | null {
  const counted = v.facets?.filter((f) => f.role !== "edge");
  if (!counted?.length) return null;
  return { met: counted.filter((f) => f.met).length, of: counted.length };
}

/* ── Quick read ────────────────────────────────────────────────── */

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/**
 * How much of an earlier answer survives in the current one, 0–1. Measured
 * against the earlier text, so an answer that was extended still counts as
 * the same answer and one that was rewritten does not.
 */
function kept(earlier: string, current: string): number {
  const before = wordSet(earlier);
  const now = wordSet(current);
  if (!before.size) return 0;
  let shared = 0;
  for (const w of before) if (now.has(w)) shared++;
  return shared / before.size;
}

function clampLevel(n: number): StrengthLevel {
  return Math.max(0, Math.min(4, Math.round(n))) as StrengthLevel;
}

const NONE_DECLARED_VIEW: Pick<
  StrengthView,
  "label" | "diagnosis" | "noneDeclared"
> = {
  label: "None declared",
  diagnosis: "nothing binds; the room weighs every note on its merits",
  noneDeclared: true,
};

function lineView(text: string, reading?: LineReading): ConstraintLineView {
  return {
    text,
    kind: reading?.kind ?? null,
    label: reading ? CONSTRAINT_LABELS[reading.kind] : null,
    note: reading ? CONSTRAINT_NOTES[reading.kind] : null,
    confidence: reading?.confidence ?? 0,
    ...(reading?.pinned ? { pinned: true } : {}),
  };
}

const CONSTRAINT_HINTS = {
  uncheckable:
    "Restate the lines marked uncheckable as something a draft could break.",
  unbound:
    "Nothing here binds. If one of these is a rule, say so: must, never, no more than.",
  preference:
    "The preferences will be weighed, not enforced. Tap a label to make one binding.",
  quick: "Make each line checkable: could someone say yes or no against a draft?",
  weak: "List the rules a draft could break: sources, length, words to avoid.",
};

/**
 * Constraints are graded by what the room can do with each line. With every
 * line read, this is Jev's view; with some unread, the read lines keep their
 * labels and the level falls back to the quick read.
 */
export function constraintsStrength(
  raw: string,
  readings: Readonly<Record<string, LineReading>> = {},
): StrengthView {
  if (declaresNoConstraints(raw))
    return { ...view(0, null, "quick"), ...NONE_DECLARED_VIEW, score: undefined };
  const texts = splitConstraints(raw);
  const lines = texts.map((text) => lineView(text, readings[text]));
  const read = lines.filter((l) => l.kind);
  if (texts.length > 0 && read.length === texts.length) {
    const kinds = read.map((l) => l.kind!);
    const level = constraintsLevel(kinds);
    // Within a level, the share of lines the room can enforce.
    const progress = kinds.filter(isBinding).length / kinds.length;
    const hint = kinds.includes("uncheckable")
      ? CONSTRAINT_HINTS.uncheckable
      : !kinds.some(isBinding)
        ? CONSTRAINT_HINTS.unbound
        : kinds.includes("preference")
          ? CONSTRAINT_HINTS.preference
          : null;
    return view(level, hint, "jev", { lines, progress });
  }
  const level = quickConstraintsLevel(raw);
  const anchored = texts.filter(lineHasAnchor).length;
  return view(
    level,
    level <= 1
      ? CONSTRAINT_HINTS.weak
      : texts.every(lineHasAnchor)
        ? null
        : CONSTRAINT_HINTS.quick,
    "quick",
    {
      lines,
      progress: texts.length ? (anchored / texts.length) * 0.6 : 0,
    },
  );
}

/**
 * The instant local read. It never awards Sharp, and given the last Jev
 * reading of a similar text it stays within one level of it: the quick read
 * may notice an edit, but only Jev may be persuaded by one.
 */
export function quickFieldStrength(
  field: BriefField,
  raw: string,
  anchor?: JudgedStrength,
): StrengthView {
  if (field === "constraints") return constraintsStrength(raw);
  const value = raw.trim();
  const defs = FIELD_FACETS[field];
  if (!value) return view(0, defs[0]?.add ?? null, "quick");

  const read = quickRead(field, value);
  let level = read.level;
  if (anchor && anchor.level > 0 && kept(anchor.value, value) >= 0.6)
    level = clampLevel(
      Math.min(3, Math.max(anchor.level - 1, Math.min(anchor.level + 1, level))),
    );

  const seen = Object.fromEntries(read.facets.map((f) => [f.id, f]));
  const facets: FacetView[] = defs
    .filter((d) => d.role !== "edge")
    .map((d) => ({
      id: d.id,
      role: d.role,
      name: d.name,
      met: seen[d.id]?.seen ? true : null,
      ...(seen[d.id]?.span ? { quote: quote(value, seen[d.id].span) } : {}),
    }));
  const met = Object.fromEntries(read.facets.map((f) => [f.id, f.seen]));
  // Progress through the level: the next level's facets already seen, plus
  // credit for words that are about the piece, so the number answers each
  // keystroke rather than waiting for a tick to flip.
  const next = nextTierFacets(field, level);
  const seenShare = next.length
    ? next.filter((d) => met[d.id]).length / next.length
    : 0;
  const substance = Math.min(read.profile.content / 6, 1);
  return view(level, firstUnmetFacet(field, met)?.add ?? null, "quick", {
    facets,
    standIn: read.standIn,
    progress: 0.55 * seenShare + 0.4 * substance,
  });
}

/* ── Jev: the request ──────────────────────────────────────────── */

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

export interface StrengthAskOptions {
  /** Constraint lines already read; they are not asked about again. */
  knownLines?: Iterable<string>;
  /** Ask the whole-brief questions. Defaults to "once there is enough brief". */
  whole?: boolean;
}

/**
 * Each line costs three questions, so a long list is read across two
 * requests rather than crowding the field checklists out of one.
 */
const LINES_PER_REQUEST = 6;
/** One request holds at most 64 questions; more is refused outright. */
const QUESTION_BUDGET = 64;
/** Fields whose stand-in phrase is worth pointing at. */
const STAND_IN_FIELDS: BriefField[] = [
  "audience",
  "goal",
  "successSignal",
  "tone",
];

/** Question ids, shared with the eval runner so it can read raw answers. */
export const STRENGTH_KEYS = {
  facet: (field: BriefField, id: string) => `f_${field}_${id}`,
  line: (i: number, part: "check" | "vague" | "kind") => `line_${i}_${part}`,
  scale: (field: BriefField) => `scale_${field}`,
  arch: (field: BriefField) => `arch_${field}`,
  generic: (field: BriefField) => `generic_${field}`,
  standIn: (field: BriefField) => `standin_${field}`,
  carries: (field: BriefField) => `carries_${field}`,
};
const k = STRENGTH_KEYS;

function linesToAsk(
  answers: ProjectInterviewAnswers,
  opts: StrengthAskOptions,
): string[] {
  const known = new Set(opts.knownLines ?? []);
  return [...new Set(splitConstraints(answers.constraints ?? ""))]
    .filter((line) => !known.has(line))
    .slice(0, LINES_PER_REQUEST);
}

function tensionOptions(answers: ProjectInterviewAnswers) {
  return TENSION_PAIRS.filter(
    (pair) => answers[pair.a]?.trim() && answers[pair.b]?.trim(),
  );
}

/**
 * "Could a stranger write it?", asked as the three things a stranger needs.
 * The open form of the question ("…without asking a follow-up?") did not
 * separate a sharp brief from a long vague one on the fixtures (means 0.44
 * and 0.44); naming the three parts did (0.83–0.95 against 0.08–0.20).
 */
export const SUFFICIENT_ASK =
  "Imagine handing this brief to a freelance writer you will never speak to. Does the brief tell them all three of these: who specifically will read the piece, what specific result it must achieve with that reader, and how anyone would observe that it worked?";
/**
 * Tension is asked twice and averaged. The first wording catches every real
 * conflict and also fires on briefs that are merely terse; the second is
 * quiet on coherent briefs and misses the subtler conflicts. Their mean
 * keeps the two apart.
 */
export const CONTRADICTORY_ASKS = [
  "Do any two parts of this brief pull against each other — for example a tone that fights the goal, or a constraint that makes the success signal unreachable?",
  "Do any two entries in this brief make incompatible demands, so that a draft satisfying one would have to fail the other?",
];

/**
 * Every question for one pause, most important first, so a brief too large
 * for one request loses its underlines before it loses its levels.
 */
export function buildBriefStrengthQuestions(
  answers: ProjectInterviewAnswers,
  fields: ReadonlyArray<BriefField>,
  opts: StrengthAskOptions = {},
): Record<string, SystemOneQuestion> {
  const asked = fields.filter((field) => answers[field]?.trim());
  const tiers: Array<Array<[string, SystemOneQuestion]>> = [[], [], [], [], []];

  for (const field of asked) {
    for (const facet of FIELD_FACETS[field])
      tiers[0].push([k.facet(field, facet.id), noul(facet.ask)]);
    const scale = FIELD_SCALES[field];
    if (scale)
      tiers[0].push([
        k.scale(field),
        scoreQuestion(`${scale.ask} Judge only that entry.`, scale.levels),
      ]);
  }

  if (fields.includes("constraints"))
    linesToAsk(answers, opts).forEach((line, i) => {
      const asks = constraintAsks(line);
      tiers[1].push(
        [k.line(i, "check"), noul(asks.checkable)],
        [k.line(i, "vague"), noul(asks.vague)],
        [k.line(i, "kind"), choiceQuestion(asks.kind, CONSTRAINT_KIND_OPTIONS)],
      );
    });

  const filled = filledFieldCount(answers);
  if (opts.whole ?? filled >= 4) {
    tiers[2].push(["sufficient", noul(SUFFICIENT_ASK)]);
    tiers[2].push([
      "firstq",
      choiceQuestion(
        "A competent writer who has never spoken to this person is handed this brief and may ask one question before starting. Which question do they most need answered?",
        BRIEF_FIELD_ORDER.map((field) => FIRST_QUESTIONS[field]),
      ),
    ]);
    const pairs = tensionOptions(answers);
    tiers[2].push(
      ["contradictory", noul(CONTRADICTORY_ASKS[0])],
      ["incompatible", noul(CONTRADICTORY_ASKS[1])],
    );
    if (pairs.length >= 2)
      tiers[2].push([
        "tension",
        choiceQuestion(
          "Suppose two parts of this brief pull against each other. Which pair is it?",
          pairs.map((pair) => pair.option),
        ),
      ]);
  }

  for (const field of asked) {
    const set = FIELD_ARCHETYPES[field];
    if (set)
      tiers[3].push([
        k.arch(field),
        choiceQuestion(
          set.ask,
          set.options.map((o) => o.option),
        ),
      ]);
  }

  for (const field of asked) {
    if (!STAND_IN_FIELDS.includes(field)) continue;
    tiers[4].push([
      k.generic(field),
      noul(
        `Does the \`${field}\` entry contain a generic stand-in: words that would fit almost any piece of writing, in place of information about this one?`,
      ),
    ]);
    const clauses = cutClauses(answers[field].trim());
    if (clauses.length < 2) continue;
    const options = clauseOptions(clauses);
    tiers[4].push([
      k.standIn(field),
      choiceQuestion(
        `Which part of the \`${field}\` entry is the most generic, the part that would fit almost any piece of writing?`,
        options,
      ),
    ]);
    if ((LOAD_BEARING as ReadonlyArray<BriefField>).includes(field))
      tiers[4].push([
        k.carries(field),
        choiceQuestion(
          `Which part of the \`${field}\` entry tells a writer the most about this particular piece?`,
          options,
        ),
      ]);
  }

  return Object.fromEntries(tiers.flat().slice(0, QUESTION_BUDGET));
}

/* ── Jev: the reading ──────────────────────────────────────────── */

/** A stand-in is underlined only when Jev is fairly sure there is one. */
const GENERIC_AT = 0.6;
/** …and fairly sure which phrase it is. */
const CLAUSE_AT = 0.45;
/** A whole one-clause answer is underlined only when it clearly is one. */
const WHOLE_GENERIC_AT = 0.75;

/** At or above this the brief's parts are pulling against each other. */
export const TENSION_AT = 0.55;
/** The brief has to be at least this writable to bear weight. */
export const SUFFICIENT_AT = 0.6;
/** Which pair is in tension must be more than a coin toss among the options. */
const TENSION_PAIR_AT = 0.4;

export interface FirstQuestion {
  field: BriefField;
  question: string;
}

export interface Tension {
  a: BriefField;
  b: BriefField;
  reason: string;
  probability: number;
  /** The two answers it was read from. */
  values: [string, string];
}

export interface BriefStrengthReading {
  fields: Partial<Record<BriefField, JudgedStrength>>;
  /** Constraint lines read in this request, by line text. */
  lines: Record<string, LineReading>;
  sufficiency: number | null;
  contradiction: number | null;
  /** How likely each field is to be a stranger's first question. */
  firstQuestionOdds: Partial<Record<BriefField, number>> | null;
  tension: Tension | null;
}

function ranked(answer: ChoiceAnswer): Array<[string, number]> {
  return Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
}

function readSplit(
  field: BriefField,
  answer: SystemOneAnswer | undefined,
): ReadingSplit | null {
  const set = FIELD_ARCHETYPES[field];
  if (!set || !isChoice(answer)) return null;
  const [first, second] = ranked(answer);
  if (!first || !second) return null;
  if (first[1] >= SPLIT_TOP_BELOW || second[1] < SPLIT_SECOND_AT_LEAST)
    return null;
  const label = (option: string) =>
    set.options.find((o) => o.option === option)?.label;
  const a = label(first[0]);
  const b = label(second[0]);
  if (!a || !b) return null;
  return { field, lead: set.lead, prompt: set.prompt, options: [a, b] };
}

function readClause(
  text: string,
  answer: SystemOneAnswer | undefined,
  floor: number,
): Span | null {
  if (!isChoice(answer)) return null;
  const clauses = cutClauses(text);
  const index = clauseOptions(clauses).indexOf(answer.choice);
  if (index < 0 || (answer.probabilities[answer.choice] ?? 0) < floor)
    return null;
  return { start: clauses[index].start, end: clauses[index].end };
}

function readField(
  field: BriefField,
  value: string,
  response: Record<string, SystemOneAnswer>,
): JudgedStrength | null {
  const defs = FIELD_FACETS[field];
  const p: Record<string, number> = {};
  for (const def of defs) {
    const answer = response[k.facet(field, def.id)];
    if (isNoul(answer)) p[def.id] = answer.noul;
    // Without every facet that sets the level there is no level to show.
    else if (def.role !== "edge") return null;
  }
  const met = Object.fromEntries(
    defs.map((def) => [
      def.id,
      def.id in p && p[def.id] >= (def.role === "edge" ? EDGE_MET : FACET_MET),
    ]),
  );
  const level = deriveLevel(field, met);
  const miss = firstUnmetFacet(field, met);
  const close = (id: string) =>
    id in p && p[id] > FACET_CLOSE[0] && p[id] < FACET_CLOSE[1];
  // The level turns on the first facet that failed, or — when a tier just
  // passed — on the weakest facet that carried it.
  const uncertain = miss
    ? close(miss.id)
    : defs.some((def) => close(def.id));

  const local = Object.fromEntries(
    quickRead(field, value).facets.map((f) => [f.id, f.span]),
  );
  const clauses = cutClauses(value);
  const generic = response[k.generic(field)];
  const genericP = isNoul(generic) ? generic.noul : 0;
  let standIn: Span | null = null;
  if (level < 4 && genericP >= GENERIC_AT) {
    if (clauses.length >= 2)
      standIn = readClause(value, response[k.standIn(field)], CLAUSE_AT);
    else if (level <= 2 && genericP >= WHOLE_GENERIC_AT)
      standIn = { start: 0, end: value.length };
  }
  let carries =
    clauses.length >= 2
      ? readClause(value, response[k.carries(field)], CLAUSE_AT)
      : null;
  if (carries && standIn && carries.start === standIn.start) carries = null;

  // The ledger shows the facets a writer must clear, and the edge only once
  // they have: "rules a draft out" is noise above an unmet "names a reader".
  // How far through its level the answer is: how close the next level's
  // facets are to passing, and where the field's own scale puts it.
  const next = nextTierFacets(field, level);
  const closeness = next.length
    ? next.reduce(
        (sum, def) =>
          sum +
          Math.min(
            1,
            (p[def.id] ?? 0) / (def.role === "edge" ? EDGE_MET : FACET_MET),
          ),
        0,
      ) / next.length
    : 0;
  const scale = response[k.scale(field)];
  const scaled = isScore(scale)
    ? Math.max(0, Math.min(1, scale.score - (level >= 4 ? 3 : level)))
    : null;
  const progress = scaled === null ? closeness : (closeness + scaled) / 2;
  // Two readings of one answer a level and a half apart is not a firm one.
  const disputed = isScore(scale) && Math.abs(scale.score - level) >= 1.5;

  const shown = defs.filter((def) => def.role !== "edge" || level >= 3);
  const core = defs.find((def) => def.role === "core");
  const facets: FacetView[] = shown.map((def) => {
    const isMet = met[def.id];
    const evidence = isMet
      ? (quote(value, local[def.id]) ??
        (def === core ? quote(value, carries) : undefined))
      : def === miss
        ? quote(value, standIn)
        : undefined;
    return {
      id: def.id,
      role: def.role,
      name: def.name,
      met: isMet,
      ...(!isMet && close(def.id) ? { near: true } : {}),
      ...(def.id in p ? { p: p[def.id] } : {}),
      ...(evidence ? { quote: evidence } : {}),
      ...(!isMet && def === miss && evidence && STAND_IN_NOTES[field]
        ? { note: STAND_IN_NOTES[field] }
        : {}),
    };
  });

  const split = level <= 2 ? readSplit(field, response[k.arch(field)]) : null;
  return {
    ...view(level, miss?.add ?? null, "jev", {
      facets,
      standIn,
      carries,
      progress,
      ...(split ? { split } : {}),
      ...(uncertain || disputed ? { uncertain: true } : {}),
    }),
    source: "jev",
    value,
  };
}

export function readBriefStrengths(
  answers: ProjectInterviewAnswers,
  fields: ReadonlyArray<BriefField>,
  response: Record<string, SystemOneAnswer>,
  opts: StrengthAskOptions = {},
): BriefStrengthReading {
  const out: Partial<Record<BriefField, JudgedStrength>> = {};
  for (const field of fields) {
    if (field === "constraints") continue;
    const value = answers[field]?.trim();
    if (!value) continue;
    const read = readField(field, value, response);
    if (read) out[field] = read;
  }

  const lines: Record<string, LineReading> = {};
  if (fields.includes("constraints"))
    linesToAsk(answers, opts).forEach((line, i) => {
      const check = response[k.line(i, "check")];
      const vague = response[k.line(i, "vague")];
      const kind = response[k.line(i, "kind")];
      if (!isNoul(check) || !isNoul(vague) || !isChoice(kind)) return;
      lines[line] = constraintKindFrom({
        checkable: check.noul,
        vague: vague.noul,
        kind: { option: kind.choice, p: kind.probabilities[kind.choice] ?? 0 },
      });
    });

  const sufficient = response.sufficient;
  const sufficiency = isNoul(sufficient) ? sufficient.noul : null;
  const pulls = [response.contradictory, response.incompatible]
    .filter(isNoul)
    .map((a) => a.noul);
  const contradiction = pulls.length
    ? pulls.reduce((sum, p) => sum + p, 0) / pulls.length
    : null;

  let firstQuestionOdds: BriefStrengthReading["firstQuestionOdds"] = null;
  const firstq = response.firstq;
  if (isChoice(firstq)) {
    firstQuestionOdds = {};
    for (const field of BRIEF_FIELD_ORDER)
      firstQuestionOdds[field] =
        firstq.probabilities[FIRST_QUESTIONS[field]] ?? 0;
  }

  let tension: Tension | null = null;
  const pick = response.tension;
  if (isChoice(pick) && contradiction !== null && contradiction >= TENSION_AT) {
    const pair = TENSION_PAIRS.find((p) => p.option === pick.choice);
    if (pair && (pick.probabilities[pick.choice] ?? 0) >= TENSION_PAIR_AT)
      tension = {
        a: pair.a,
        b: pair.b,
        reason: pair.reason,
        probability: contradiction,
        values: [answers[pair.a].trim(), answers[pair.b].trim()],
      };
  }

  return {
    fields: out,
    lines,
    sufficiency,
    contradiction,
    firstQuestionOdds,
    tension,
  };
}

/**
 * What a stranger handed this brief would ask first. The field is the
 * weakest of the three load-bearing answers, then the form; Jev's pick only
 * breaks a tie between equally weak ones. Asking Jev to choose the field
 * outright went to "who is reading this?" even for a brief whose reader was
 * its best answer and whose landing was blank.
 */
export function strangersFirstQuestion(
  answers: ProjectInterviewAnswers,
  views: Partial<Record<BriefField, StrengthView>>,
  odds: Partial<Record<BriefField, number>> | null,
): FirstQuestion | null {
  if (filledFieldCount(answers) < 4) return null;
  const level = (field: BriefField) =>
    answers[field]?.trim() ? (views[field]?.level ?? 0) : 0;
  for (const tier of [["goal", "audience", "successSignal"], ["format"]] as
    | BriefField[][]) {
    const weak = tier.filter((field) => level(field) < STRONG_ENOUGH);
    if (!weak.length) continue;
    const lowest = Math.min(...weak.map(level));
    const field = weak
      .filter((f) => level(f) === lowest)
      .sort((a, b) => (odds?.[b] ?? 0) - (odds?.[a] ?? 0))[0];
    const miss = answers[field]?.trim()
      ? views[field]?.facets?.find((f) => f.met !== true)
      : undefined;
    const def = FIELD_FACETS[field].find((d) => d.id === miss?.id);
    return { field, question: def?.question ?? FIRST_QUESTIONS[field] };
  }
  return null;
}

/**
 * The brief's soft answers and what to ask of each, weakest first: the
 * stranger's first question, then every other filled answer below Specific.
 * This is what the Particulars questions are drafted from.
 */
export function softSpots(
  answers: ProjectInterviewAnswers,
  views: Partial<Record<BriefField, StrengthView>>,
  odds: Partial<Record<BriefField, number>> | null,
): FirstQuestion[] {
  const spots: FirstQuestion[] = [];
  const first = strangersFirstQuestion(answers, views, odds);
  if (first) spots.push(first);
  const bearing = new Set<BriefField>(LOAD_BEARING);
  const rest = BRIEF_FIELD_ORDER.filter((field) => {
    const v = views[field];
    return (
      field !== first?.field &&
      !!answers[field]?.trim() &&
      !!v &&
      !v.noneDeclared &&
      v.level < STRONG_ENOUGH
    );
  }).sort(
    (a, b) =>
      Number(bearing.has(b)) - Number(bearing.has(a)) ||
      views[a]!.level - views[b]!.level,
  );
  for (const field of rest) {
    const miss = views[field]!.facets?.find((f) => f.met !== true);
    const def = FIELD_FACETS[field].find((d) => d.id === miss?.id);
    spots.push({ field, question: def?.question ?? FIRST_QUESTIONS[field] });
  }
  return spots;
}

/* ── Display ───────────────────────────────────────────────────── */

/** Jev's reading when it read exactly this text; otherwise the quick read. */
export function strengthFor(
  field: BriefField,
  value: string,
  judged: JudgedStrength | undefined,
  lines?: Readonly<Record<string, LineReading>>,
): StrengthView {
  if (field === "constraints") return constraintsStrength(value, lines);
  if (judged && judged.value === value.trim()) return judged;
  return quickFieldStrength(field, value, judged);
}

export function filledFieldCount(answers: ProjectInterviewAnswers): number {
  return Object.values(answers).filter((v) => String(v ?? "").trim()).length;
}

/**
 * The answer to raise next. The three load-bearing answers come first, since
 * everything downstream is measured against them; then any other filled
 * answer below Specific. Unfilled fields are the form's job, not a nudge's.
 */
export function weakestField(
  views: Partial<Record<BriefField, StrengthView>>,
  order: ReadonlyArray<BriefField>,
): BriefField | null {
  const weak = (field: BriefField) => {
    const v = views[field];
    return !!v && v.level > 0 && v.level < STRONG_ENOUGH;
  };
  const pick = (fields: ReadonlyArray<BriefField>) => {
    let best: BriefField | null = null;
    for (const field of fields)
      if (weak(field) && (!best || views[field]!.level < views[best]!.level))
        best = field;
    return best;
  };
  const bearing = new Set<BriefField>(LOAD_BEARING);
  return (
    pick(order.filter((f) => bearing.has(f))) ??
    pick(order.filter((f) => !bearing.has(f)))
  );
}

/* ── Whole brief ───────────────────────────────────────────────── */

export interface BriefStanding {
  /** Jev has read this answer at Specific or better. */
  held: Record<LoadBearingField, boolean>;
  /** The brief is as strong as its weakest load-bearing answer. */
  level: StrengthLevel;
  weakest: LoadBearingField | null;
  /**
   * Whether judgements made against this brief mean anything. When false,
   * `targetFit` and the note gate are measuring the brief's vagueness.
   */
  loadBearing: boolean;
  /** What keeps it soft, in the order to fix it. */
  soft: string[];
}

export interface StandingInput {
  /** Level per load-bearing field, and whether Jev (not the quick read) set it. */
  levels: Partial<
    Record<LoadBearingField, { level: StrengthLevel; confirmed: boolean }>
  >;
  sufficiency: number | null;
  contradiction: number | null;
  /** Constraint lines the writer believes bind and the room cannot check. */
  uncheckable: number;
}

/**
 * The brief's standing: not an average. Seven adequate answers do not make a
 * brief if the reader, the goal or the landing is soft, because those three
 * are what the draft is graded against.
 */
export function briefStanding(input: StandingInput): BriefStanding {
  const held = {} as Record<LoadBearingField, boolean>;
  let weakest: LoadBearingField | null = null;
  let level: StrengthLevel = 4;
  for (const field of LOAD_BEARING) {
    const read = input.levels[field];
    const fieldLevel = read?.level ?? 0;
    held[field] = !!read?.confirmed && fieldLevel >= STRONG_ENOUGH;
    if (fieldLevel < level) {
      level = fieldLevel;
      weakest = field;
    }
  }
  const soft: string[] = [];
  for (const field of LOAD_BEARING)
    if (!held[field])
      soft.push(
        `${BEARING_LABELS[field]} is ${STRENGTH_LABELS[input.levels[field]?.level ?? 0].toLowerCase()}`,
      );
  if (input.contradiction !== null && input.contradiction >= TENSION_AT)
    soft.push("two answers pull apart");
  if (input.uncheckable > 0)
    soft.push(
      input.uncheckable === 1
        ? "one rule cannot be checked"
        : `${input.uncheckable} rules cannot be checked`,
    );
  if (input.sufficiency === null || input.sufficiency < SUFFICIENT_AT)
    if (soft.length === 0) soft.push("a stranger could not yet write it");
  return {
    held,
    level,
    weakest: level >= STRONG_ENOUGH ? null : weakest,
    loadBearing:
      soft.length === 0 &&
      input.sufficiency !== null &&
      input.sufficiency >= SUFFICIENT_AT,
    soft,
  };
}

/** The standing of a brief being written, from the live views. */
export function standingFromViews(
  views: Partial<Record<BriefField, StrengthView>>,
  whole: { sufficiency: number | null; contradiction: number | null },
): BriefStanding {
  const levels: StandingInput["levels"] = {};
  for (const field of LOAD_BEARING) {
    const v = views[field];
    if (v) levels[field] = { level: v.level, confirmed: v.source === "jev" };
  }
  return briefStanding({
    levels,
    sufficiency: whole.sufficiency,
    contradiction: whole.contradiction,
    uncheckable:
      views.constraints?.lines?.filter((l) => l.kind === "uncheckable")
        .length ?? 0,
  });
}

/* ── Splits → Particulars ──────────────────────────────────────── */

export const SPLIT_PROBE_PREFIX = "split-";

/** The question a split files to Particulars, one per field. */
export function splitProbe(split: ReadingSplit): DossierProbe {
  return {
    id: `${SPLIT_PROBE_PREFIX}${split.field}`,
    kind: "choice",
    prompt: split.prompt,
    options: [...split.options],
    relatesTo: split.field,
  };
}

/**
 * Keep Particulars in step with the splits Jev currently sees: a new split
 * files its question, a resolved one withdraws it. A question the writer has
 * answered is theirs and stays, whatever Jev thinks now.
 */
export function syncSplitProbes(
  probes: ReadonlyArray<DossierProbe>,
  views: Partial<Record<BriefField, StrengthView>>,
): DossierProbe[] {
  const answered = (p: DossierProbe) => p.answer !== undefined;
  const wanted = new Map<string, DossierProbe>();
  for (const v of Object.values(views))
    if (v?.source === "jev" && v.split) {
      const probe = splitProbe(v.split);
      wanted.set(probe.id, probe);
    }
  const next: DossierProbe[] = [];
  for (const probe of probes) {
    if (!probe.id.startsWith(SPLIT_PROBE_PREFIX)) next.push(probe);
    else if (answered(probe)) next.push(probe);
    else if (wanted.has(probe.id)) next.push(wanted.get(probe.id)!);
    wanted.delete(probe.id);
  }
  return [...wanted.values(), ...next];
}

/* ── Constraint triage ─────────────────────────────────────────── */

/**
 * The triage to file with the brief: every line Jev (or the writer) has
 * classified, pinned to the constraints text. Null until every line is read,
 * so a half-read list never filters the note gate.
 */
export function triageFromLines(
  constraints: string,
  readings: Readonly<Record<string, LineReading>>,
  at = Date.now(),
): ConstraintTriage | null {
  const texts = splitConstraints(constraints);
  if (texts.length === 0 || texts.some((text) => !readings[text])) return null;
  return {
    source: constraints,
    lines: texts.map((text) => ({
      text,
      kind: readings[text].kind,
      confidence: readings[text].confidence,
    })),
    at,
  };
}

/** The writer's tap on a label: binding ↔ weighed. */
export function toggleBinding(kind: ConstraintKind): ConstraintKind {
  return isBinding(kind) ? "preference" : "editorial";
}

/* ── When to ask Jev ───────────────────────────────────────────── */

/**
 * How long after the last keystroke a judgement is asked for. Every
 * keystroke restarts the wait, so nothing is sent while the writer is typing.
 */
export const PAUSE_MS = 350;
/**
 * Requests are never closer together than this. A writer who types in short
 * bursts pauses for 350 ms every few words; without a floor each of those
 * pauses would be a request. Whatever is typed inside the gap goes out as
 * one request when it closes.
 */
export const MIN_GAP_MS = 3_000;
/** Leaving a field settles for a moment before it is read. */
export const LEAVE_MS = 150;

/**
 * How long to wait before sending, from now. A pause waits out the debounce
 * and whatever is left of the gap since the last request; leaving the field
 * or turning the page is a deliberate stop and is read straight away.
 */
export function sendDelay(
  trigger: "pause" | "leave",
  sinceLastRequest: number,
): number {
  if (trigger === "leave") return LEAVE_MS;
  return Math.max(PAUSE_MS, MIN_GAP_MS - sinceLastRequest);
}
