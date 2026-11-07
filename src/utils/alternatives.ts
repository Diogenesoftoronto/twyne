/**
 * Alternatives — the writer locks a span and browses replacements that drop
 * into the same slot.
 *
 * What is offered depends on how much is locked:
 *
 *   word      a thesaurus (synonyms, antonyms), the words that commonly fill
 *             this slot between its neighbours, and a model's in-context picks
 *   phrase    rewordings of about the same length
 *   sentence  rephrasings, plainer, sharper, more formal, turned around
 *   passage   the same lenses, for up to one paragraph
 *
 * Every candidate is held to roughly the original's word count, so a pick can
 * replace the span without reflowing the paragraph around it.
 *
 * Nothing here touches the editor or the network; `alternatives-palette.tsx`
 * fetches and the `Alternatives` extension locks, previews and applies.
 */
import { prompt as renderNamed } from "./prompts";
import { splitSentences, wordCount } from "./struggle-signals";

export type AlternativeScale = "word" | "phrase" | "sentence" | "passage";

export type AlternativeLens =
  | "synonym"
  | "antonym"
  | "slot"
  | "rephrase"
  | "plainer"
  | "sharper"
  | "formal"
  | "looser"
  | "opposite"
  /** Written toward a direction the writer typed ("lonelier"). */
  | "steered";

export type AlternativeSource = "lexicon" | "model";

export interface AlternativeOption {
  /** Normalised text; one option per wording. */
  id: string;
  text: string;
  lens: AlternativeLens;
  source: AlternativeSource;
  words: number;
  /** The writer's direction, for a steered option. */
  direction?: string;
}

export interface AlternativeSpanText {
  text: string;
  /** Paragraph text before and after the span, trimmed to a window. */
  before: string;
  after: string;
}

export type AlternativeSpanCheck =
  | { ok: true; scale: AlternativeScale; words: number }
  | { ok: false; message: string };

/** The most a lock may hold: one paragraph of ordinary length. */
export const MAX_ALTERNATIVE_WORDS = 160;
export const MAX_ALTERNATIVE_CHARS = 1200;
/** Context each side of the span, sent with a model request. */
export const CONTEXT_CHARS = 360;
/** Model rounds per lock, including the first: spend guard for "more". */
export const MAX_MODEL_ROUNDS = 5;
/** Steered rounds per lock, counted apart from "more". */
export const MAX_STEERS = 6;
export const MAX_DIRECTION_CHARS = 120;

export const LENS_LABELS: Record<AlternativeLens, string> = {
  synonym: "Synonyms",
  antonym: "Antonyms",
  slot: "Fill the slot",
  rephrase: "Rephrase",
  plainer: "Plainer",
  sharper: "Sharper",
  formal: "More formal",
  looser: "Looser",
  opposite: "Turned around",
  steered: "Your direction",
};

export const LENSES_FOR: Record<AlternativeScale, AlternativeLens[]> = {
  word: ["synonym", "antonym", "slot"],
  phrase: ["rephrase", "plainer", "sharper", "formal", "looser", "opposite"],
  sentence: ["rephrase", "plainer", "sharper", "formal", "looser", "opposite"],
  passage: ["rephrase", "plainer", "sharper", "formal", "looser", "opposite"],
};

const SCALE_LABEL: Record<AlternativeScale, string> = {
  word: "word",
  phrase: "phrase",
  sentence: "sentence",
  passage: "passage",
};

const LENS_BRIEF: Record<AlternativeLens, string> = {
  synonym:
    "a word or two-word phrase with the same meaning that fits this exact slot, inflected to match (tense, number, person)",
  antonym:
    "a word with the opposite meaning that fits this exact slot, inflected to match",
  slot: "a word a reader could expect in this slot from the words around it, even if it changes the meaning",
  rephrase: "the same meaning in different words",
  plainer: "simpler, more ordinary words; the same meaning",
  sharper: "more concrete, specific or vivid; the same meaning",
  formal: "a more formal register; the same meaning",
  looser: "a looser, more conversational register; the same meaning",
  opposite:
    "the same move turned around: the contrary or negated claim, in the same shape",
  steered: "moves the way the writer's direction asks",
};

