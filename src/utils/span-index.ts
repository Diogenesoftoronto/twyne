import {
  completeSentence,
  sentenceSimilarity,
  type SentenceEntry,
} from "./sentence-ledger";
import { splitSentences } from "./struggle-signals";
import { cosineSimilarity } from "./local-writing-manifest";

export interface IndexedBlock {
  text: string;
  from: number;
  sectionId?: string;
  positionAt?: (offset: number) => number;
}
export interface IndexedSpan {
  id: string;
  text: string;
  from: number;
  to: number;
  blockFrom: number;
  sectionId: string;
  ordinal: number;
}
export interface SpanIndex {
  fingerprint: string;
  spans: IndexedSpan[];
  limited: boolean;
}
export function spanFingerprint(
  spans: Array<Pick<IndexedSpan, "id" | "text" | "from" | "to">>,
): string {
  let hash = 2166136261;
  for (const span of spans)
    for (const c of `${span.id}:${span.from}:${span.to}:${span.text}\n`)
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
/** Nodes always come from manuscript spans. IDs may reuse the sentence ledger. */
export function buildSpanIndex(
  blocks: IndexedBlock[],
  ledger: SentenceEntry[] = [],
  limit = 2000,
): SpanIndex {
  const spans: IndexedSpan[] = [];
  let count = 0;
  for (const block of blocks) {
    for (const sentence of splitSentences(block.text)) {
      if (!completeSentence(sentence.text)) continue;
      count++;
      if (spans.length >= limit) continue;
      const from =
        block.positionAt?.(sentence.from) ?? block.from + 1 + sentence.from;
      const to =
        block.positionAt?.(sentence.to) ?? block.from + 1 + sentence.to;
      const entry = ledger.find(
        (e) =>
          !e.retired &&
          e.from === from &&
          e.to === to &&
          e.text === sentence.text,
      );
      spans.push({
        id: entry?.id ?? `S${String(count).padStart(4, "0")}-${from}`,
        text: sentence.text,
        from,
        to,
        blockFrom: block.from,
        sectionId: block.sectionId ?? "section-1",
        ordinal: count,
      });
    }
  }
  return {
    spans,
    fingerprint: spanFingerprint(spans),
    limited: count > spans.length,
  };
}
export function spanById(index: SpanIndex, id: string): IndexedSpan | null {
  return index.spans.find((span) => span.id === id) ?? null;
}
export type ThreadHypothesis =
  | "exact-wording"
  | "word-overlap"
  | "reference"
  | "embedding-neighbours";
export interface ThreadPair {
  id: string;
  firstId: string;
  secondId: string;
  hypothesis: ThreadHypothesis;
  observation: string;
  overlap: number;
  embedding?: { cosine: number; model: string };
}
/** Compare only code-owned, complete spans. Similarity proposes a pair; it
 * cannot establish a relation or license changing the manuscript. */
export function embeddingThreadPairs(
  index: SpanIndex,
  focusId: string,
  spanIds: string[],
  vectors: number[][],
  model: string,
  limit = 8,
): ThreadPair[] {
  if (
    spanIds.length > 32 ||
    spanIds.length !== vectors.length ||
    new Set(spanIds).size !== spanIds.length
  )
    return [];
  const spans = spanIds.map((id) => spanById(index, id));
  const focusAt = spanIds.indexOf(focusId);
  if (
    focusAt < 0 ||
    spans.some((span) => !span || span.text.length > 2000) ||
    !model
  )
    return [];
  try {
    // Validate every vector before publishing any comparisons.
    for (const vector of vectors) cosineSimilarity(vectors[focusAt], vector);
    return spans
      .flatMap((span, at) => {
        if (at === focusAt) return [];
        const cosine = cosineSimilarity(vectors[focusAt], vectors[at]);
        if (cosine < 0.45) return [];
        const focus = spans[focusAt]!;
        const [first, second] =
          focus.ordinal < span!.ordinal ? [focus, span!] : [span!, focus];
        return [
          {
            id: `${first.id}~${second.id}`,
            firstId: first.id,
            secondId: second.id,
            hypothesis: "embedding-neighbours" as const,
            observation: `Sentence embedding cosine ${cosine.toFixed(3)}; relation unverified.`,
            overlap: 0,
            embedding: { cosine, model },
          },
        ];
      })
      .sort((a, b) => b.embedding.cosine - a.embedding.cosine)
      .slice(0, Math.min(12, Math.max(0, limit)));
  } catch {
    return [];
  }
}
const normalise = (text: string) => text.replace(/\s+/g, " ").trim();
const content = (text: string) =>
  (text.toLocaleLowerCase().match(/\p{L}+/gu) ?? []).filter(
    (w) =>
      !/^(?:a|an|the|and|or|but|of|to|in|on|for|with|is|are|was|were|it|this|that|we|i|he|she|they|as|by|be|had|has|have)$/.test(
        w,
      ),
  );
/** Candidate search is local lexical evidence, not semantic classification. */
export function proposeThreadPairs(
  index: SpanIndex,
  focusId?: string,
  limit = 12,
): ThreadPair[] {
  const out: ThreadPair[] = [],
    seen = new Set<string>();
  const add = (
    first: IndexedSpan,
    second: IndexedSpan,
    hypothesis: ThreadHypothesis,
    observation: string,
    overlap: number,
  ) => {
    const id = `${first.id}~${second.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      firstId: first.id,
      secondId: second.id,
      hypothesis,
      observation,
      overlap,
    });
  };
  const focus = focusId ? spanById(index, focusId) : null;
  for (let i = 0; i < index.spans.length; i++) {
    const first = index.spans[i];
    if (
      /^(?:This|These|Those|It|Such)\b/.test(first.text) &&
      i > 0 &&
      (!focus || first.id === focus.id || index.spans[i - 1].id === focus.id)
    ) {
      add(
        index.spans[i - 1],
        first,
        "reference",
        "Starts with a backward reference; check the preceding sentence as its antecedent.",
        0,
      );
    }
    // A focused request scans the piece against one sentence; an unscoped
    // request stays inside a bounded section window, never all-pairs 2000².
    const comparisons = focus
      ? first.id === focus.id
        ? []
        : [focus]
      : index.spans
          .slice(i + 1, i + 65)
          .filter((s) => s.sectionId === first.sectionId);
    for (const second of comparisons) {
      const ordered =
        first.ordinal < second.ordinal ? [first, second] : [second, first];
      if (normalise(first.text) === normalise(second.text))
        add(
          ordered[0],
          ordered[1],
          "exact-wording",
          "The same wording occurs twice.",
          1,
        );
      else if (
        content(first.text).length >= 4 &&
        content(second.text).length >= 4
      ) {
        const overlap = sentenceSimilarity(
          content(first.text).join(" "),
          content(second.text).join(" "),
        );
        if (overlap >= 0.75)
          add(
            ordered[0],
            ordered[1],
            "word-overlap",
            `${Math.round(overlap * 100)}% content-word overlap; relation unverified.`,
            overlap,
          );
      }
    }
  }
  return out
    .sort(
      (a, b) =>
        Number(b.hypothesis === "exact-wording") -
          Number(a.hypothesis === "exact-wording") || b.overlap - a.overlap,
    )
    .slice(0, limit);
}
