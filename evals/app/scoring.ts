/**
 * Deterministic checks shared by the app eval suites. None of these call a
 * model, so a regression in them is a regression in the app, not judge noise.
 */
import {
  clampForContext,
  DRAFT_CONTEXT_CHARS,
} from "../../convex/agentPrompts";

export interface Score {
  /** 0..1, or null when the check does not apply to this case. */
  score: number | null;
  label?: string;
  explanation?: string;
  /**
   * The per-item readings behind `score` (one per planted weakness, drift or
   * dossier field), keyed so two evaluators of the same items can be joined.
   * Kept in the local report for agreement statistics; not uploaded.
   */
  items?: Record<string, number>;
  /**
   * The score describes the case's whole cluster and is copied onto each of
   * its cases (a strong/weak pair's ordering). Summaries count it once per
   * cluster.
   */
  sharedByCluster?: boolean;
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Whitespace and typography folded, so a verbatim match survives both. */
export function fold(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function contains(haystack: string, needle: string): boolean {
  const n = fold(needle);
  return n.length > 0 && fold(haystack).includes(n);
}

const STOPWORDS = new Set(
  "a an the this that these those of in on at to for and or but is are was were be been it its as by with from no not there their".split(
    " ",
  ),
);

function contentWords(text: string): string[] {
  return fold(text)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word && !STOPWORDS.has(word))
    .map((word) =>
      word.length <= 3
        ? word
        : word.endsWith("ies")
          ? `${word.slice(0, -3)}y`
          : word.endsWith("s") && !word.endsWith("ss")
            ? word.slice(0, -1)
            : word,
    );
}

/**
 * Does `text` keep `fact`? Every content word of the fact must survive, so
 * "the rail" is kept by "the cold rail" and "store of value" by "stores of
 * value", while a dropped name or number is not.
 */
export function keepsFact(text: string, fact: string): boolean {
  const kept = new Set(contentWords(text));
  const needed = contentWords(fact);
  return needed.length > 0 && needed.every((word) => kept.has(word));
}

/** Character span of `passage` in the folded draft, or null. */
export function span(
  draft: string,
  passage: string,
): { start: number; end: number } | null {
  const d = fold(draft);
  const p = fold(passage);
  if (!p) return null;
  const start = d.indexOf(p);
  return start < 0 ? null : { start, end: start + p.length };
}

/** Do two passages of the same draft overlap by at least `min` of the shorter? */
export function spansOverlap(
  draft: string,
  a: string,
  b: string,
  min = 0.3,
): boolean {
  const sa = span(draft, a);
  const sb = span(draft, b);
  if (!sa || !sb) return false;
  const shared = Math.min(sa.end, sb.end) - Math.max(sa.start, sb.start);
  if (shared <= 0) return false;
  return shared / Math.min(sa.end - sa.start, sb.end - sb.start) >= min;
}

function ngrams(text: string, n: number): Set<string> {
  const tokens = fold(text)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++)
    out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

/** Does `text` reproduce any run of `n` consecutive words from `passage`? */
export function sharesRun(text: string, passage: string, n = 5): boolean {
  const runs = ngrams(passage, n);
  for (const gram of ngrams(text, n)) if (runs.has(gram)) return true;
  return false;
}

export function jaccard(a: string, b: string, n = 1): number {
  const x = ngrams(a, n);
  const y = ngrams(b, n);
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const gram of x) if (y.has(gram)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/** 1 minus the mean pairwise trigram overlap: how differently the notes read. */
export function distinctness(texts: string[]): number | null {
  if (texts.length < 2) return null;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      total += jaccard(texts[i], texts[j], 3);
      pairs += 1;
    }
  return 1 - total / pairs;
}

/**
 * Would `passage` reach the editors? Runs the app's own `clampForContext`
 * with its `DRAFT_CONTEXT_CHARS` budget, so the eval and the prompt cannot
 * disagree about what was shown.
 */
export function visibleToEditors(draft: string, passage: string): boolean {
  return contains(clampForContext(draft, DRAFT_CONTEXT_CHARS), passage);
}

export function ratio(hit: number, total: number): number | null {
  return total > 0 ? hit / total : null;
}

export function mean(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length
    ? present.reduce((sum, v) => sum + v, 0) / present.length
    : null;
}

export function pass(ok: boolean, explanation?: string): Score {
  return { score: ok ? 1 : 0, label: ok ? "pass" : "fail", explanation };
}