const LETTER = /[\p{L}\p{N}]/u;
const EDGE_PUNCT_START = /^[^\p{L}\p{N}]+/u;
const EDGE_PUNCT_END = /[^\p{L}\p{N}]+$/u;
/** Inline nodes (notes, formulas) read as this in `textBetween`. */
export const LEAF_PLACEHOLDER = "￼";

export function countWords(text: string): number {
  return wordCount(text.trim());
}

/** Size up the locked text: what kind of alternatives it gets, or why none. */
export function checkAlternativeSpan(text: string): AlternativeSpanCheck {
  const trimmed = text.trim();
  if (!trimmed || !LETTER.test(trimmed))
    return { ok: false, message: "Select a word or a passage to rewrite." };
  if (trimmed.includes(LEAF_PLACEHOLDER))
    return {
      ok: false,
      message:
        "The selection holds a note or a formula. Select the words around it.",
    };
  const words = countWords(trimmed);
  if (words > MAX_ALTERNATIVE_WORDS || trimmed.length > MAX_ALTERNATIVE_CHARS)
    return {
      ok: false,
      message: `Select up to a paragraph (about ${MAX_ALTERNATIVE_WORDS} words) to see alternatives.`,
    };
  if (words === 1) return { ok: true, scale: "word", words };
  const sentences = splitSentences(trimmed).length;
  if (sentences > 1) return { ok: true, scale: "passage", words };
  const ends = /[.!?…]["'”’)\]]*$/u.test(trimmed);
  if (!ends && words <= 8) return { ok: true, scale: "phrase", words };
  return { ok: true, scale: "sentence", words };
}

/**
 * Offsets of the lockable core inside a selected string: surrounding spaces
 * are never locked, and a single word sheds the punctuation around it, so
 * "happy," locks "happy" and the comma stays put.
 */
export function alternativeCore(text: string): { start: number; end: number } {
  let start = text.length - text.trimStart().length;
  let end = text.trimEnd().length;
  if (end <= start) return { start, end: start };
  const inner = text.slice(start, end);
  if (!/\s/.test(inner)) {
    const lead = inner.match(EDGE_PUNCT_START)?.[0].length ?? 0;
    const trail = inner.match(EDGE_PUNCT_END)?.[0].length ?? 0;
    if (lead + trail < inner.length) {
      start += lead;
      end -= trail;
    }
  }
  return { start, end };
}

/** The word around a caret offset, for opening on a bare caret. */
export function wordAt(
  text: string,
  offset: number,
): { start: number; end: number } | null {
  const isWord = (ch: string | undefined) =>
    !!ch && (LETTER.test(ch) || ch === "'" || ch === "’" || ch === "-");
  let start = offset;
  let end = offset;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  // Apostrophes and hyphens join words; they never make one on their own.
  while (start < end && !LETTER.test(text[start]!)) start++;
  while (end > start && !LETTER.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

/** Paragraph context either side of a span, cut at word boundaries. */
export function spanContext(
  paragraph: string,
  start: number,
  end: number,
): { before: string; after: string } {
  let before = paragraph.slice(Math.max(0, start - CONTEXT_CHARS), start);
  if (start > CONTEXT_CHARS) before = before.replace(/^\S*\s/, "");
  let after = paragraph.slice(end, end + CONTEXT_CHARS);
  if (end + CONTEXT_CHARS < paragraph.length)
    after = after.replace(/\s\S*$/, "");
  return {
    before: before.replaceAll(LEAF_PLACEHOLDER, " "),
    after: after.replaceAll(LEAF_PLACEHOLDER, " "),
  };
}

/** How many words a replacement may run: about as many as the original. */
export function lengthBudget(
  scale: AlternativeScale,
  words: number,
): { min: number; max: number } {
  if (scale === "word") return { min: 1, max: 2 };
  const slack = Math.max(scale === "phrase" ? 1 : 2, Math.round(words * 0.2));
  return { min: Math.max(1, words - slack), max: words + slack };
}

/**
 * The window a candidate must land in to be shown at all. Wider than the
 * budget the model is asked for, because models miscount, but a rewrite that
 * doubles or halves the span is no longer a replacement for it.
 */
function acceptedLength(scale: AlternativeScale, words: number) {
  const budget = lengthBudget(scale, words);
  if (scale === "word") return budget;
  const give = Math.max(1, Math.round(words * 0.15));
  return { min: Math.max(1, budget.min - give), max: budget.max + give };
}

const normalise = (text: string) =>
  text
    .toLocaleLowerCase()
    .replace(/[“”"‘’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function optionId(text: string): string {
  return normalise(text);
}

/** Match the capitalisation of the word or passage being replaced. */
export function matchCase(candidate: string, original: string): string {
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (!candidate) return candidate;
  if (
    letters.length > 1 &&
    letters === letters.toLocaleUpperCase() &&
    letters !== letters.toLocaleLowerCase()
  )
    return candidate.toLocaleUpperCase();
  const first = original.match(/\p{L}/u)?.[0];
  if (
    first &&
    first === first.toLocaleUpperCase() &&
    first !== first.toLocaleLowerCase()
  ) {
    const i = candidate.search(/\p{L}/u);
    if (i >= 0)
      return (
        candidate.slice(0, i) +
        candidate[i]!.toLocaleUpperCase() +
        candidate.slice(i + 1)
      );
  }
  return candidate;
}

/**
 * Hold a candidate to the span's shape: trimmed, unquoted, within the length
 * window and not the original again. Returns null for anything that fails.
 */
export function acceptAlternative(
  raw: string,
  original: string,
  scale: AlternativeScale,
  lens: AlternativeLens,
  source: AlternativeSource,
): AlternativeOption | null {
  let text = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
  if (!text || !LETTER.test(text) || text.length > MAX_ALTERNATIVE_CHARS * 1.5)
    return null;
  if (scale === "word") text = matchCase(text, original);
  // Keep the original's closing punctuation when the candidate dropped it.
  if (scale !== "word") {
    const close = original.match(/[.!?…:;,]["'”’)\]]*$/u)?.[0];
    if (close && !/[.!?…:;,]["'”’)\]]*$/u.test(text)) text += close;
  }
  const id = optionId(text);
  if (!id || id === optionId(original)) return null;
  const words = countWords(text);
  const window = acceptedLength(scale, countWords(original));
  if (words < window.min || words > window.max) return null;
  return { id, text, lens, source, words };
}

/**
 * Add options in order, one per wording; the first source to offer it keeps
 * its place. A dictionary word the model also chose for this sentence is
 * marked as the model's, which is what puts it under "fits here".
 */
export function mergeOptions(
  into: AlternativeOption[],
  incoming: AlternativeOption[],
): AlternativeOption[] {
  const at = new Map(into.map((o, i) => [o.id, i]));
  const out = [...into];
  for (const option of incoming) {
    const i = at.get(option.id);
    if (i === undefined) {
      at.set(option.id, out.length);
      out.push(option);
    } else if (
      option.source === "model" &&
      out[i]!.source === "lexicon" &&
      out[i]!.lens === option.lens
    )
      out[i] = { ...out[i]!, source: "model" };
  }
  return out;
}

// ── Lexicon (Datamuse) ──────────────────────────────────────────────────

export const DATAMUSE_ORIGIN = "https://api.datamuse.com";

interface DatamuseWord {
  word?: unknown;
  score?: unknown;
  tags?: unknown;
}

export interface LexiconQuery {
  lens: AlternativeLens;
  url: string;
  /** How many of this query's words to show. */
  keep: number;
  /** Keep only words tagged as the original's part of speech. */
  matchPart?: boolean;
}

const lastWord = (text: string) =>
  text.match(/([\p{L}\p{N}'’-]+)[^\p{L}\p{N}]*$/u)?.[1] ?? "";
const firstWord = (text: string) =>
  text.match(/^[^\p{L}\p{N}]*([\p{L}\p{N}'’-]+)/u)?.[1] ?? "";

/**
 * Datamuse lookups for a single locked word: means-like weighted by the
 * neighbouring words, plain synonyms, antonyms, and the words that commonly
 * sit between the neighbours (next-word prediction for this slot). Only the
 * word and its two neighbours leave the device.
 */
export function lexiconQueries(
  span: AlternativeSpanText,
  client = "",
): LexiconQuery[] {
  const word = span.text.trim().toLocaleLowerCase();
  const lc = lastWord(span.before).toLocaleLowerCase();
  const rc = firstWord(span.after).toLocaleLowerCase();
  const near = [
    lc ? `lc=${encodeURIComponent(lc)}` : "",
    rc ? `rc=${encodeURIComponent(rc)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  // Datamuse's CDN caches for a day without varying on Origin, so a response
  // cached for another site can arrive with that site's CORS header. Naming
  // the client keys the cache per origin; Datamuse ignores the parameter.
  const tag = client ? `&client=${encodeURIComponent(client)}` : "";
  const q = (params: string) => `${DATAMUSE_ORIGIN}/words?${params}${tag}`;
  const queries: LexiconQuery[] = [
    {
      lens: "synonym",
      url: q(
        `ml=${encodeURIComponent(word)}${near ? `&${near}` : ""}&md=p&max=30`,
      ),
      matchPart: true,
      keep: 14,
    },
    {
      lens: "synonym",
      url: q(`rel_syn=${encodeURIComponent(word)}&md=p&max=20`),
      keep: 6,
    },
    {
      lens: "antonym",
      url: q(`rel_ant=${encodeURIComponent(word)}&md=p&max=12`),
      keep: 8,
    },
  ];
  if (near)
    queries.push({
      lens: "slot",
      url: q(`${near}&md=p&max=30`),
      matchPart: true,
      keep: 10,
    });
  return queries;
}

/** The original word's parts of speech, for keeping slot fillers in kind. */
export function partOfSpeechQuery(word: string, client = ""): string {
  const tag = client ? `&client=${encodeURIComponent(client)}` : "";
  return `${DATAMUSE_ORIGIN}/words?sp=${encodeURIComponent(word.trim().toLocaleLowerCase())}&md=p&max=1${tag}`;
}

const PARTS = new Set(["n", "v", "adj", "adv"]);

export function parsePartsOfSpeech(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  const tags = (body[0] as DatamuseWord | undefined)?.tags;
  return Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string" && PARTS.has(t))
    : [];
}

export function parseLexicon(
  body: unknown,
  query: LexiconQuery,
  original: string,
  parts: string[],
): AlternativeOption[] {
  if (!Array.isArray(body)) return [];
  const out: AlternativeOption[] = [];
  for (const entry of body as DatamuseWord[]) {
    if (typeof entry?.word !== "string") continue;
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === "string")
      : [];
    // "ml" mixes synonyms with loosely related words; only synonyms stay.
    if (query.url.includes("ml=") && !tags.includes("syn")) continue;
    if (
      query.matchPart &&
      parts.length &&
      tags.some((t) => PARTS.has(t)) &&
      !tags.some((t) => parts.includes(t))
    )
      continue;
    if (tags.includes("prop")) continue;
    const option = acceptAlternative(
      entry.word,
      original,
      "word",
      query.lens,
      "lexicon",
    );
    if (option) out.push(option);
  }
  return out;
}

// ── Model ───────────────────────────────────────────────────────────────

export interface AlternativesRequest extends AlternativeSpanText {
  scale: AlternativeScale;
  /** Lenses to cover; the first round covers them all. */
  lenses: AlternativeLens[];
  count: number;
  /** Wordings already on screen, so a later round brings new ones. */
  exclude: string[];
  /** A direction in the writer's words; asks for "steered" options only. */
  direction?: string;
}

export interface AlternativesPrompt {
  system: string;
  prompt: string;
}

/** Lenses a model may write into, per scale. Slot fillers stay lexical-only
 * when a lexicon answered, but the model fills them when it did not. */
export const MODEL_LENSES_FOR: Record<AlternativeScale, AlternativeLens[]> = {
  word: ["synonym", "antonym", "slot"],
  phrase: LENSES_FOR.phrase,
  sentence: LENSES_FOR.sentence,
  passage: LENSES_FOR.passage,
};

const MAX_EXCLUDE = 40;

export function alternativesPrompt(
  req: AlternativesRequest,
): AlternativesPrompt {
  const words = countWords(req.text);
  const budget = lengthBudget(req.scale, words);
  const lengthRule =
    req.scale === "word"
      ? "one word, or two when English needs two (a phrasal verb, a compound)"
      : budget.min === budget.max
        ? `exactly ${budget.min} words`
        : `between ${budget.min} and ${budget.max} words (the original has ${words})`;
  // Each lens once, and only lenses this scale (or a steer) can ask for.
  const allowed = new Set<AlternativeLens>([
    ...MODEL_LENSES_FOR[req.scale],
    "steered",
  ]);
  const asked = [...new Set(req.lenses)].filter((lens) => allowed.has(lens));
  const lenses = asked.length ? asked : MODEL_LENSES_FOR[req.scale];
  const lensLines = lenses
    .map((lens) => `- "${lens}": ${LENS_BRIEF[lens]}`)
    .join("\n");
  const exclude = req.exclude
    .slice(0, MAX_EXCLUDE)
    .map((text) => `- ${text}`)
    .join("\n");
  return {
    system: renderNamed("alternatives-system"),
    prompt: renderNamed("alternatives-user", {
      scale: SCALE_LABEL[req.scale],
      words,
      text: req.text,
      before: req.before.trim() || "(start of paragraph)",
      after: req.after.trim() || "(end of paragraph)",
      count: req.count,
      lengthRule,
      lenses: lensLines,
      direction: req.direction?.trim()
        ? `The writer's direction for every replacement: "${req.direction.trim().slice(0, MAX_DIRECTION_CHARS)}". Move the span that way while it keeps its job in the sentence.`
        : "",
      exclude: exclude
        ? `Do not repeat any of these, which the writer has already seen:\n${exclude}`
        : "",
    }),
  };
}

/**
 * Read a model's JSONL alternatives. Tolerates a code fence, a JSON array
 * instead of lines, and an unfinished last line while streaming (it is simply
 * not read yet). Lenses outside the request are dropped.
 */
export function parseAlternatives(
  text: string,
  req: Pick<AlternativesRequest, "text" | "scale" | "lenses">,
  options: { partial?: boolean } = {},
): AlternativeOption[] {
  const allowed = new Set<string>(
    req.lenses.length ? req.lenses : MODEL_LENSES_FOR[req.scale],
  );
  const cleaned = text
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/```[a-z]*\n?/gi, "");
  const records: unknown[] = [];
  const trimmed = cleaned.trim();
  if (trimmed.startsWith("[") && !options.partial) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) records.push(...parsed);
    } catch {
      /* fall through to lines */
    }
  }
  if (!records.length) {
    const lines = cleaned.split("\n");
    if (options.partial) lines.pop();
    for (const line of lines) {
      const candidate = line
        .trim()
        .replace(/^[[,]+|[\],]+$/g, "")
        .trim();
      if (!candidate.startsWith("{")) continue;
      try {
        records.push(JSON.parse(candidate));
      } catch {
        /* skip a malformed line */
      }
    }
  }
  const out: AlternativeOption[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const { lens, text: value } = record as { lens?: unknown; text?: unknown };
    if (typeof lens !== "string" || typeof value !== "string") continue;
    if (!allowed.has(lens)) continue;
    const option = acceptAlternative(
      value,
      req.text,
      req.scale,
      lens as AlternativeLens,
      "model",
    );
    if (option) out.push(option);
  }
  return mergeOptions([], out);
}

// ── Drum (single words) ─────────────────────────────────────────────────

export type DrumGroup = "fits" | "synonym" | "slot" | "antonym";

const DRUM_ORDER: DrumGroup[] = ["fits", "synonym", "slot", "antonym"];

export const DRUM_GROUP_LABELS: Record<DrumGroup, string> = {
  fits: "fits here",
  synonym: "synonym",
  slot: "fills the slot",
  antonym: "antonym",
};

/** A model's synonym was chosen for this sentence; a lexicon's was not. */
export function drumGroup(option: AlternativeOption): DrumGroup {
  if (option.lens === "antonym") return "antonym";
  if (option.lens === "slot") return "slot";
  return option.source === "model" ? "fits" : "synonym";
}

/**
 * The order a word's options turn through: words picked for this sentence,
 * then dictionary synonyms, then words that fill the slot, then antonyms,
 * which flip the meaning and so come last. Stable within each group.
 */
export function drumOrder(options: AlternativeOption[]): AlternativeOption[] {
  return options
    .map((option, i) => ({ option, i }))
    .sort(
      (a, b) =>
        DRUM_ORDER.indexOf(drumGroup(a.option)) -
          DRUM_ORDER.indexOf(drumGroup(b.option)) || a.i - b.i,
    )
    .map(({ option }) => option);
}

/** How many to ask for: enough to scroll, few enough to arrive quickly. */
export function roundSize(scale: AlternativeScale, round: number): number {
  if (round === 0) return scale === "word" ? 10 : 12;
  return 8;
}

/** Signed word-count difference, for the badge beside each option. */
export function wordDelta(option: AlternativeOption, original: string): number {
  return option.words - countWords(original);
}
