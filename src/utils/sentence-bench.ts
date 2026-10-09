import type { GrammarIssue } from "./grammar";
import {
  completeSentence,
  wordingIsPrefix,
  type SentenceWording,
} from "./sentence-ledger";
import { splitSentences, wordCount } from "./struggle-signals";

export type CandidateSource =
  | "yours"
  | "rule"
  | "thesaurus"
  | "on-device"
  | "text-model"
  | "spoken";
export interface SentenceCandidate {
  id: string;
  text: string;
  source: CandidateSource;
  operation: string;
  wordDelta: number;
  caution?: string;
  at?: number;
  grammar: "pending" | "checked" | "unavailable";
  /** Populated only from a successful judgement for this exact text pair. */
  meaning?: { probability: number; model: string };
  /** Fill-mask probability is a word prediction, never meaning confidence. */
  likelihood?: { probability: number; model: string };
}
export interface SentenceContext {
  before: string;
  after: string;
  paragraph: string;
}
export interface SentencePlacementChoice {
  id: string;
  before: string;
  after: string;
  paragraph: string;
  reason: string;
  offset: number;
  source: "rule";
}
export interface WordAlternative {
  word: string;
  replacement: string;
  from: number;
  to: number;
  sentence: string;
  nuance: string;
  source: "thesaurus";
}
export interface WordDiff {
  kind: "same" | "removed" | "added";
  text: string;
}

const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
export function sentenceCandidate(
  original: string,
  text: string,
  source: CandidateSource,
  operation: string,
  caution?: string,
): SentenceCandidate {
  return {
    id: `${source}-${hash(text)}`,
    text,
    source,
    operation,
    wordDelta: wordCount(text) - wordCount(original),
    grammar: "pending",
    ...(caution ? { caution } : {}),
  };
}
const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Complete edits, scoped to explicit constructions. Never a meaning promise. */
export function localSentenceCandidates(
  original: string,
  wordings: SentenceWording[] = [],
): SentenceCandidate[] {
  if (!completeSentence(original)) return [];
  const out: SentenceCandidate[] = wordings
    .filter(
      (w) => completeSentence(w.text) && !wordingIsPrefix(w.text, original),
    )
    .map((w) => ({
      ...sentenceCandidate(
        original,
        w.text,
        "yours",
        "Earlier settled wording",
        "Check this earlier wording against what you mean now.",
      ),
      at: w.at,
    }));
  const rules: Array<[RegExp, string, string]> = [
    [/\bin order to\b/gi, "to", "Shorter purpose phrase"],
    [/\bat this point in time\b/gi, "now", "Shorter time phrase"],
    [/\bdue to the fact that\b/gi, "because", "Shorter cause phrase"],
    [/\bin spite of the fact that\b/gi, "although", "Shorter contrast phrase"],
    [/\bon a daily basis\b/gi, "daily", "Shorter frequency phrase"],
    [/\bat the present time\b/gi, "now", "Shorter time phrase"],
    [/\ba large number of\b/gi, "many", "Shorter quantity phrase"],
    [/\bhas the ability to\b/gi, "can", "Shorter ability phrase"],
    [/\bmade a decision to\b/gi, "decided to", "Use a verb"],
    [/\bmake a decision to\b/gi, "decide to", "Use a verb"],
    [/\bcame to the conclusion that\b/gi, "concluded that", "Use a verb"],
  ];
  for (const [pattern, replacement, operation] of rules) {
    const text = capitalise(original.replace(pattern, replacement));
    if (text !== original)
      out.push(
        sentenceCandidate(
          original,
          text,
          "rule",
          operation,
          "Read in context; meaning has not been checked.",
        ),
      );
  }
  if (/\b(?:really|very)\s+(?=\p{L})/iu.test(original)) {
    const text = original.replace(/\b(?:really|very)\s+(?=\p{L})/giu, "");
    out.push(
      sentenceCandidate(
        original,
        capitalise(text),
        "rule",
        "Reduce emphasis",
        "Removing emphasis can change the strength of the sentence.",
      ),
    );
  }
  const semicolon = original.match(/^([^;]+);\s*([^;]+)$/);
  if (
    semicolon &&
    wordCount(semicolon[1]) >= 3 &&
    wordCount(semicolon[2]) >= 3 &&
    !/^(?:and|but|or|so|yet)\b/i.test(semicolon[2])
  ) {
    out.push(
      sentenceCandidate(
        original,
        `${semicolon[1].trim()}. ${capitalise(semicolon[2].trim())}`,
        "rule",
        "Two sentences",
        "The pause becomes stronger.",
      ),
    );
  }
  const trailing = original.match(
    /^(.+),\s+(before|after|when)\s+([^,.!?;]+)([.!?])$/i,
  );
  if (
    trailing &&
    wordCount(trailing[1]) >= 3 &&
    wordCount(trailing[3]) >= 3 &&
    !/^["“']/.test(trailing[1])
  ) {
    const body = trailing[1].replace(/^[A-Z]/, (c) => c.toLowerCase());
    // Never lower-case names or the first-person pronoun by guessing.
    if (/^(?:The|A|An|We|They|He|She|It)\b/.test(trailing[1])) {
      out.push(
        sentenceCandidate(
          original,
          `${capitalise(trailing[2])} ${trailing[3]}, ${body}${trailing[4]}`,
          "rule",
          "Front the time clause",
          "Changes which part the reader meets first.",
        ),
      );
    }
  }
  const seen = new Set([original]);
  return out
    .filter((c) => {
      if (!completeSentence(c.text) || seen.has(c.text)) return false;
      seen.add(c.text);
      return true;
    })
    .slice(0, 8);
}

export type SentenceLint = (text: string) => Promise<GrammarIssue[]>;
/** Reject new Harper problems; existing problems are not silently blessed. */
export async function checkSentenceCandidates(
  original: string,
  candidates: SentenceCandidate[],
  lint: SentenceLint,
): Promise<SentenceCandidate[]> {
  const baseline = await lint(original);
  const signature = (i: GrammarIssue) =>
    `${i.kind}:${i.problem.toLocaleLowerCase()}:${i.message}`;
  const allowed = new Map<string, number>();
  baseline.forEach((i) =>
    allowed.set(signature(i), (allowed.get(signature(i)) ?? 0) + 1),
  );
  const result: SentenceCandidate[] = [];
  // Harper's worker mutates dictionary state: use one sequential queue.
  for (const candidate of candidates) {
    if (!completeSentence(candidate.text)) continue;
    const issues = await lint(candidate.text);
    const counts = new Map<string, number>();
    issues.forEach((i) =>
      counts.set(signature(i), (counts.get(signature(i)) ?? 0) + 1),
    );
    if ([...counts].every(([key, count]) => count <= (allowed.get(key) ?? 0)))
      result.push({ ...candidate, grammar: "checked" });
  }
  return result;
}

/** Word-level LCS retains punctuation and whitespace for a full reversible diff. */
export function sentenceWordDiff(before: string, after: string): WordDiff[] {
  const tokens = (s: string) =>
    s.match(/\s+|[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu) ?? [];
  const a = tokens(before),
    b = tokens(after);
  // Sentence limit bounds the matrix; do not allocate it for arbitrary documents.
  if (a.length * b.length > 160000)
    return [
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ];
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? 1 + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: WordDiff[] = [];
  const push = (kind: WordDiff["kind"], text: string) => {
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i++]);
      j++;
    } else if (j < b.length && (i === a.length || dp[i][j + 1] > dp[i + 1][j]))
      push("added", b[j++]);
    else push("removed", a[i++]);
  }
  return out;
}

