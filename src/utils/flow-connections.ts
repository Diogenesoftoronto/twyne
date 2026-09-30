/**
 * Finding what else in the writer's work a passage touches — locally, before
 * any model is asked.
 *
 * A small TF-IDF over paragraphs: good at "these two passages share unusual
 * words", useless at meaning. That is the point. It narrows thousands of
 * paragraphs to a handful of candidates cheaply and privately, and Jev then
 * reads the handful and says which actually bear on each other.
 */

const STOP = new Set(
  "a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also one two may might must shall us like even much many well still yet ever never always often really quite rather".split(
    " ",
  ),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

/** Crude suffix folding, enough that "libraries" meets "library". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

export interface Passage {
  id: string;
  text: string;
  /** Where it lives — a folio id, or the current manuscript. */
  source: string;
  sourceName?: string;
}

interface Indexed extends Passage {
  weights: Map<string, number>;
  norm: number;
}

export interface PassageIndex {
  passages: Indexed[];
  idf: Map<string, number>;
}

export function buildIndex(passages: readonly Passage[]): PassageIndex {
  const df = new Map<string, number>();
  const counted = passages.map((p) => {
    const counts = new Map<string, number>();
    for (const t of tokens(p.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { passage: p, counts };
  });
  const n = passages.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + n / d));
  return {
    idf,
    passages: counted.map(({ passage, counts }) => {
      const weights = new Map<string, number>();
      let sum = 0;
      for (const [t, c] of counts) {
        const w = (1 + Math.log(c)) * (idf.get(t) ?? 0);
        weights.set(t, w);
        sum += w * w;
      }
      return { ...passage, weights, norm: Math.sqrt(sum) };
    }),
  };
}

export interface Match {
  passage: Passage;
  score: number;
  /** The rare words the two share, strongest first — shown on the card. */
  shared: string[];
}

export function similar(
  text: string,
  index: PassageIndex,
  options: { k?: number; min?: number; exclude?: (p: Passage) => boolean } = {},
): Match[] {
  const { k = 3, min = 0.12, exclude } = options;
  const query = new Map<string, number>();
  for (const t of tokens(text)) query.set(t, (query.get(t) ?? 0) + 1);
  let qNorm = 0;
  const qWeights = new Map<string, number>();
  for (const [t, c] of query) {
    const w = (1 + Math.log(c)) * (index.idf.get(t) ?? Math.log(2));
    qWeights.set(t, w);
    qNorm += w * w;
  }
  qNorm = Math.sqrt(qNorm);
  if (!qNorm) return [];

  const matches: Match[] = [];
  for (const p of index.passages) {
    if (!p.norm || exclude?.(p)) continue;
    let dot = 0;
    const shared: Array<[string, number]> = [];
    for (const [t, w] of qWeights) {
      const pw = p.weights.get(t);
      if (pw) {
        dot += w * pw;
        shared.push([t, w * pw]);
      }
    }
    // One shared word is a coincidence, not a connection.
    if (shared.length < 2) continue;
    const score = dot / (qNorm * p.norm);
    if (score >= min)
      matches.push({
        passage: { id: p.id, text: p.text, source: p.source, sourceName: p.sourceName },
        score,
        shared: shared.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t),
      });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Split plain text into paragraphs worth indexing. */
export function paragraphs(text: string, minChars = 80): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= minChars);
}

/**
 * Titles a paragraph names: curly- or straight-quoted runs of capitalised
 * words, plus any italic spans the editor hands in. Jev decides later which
 * are real works worth a card.
 */
export function workCandidates(text: string, italics: readonly string[] = []): string[] {
  const found = new Set<string>();
  const quoted = /[“"]([^”"]{2,80})[”"]/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(text))) {
    const title = m[1].trim().replace(/[,.;:!?]+$/, "");
    const words = title.split(/\s+/);
    const capitals = words.filter((w) => /^[\p{Lu}\d]/u.test(w)).length;
    if (words.length <= 9 && capitals >= Math.ceil(words.length / 2)) found.add(title);
  }
  for (const span of italics) {
    const title = span.trim().replace(/[,.;:!?]+$/, "");
    const words = title.split(/\s+/);
    if (words.length >= 1 && words.length <= 9 && /^[\p{Lu}\d]/u.test(title))
      found.add(title);
  }
  return [...found].slice(0, 4);
}
