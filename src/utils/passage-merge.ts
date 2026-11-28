/**
 * Folding one paragraph into another.
 *
 * Three readings, each from the tool suited to it, and code in between:
 *
 *   which     the decision model chooses among four outcomes for a pair of
 *             paragraphs: keep this one, keep the other, set them side by
 *             side, or leave them alone.
 *   evidence  the extraction model points at the sentences each paragraph
 *             repeats from the other. Its answers are spans of the text it
 *             was given, so they can be shown and acted on exactly.
 *   the fold  code keeps one paragraph whole and carries over the sentences
 *             of the other that it does not already say. No words are
 *             written for the writer: every sentence is one of theirs.
 *
 * Without the extraction model, shared words stand in for the evidence.
 * Pure: the conductor owns the manuscript and the requests.
 */
import {
  list,
  type ExtractionAnswer,
  type ExtractionRequest,
} from "./extraction";
import { tokens } from "./flow-connections";
import { splitSentences } from "./struggle-signals";

/** A stretch of one paragraph's text: [from, to). */
export interface TextSpan {
  from: number;
  to: number;
}

/* ── Which: the decision model ─────────────────────────────────── */

export type MergeAdvice = "fold-here" | "fold-there" | "together" | "apart";

const ADVICE: readonly MergeAdvice[] = [
  "fold-here",
  "fold-there",
  "together",
  "apart",
];

/**
 * One choice over two paragraphs of the same draft, named by their fields in
 * the request's state. The options are outcomes for the page, so the answer
 * can be acted on without a second question.
 */
export function mergeQuestion(
  here: string,
  other: string,
  preface = "",
): { type: "choice"; instructions: string; criteria: string[] } {
  return {
    type: "choice",
    instructions:
      `${preface} \`${here}\` and \`${other}\` are two paragraphs of the same draft, and a reader should meet each point once. What should the writer do with these two paragraphs? Merge them only when they make the same point, keeping the one that makes it more fully. Place them together when they make different points about one subject. Leave them where they are when the distance between them does work, as with a setup and its payoff or a deliberate return to an image.`.trim(),
    criteria: [
      `Merge them and keep \`${here}\`, which makes the point more fully`,
      `Merge them and keep \`${other}\`, which makes the point more fully`,
      "Keep both and place them next to each other",
      "Leave both where they are",
    ],
  };
}

export function readMergeAdvice(
  choice: string | undefined,
  criteria: readonly string[],
): MergeAdvice | null {
  const at = choice === undefined ? -1 : criteria.indexOf(choice);
  return ADVICE[at] ?? null;
}

/**
 * The advice a relation can carry. A promise and its payoff, or an image
 * that returns, work because they are apart; a tension can be set side by
 * side but folding it would erase one of its sides.
 */
export function adviceFor(
  relation: string | undefined,
  advice: MergeAdvice | null,
): MergeAdvice | null {
  if (!advice || advice === "apart") return null;
  if (relation === "Repetition" || relation === "Same subject") return advice;
  return relation === "Tension" && advice === "together" ? advice : null;
}

/**
 * Whether a fold may be offered for a pair at all. A relation that works at
 * a distance never is. A repetition or a shared subject always is. A pair
 * nothing has read for meaning is only once the evidence finds a sentence
 * one paragraph repeats from the other.
 */
export function foldOffer(
  relation: string | undefined,
): "always" | "if-repeats" | "never" {
  if (relation === "Repetition" || relation === "Same subject") return "always";
  return relation === "Unpaid promise" ||
    relation === "Tension" ||
    relation === "Echo"
    ? "never"
    : "if-repeats";
}

export const isMergeAdvice = (value: unknown): value is MergeAdvice =>
  ADVICE.includes(value as MergeAdvice);

/* ── Evidence: the sentences each paragraph repeats ────────────── */

export interface MergeEvidence {
  /** Sentences of the paragraph being written that the other also says. */
  here: TextSpan[];
  /** Sentences of the other paragraph that this one also says. */
  other: TextSpan[];
  /** A reading of what the sentences say, or only the words they share. */
  source: "reading" | "words";
}

const FIRST = "FIRST PARAGRAPH\n";
const SECOND = "\n\nSECOND PARAGRAPH\n";

const repeatField = (own: string, against: string) =>
  list(
    "text",
    `Every sentence of the ${own} paragraph that makes a point the ${against} paragraph also makes. Whole sentences, copied from the ${own} paragraph only. Nothing when the two paragraphs make different points.`,
  );

/** Both paragraphs in one state, so each answer is a span of one of them. */
export function evidenceRequest(
  here: string,
  other: string,
): ExtractionRequest {
  return {
    state: `${FIRST}${here}${SECOND}${other}`,
    fields: {
      first: repeatField("first", "second"),
      second: repeatField("second", "first"),
    },
  };
}