// Authored, bundled dictionary. Nuance describes the replacement, never fit.
const WORDS: Record<string, Array<[string, string]>> = {
  important: [
    ["essential", "stronger: necessary"],
    ["significant", "more formal: consequential"],
  ],
  very: [
    ["especially", "more specific emphasis"],
    ["particularly", "more formal emphasis"],
  ],
  good: [
    ["sound", "reliable or well reasoned"],
    ["effective", "achieves its purpose"],
    ["valuable", "worth keeping"],
  ],
  bad: [
    ["poor", "lower quality"],
    ["harmful", "causes damage"],
  ],
  big: [
    ["large", "plainer size description"],
    ["substantial", "more formal: considerable"],
  ],
  small: [
    ["little", "more conversational"],
    ["modest", "limited in scale"],
  ],
  said: [
    ["remarked", "a passing observation"],
    ["replied", "an answer"],
    ["explained", "makes something clear"],
  ],
  says: [
    ["states", "more formal"],
    ["argues", "makes a case"],
  ],
  shows: [
    ["reveals", "brings something hidden to view"],
    ["demonstrates", "stronger evidence"],
  ],
  show: [
    ["reveal", "bring something hidden to view"],
    ["demonstrate", "stronger evidence"],
  ],
  think: [
    ["believe", "conviction"],
    ["suspect", "less certain"],
    ["consider", "weigh an idea"],
  ],
  thought: [
    ["believed", "conviction"],
    ["suspected", "less certain"],
  ],
  walked: [
    ["strolled", "unhurried"],
    ["strode", "purposeful"],
    ["wandered", "without a fixed route"],
  ],
  looked: [
    ["glanced", "briefly"],
    ["stared", "fixed attention"],
    ["watched", "continued attention"],
  ],
  quiet: [
    ["silent", "no sound"],
    ["still", "no movement"],
    ["hushed", "suppressed sound"],
  ],
  loud: [
    ["noisy", "many sounds"],
    ["deafening", "much stronger"],
  ],
  clear: [
    ["plain", "easy to understand"],
    ["explicit", "fully stated"],
  ],
  difficult: [
    ["hard", "plainer"],
    ["demanding", "requires effort"],
  ],
  use: [
    ["employ", "more formal"],
    ["apply", "put to a purpose"],
  ],
  used: [
    ["employed", "more formal"],
    ["applied", "put to a purpose"],
  ],
  help: [
    ["assist", "more formal"],
    ["support", "sustain or back"],
  ],
  need: [
    ["require", "more formal"],
    ["want", "desire, not necessity"],
  ],
  change: [
    ["alter", "modify"],
    ["transform", "much stronger"],
  ],
  changed: [
    ["altered", "modified"],
    ["transformed", "much stronger"],
  ],
  strange: [
    ["unusual", "less judgemental"],
    ["uncanny", "unsettling familiarity"],
  ],
  beautiful: [
    ["lovely", "more conversational"],
    ["striking", "catches attention"],
  ],
  quickly: [
    ["swiftly", "more literary"],
    ["hurriedly", "with haste"],
  ],
  slowly: [
    ["gradually", "over time"],
    ["unhurriedly", "without haste"],
  ],
  however: [
    ["still", "more conversational contrast"],
    ["nevertheless", "more formal contrast"],
  ],
  perhaps: [["maybe", "more conversational uncertainty"]],
  begin: [["start", "plainer"]],
  began: [["started", "plainer"]],
  end: [
    ["finish", "completion"],
    ["conclude", "more formal"],
  ],
  remember: [["recall", "bring to mind"]],
  problem: [
    ["difficulty", "an obstacle"],
    ["question", "something to resolve"],
  ],
  result: [
    ["outcome", "what followed"],
    ["consequence", "an effect"],
  ],
  possible: [
    ["feasible", "can be done"],
    ["conceivable", "can be imagined"],
  ],
  seems: [["appears", "more formal uncertainty"]],
};
export function sentenceWords(
  sentence: string,
): Array<{ word: string; from: number; to: number; available: boolean }> {
  return [...sentence.matchAll(/\p{L}+(?:['’]\p{L}+)?/gu)].map((m) => ({
    word: m[0],
    from: m.index!,
    to: m.index! + m[0].length,
    available: !!WORDS[m[0].toLocaleLowerCase()],
  }));
}
export function wordAlternatives(
  sentence: string,
  from: number,
  to: number,
): WordAlternative[] {
  const word = sentence.slice(from, to);
  if (!sentenceWords(sentence).some((w) => w.from === from && w.to === to))
    return [];
  return (WORDS[word.toLocaleLowerCase()] ?? []).map(
    ([replacement, nuance]) => {
      const cased =
        word === word.toUpperCase()
          ? replacement.toUpperCase()
          : /^[A-Z]/.test(word)
            ? capitalise(replacement)
            : replacement;
      return {
        word,
        replacement: cased,
        from,
        to,
        sentence: sentence.slice(0, from) + cased + sentence.slice(to),
        nuance,
        source: "thesaurus",
      };
    },
  );
}

export function sentenceContext(
  paragraph: string,
  from: number,
  to: number,
): SentenceContext {
  return {
    before: paragraph.slice(0, from),
    after: paragraph.slice(to),
    paragraph,
  };
}
/** Explicit neighbouring slots. No unmeasured semantic ranking. */
export function sentencePlacementChoices(
  paragraph: string,
  sentenceFrom: number,
  sentenceTo: number,
): SentencePlacementChoice[] {
  const spans = splitSentences(paragraph);
  const selected = spans.findIndex(
    (s) => s.from === sentenceFrom && s.to === sentenceTo,
  );
  if (
    selected < 0 ||
    spans.length < 2 ||
    !completeSentence(spans[selected].text)
  )
    return [];
  const current = spans[selected];
  const rest = spans.filter((_, i) => i !== selected);
  const reference = /^(?:This|These|Those|It|Such)\b/.test(current.text);
  const out: SentencePlacementChoice[] = [];
  for (let slot = 0; slot <= rest.length; slot++) {
    if (slot === selected || (reference && slot === 0)) continue;
    const before = rest
      .slice(0, slot)
      .map((s) => s.text)
      .join(" ");
    const after = rest
      .slice(slot)
      .map((s) => s.text)
      .join(" ");
    out.push({
      id: `slot-${slot}-${hash(paragraph)}`,
      offset: slot === rest.length ? paragraph.length : rest[slot].from,
      before,
      after,
      paragraph: [before, current.text, after].filter(Boolean).join(" "),
      reason: reference
        ? "Keeps a preceding sentence for this reference; check its antecedent."
        : slot === 0
          ? "Try it as the opening sentence."
          : slot === rest.length
            ? "Try it as the closing sentence."
            : "Try it between these sentences.",
      source: "rule",
    });
  }
  return out.slice(0, 12);
}