/** Whole sentences at least half covered by the spans given. */
export function snapToSentences(
  text: string,
  spans: readonly TextSpan[],
): TextSpan[] {
  return splitSentences(text)
    .filter((sentence) => {
      let covered = 0;
      for (const span of spans)
        covered += Math.max(
          0,
          Math.min(span.to, sentence.to) - Math.max(span.from, sentence.from),
        );
      return covered * 2 >= sentence.to - sentence.from;
    })
    .map(({ from, to }) => ({ from, to }));
}

/**
 * The extraction model's answer as sentences of each paragraph. A span that
 * strays outside its own paragraph is not evidence about it and is dropped.
 */
export function readEvidence(
  here: string,
  other: string,
  answers: Record<string, ExtractionAnswer> | undefined,
): MergeEvidence | null {
  if (!answers?.first && !answers?.second) return null;
  const within = (
    answer: ExtractionAnswer | undefined,
    start: number,
    text: string,
  ) =>
    snapToSentences(
      text,
      (answer?.spans ?? []).flatMap(([from, to]) =>
        from >= start && to <= start + text.length && to > from
          ? [{ from: from - start, to: to - start }]
          : [],
      ),
    );
  return {
    here: within(answers.first, FIRST.length, here),
    other: within(
      answers.second,
      FIRST.length + here.length + SECOND.length,
      other,
    ),
    source: "reading",
  };
}

/** Share of a sentence's distinctive words another sentence must hold. */
const SAME_WORDS = 0.6;

/** Without a reading: sentences that share most of their distinctive words. */
export function localEvidence(here: string, other: string): MergeEvidence {
  const repeats = (text: string, against: string): TextSpan[] => {
    const pool = splitSentences(against).map((s) => new Set(tokens(s.text)));
    return splitSentences(text)
      .filter((sentence) => {
        const words = new Set(tokens(sentence.text));
        if (words.size < 3) return false;
        return pool.some((candidate) => {
          let shared = 0;
          for (const word of words) if (candidate.has(word)) shared++;
          return shared / words.size >= SAME_WORDS;
        });
      })
      .map(({ from, to }) => ({ from, to }));
  };
  return {
    here: repeats(here, other),
    other: repeats(other, here),
    source: "words",
  };
}

/* ── The fold ──────────────────────────────────────────────────── */

export interface MergePlan {
  /** Sentences of the folded paragraph the keeper does not say: carried. */
  carried: TextSpan[];
  /** Sentences the keeper already says: left out. */
  dropped: TextSpan[];
}

/**
 * Sort the folded paragraph's sentences into those to carry over and those
 * the keeper already says. `keep` names sentences that must travel whatever
 * the evidence says, such as one a margin note is attached to.
 */
export function planMerge(
  folded: string,
  repeated: readonly TextSpan[],
  keep: (sentence: TextSpan) => boolean = () => false,
): MergePlan {
  const plan: MergePlan = { carried: [], dropped: [] };
  const said = snapToSentences(folded, repeated);
  for (const { from, to } of splitSentences(folded)) {
    const sentence = { from, to };
    const repeat = said.some((s) => s.from === from && s.to === to);
    (repeat && !keep(sentence) ? plan.dropped : plan.carried).push(sentence);
  }
  return plan;
}

const count = (n: number, noun: string) =>
  `${n === 1 ? "One" : n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Why a fold is offered, in the writer's terms: which paragraph stays, and
 * what the evidence says would happen to the other one's sentences.
 */
export function mergeWhy(
  advice: MergeAdvice | null,
  names: { here: string; other: string },
  texts: { here: string; other: string },
  evidence: MergeEvidence | null,
): string {
  if (advice === "together")
    return "These make different points about one subject. Side by side, a reader meets it once.";
  if (advice !== "fold-here" && advice !== "fold-there") return "";
  const keepHere = advice === "fold-here";
  const keeper = keepHere ? names.here : names.other;
  const folded = keepHere ? names.other : names.here;
  const lead = `${keeper[0].toUpperCase()}${keeper.slice(1)} makes the point more fully.`;
  if (!evidence) return lead;
  const plan = planMerge(
    keepHere ? texts.other : texts.here,
    keepHere ? evidence.other : evidence.here,
  );
  if (!plan.dropped.length)
    return `${lead} Nothing in ${folded} repeats it word for word, so all of it would be carried over.`;
  const repeats = `${count(plan.dropped.length, "sentence")} in ${folded} ${plan.dropped.length === 1 ? "repeats" : "repeat"} it`;
  return plan.carried.length
    ? `${lead} ${repeats}; the other ${plan.carried.length === 1 ? "one" : plan.carried.length} would be carried over.`
    : `${lead} ${repeats}, and nothing else is there to carry over.`;
}
