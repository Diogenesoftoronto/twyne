import { splitSentences } from "./struggle-signals";

/** Session-local sentence identity. Ranges are UTF-16 ProseMirror positions. */
export interface LedgerSpan {
  text: string;
  from: number;
  to: number;
  blockFrom: number;
}
export interface SentenceWording {
  text: string;
  at: number;
  source: "yours";
}
export interface SentencePlacement {
  from: number;
  blockFrom: number;
  at: number;
}
export interface SentenceEntry extends LedgerSpan {
  id: string;
  wordings: SentenceWording[];
  placements: SentencePlacement[];
  parentIds: string[];
  lineage: "new" | "rewrite" | "split" | "join" | "move";
  changedAt: number;
  retired: boolean;
}
export interface SentenceLedger {
  entries: SentenceEntry[];
  serial: number;
}
export const emptySentenceLedger = (): SentenceLedger => ({
  entries: [],
  serial: 0,
});
export const SENTENCE_SETTLE_MS = 5000;

export function completeSentence(text: string): boolean {
  if (/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$/i.test(text.trim()))
    return false;
  return (
    text.trim().length >= 3 &&
    /[.!?…]["'”’)\]]*$/.test(text.trim()) &&
    /\p{L}/u.test(text) &&
    !/\b\p{L}\s*[.!?…]$/u.test(text)
  );
}

/** Prefixes and small spelling edits are not distinct attempts. */
export function wordingDistance(a: string, b: string): number {
  let prefix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(a.length, b.length) - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  return Math.max(a.length, b.length) - prefix - suffix;
}
const stem = (s: string) =>
  s
    .trim()
    .replace(/[.!?…"'”’)\]]+$/, "")
    .toLocaleLowerCase();
export function wordingIsPrefix(a: string, b: string): boolean {
  const x = stem(a),
    y = stem(b);
  return x !== y && y.startsWith(x) && /\s/.test(y[x.length] ?? "");
}

/** Multiset token overlap, for identity only; never a claim about meaning. */
export function sentenceSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    s.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const left = words(a),
    right = words(b);
  if (!left.length || !right.length) return 0;
  const counts = new Map<string, number>();
  left.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
  let shared = 0;
  right.forEach((w) => {
    const n = counts.get(w) ?? 0;
    if (n) {
      shared++;
      counts.set(w, n - 1);
    }
  });
  return (2 * shared) / (left.length + right.length);
}

/** Map existing IDs on transactions, without scanning draft text. */
export function mapSentenceLedger(
  ledger: SentenceLedger,
  map: (pos: number, assoc: number) => number,
  touched: Array<{ from: number; to: number }>,
  now: number,
): SentenceLedger {
  return {
    ...ledger,
    entries: ledger.entries.map((entry) => {
      if (entry.retired) return entry;
      const edited = touched.some(
        (r) => r.from <= entry.to && r.to >= entry.from,
      );
      const from = map(entry.from, 1),
        to = map(entry.to, -1);
      return {
        ...entry,
        from: Math.min(from, to),
        to: Math.max(from, to),
        blockFrom: map(entry.blockFrom, 1),
        changedAt: edited ? now : entry.changedAt,
      };
    }),
  };
}

/** Reconcile only on settle. Exact text wins before positional/fuzzy matching.
 * Retired IDs remain available for cut/paste; split/join ancestry is explicit.
 */
export function reconcileSentenceLedger(
  ledger: SentenceLedger,
  spans: LedgerSpan[],
  now: number,
): SentenceLedger {
  let serial = ledger.serial;
  const used = new Set<string>();
  const assignments = new Map<number, SentenceEntry>();
  // Reserve exact matches before an edited sentence can steal a neighbour's ID.
  spans.forEach((span, index) => {
    const matches = ledger.entries.filter(
      (e) => !used.has(e.id) && e.text === span.text,
    );
    const entry = matches.sort(
      (a, b) =>
        Number(a.retired) - Number(b.retired) ||
        Math.abs(a.from - span.from) - Math.abs(b.from - span.from),
    )[0];
    if (entry) {
      used.add(entry.id);
      assignments.set(index, entry);
    }
  });
  const next = spans.map((span, index): SentenceEntry => {
    let previous = assignments.get(index);
    if (!previous) {
      previous = ledger.entries
        .filter((e) => !used.has(e.id))
        .map((e) => ({
          e,
          similarity: sentenceSimilarity(e.text, span.text),
          overlap: !e.retired && e.from < span.to && e.to > span.from,
        }))
        .filter(
          (m) => m.similarity >= (m.e.retired ? 0.9 : m.overlap ? 0 : 0.9),
        )
        .sort(
          (a, b) =>
            Number(b.overlap) - Number(a.overlap) ||
            b.similarity - a.similarity,
        )[0]?.e;
      if (previous) used.add(previous.id);
    }
    const parents = ledger.entries.filter(
      (e) =>
        !e.retired &&
        e.from < span.to &&
        e.to > span.from &&
        sentenceSimilarity(e.text, span.text) >= 0.3,
    );
    const splitParent = ledger.entries.find(
      (e) =>
        !e.retired &&
        splitSentences(e.text).length === 1 &&
        stem(e.text).includes(stem(span.text)) &&
        spans.filter((s) => stem(e.text).includes(stem(s.text))).length > 1,
    );
    const moved =
      previous &&
      (previous.retired ||
        previous.blockFrom !== span.blockFrom ||
        previous.from !== span.from) &&
      previous.text === span.text;
    const lineage =
      parents.length > 1
        ? "join"
        : splitParent
          ? "split"
          : moved
            ? "move"
            : previous && previous.text !== span.text
              ? "rewrite"
              : (previous?.lineage ?? "new");
    const parentIds = [
      ...new Set([
        ...(previous?.parentIds ?? []),
        ...parents.filter((e) => e.id !== previous?.id).map((e) => e.id),
        ...(splitParent && splitParent.id !== previous?.id
          ? [splitParent.id]
          : []),
      ]),
    ];
    const placement = { from: span.from, blockFrom: span.blockFrom, at: now };
    const placements = previous?.placements ?? splitParent?.placements ?? [];
    // Ordinary position shifts from typing before a sentence are not moves.
    const changedPlacement = !!moved;
    return {
      ...span,
      id: previous?.id ?? `sentence-${++serial}`,
      wordings: previous?.wordings ?? [],
      placements:
        placements.length === 0 || changedPlacement
          ? [...placements, placement].slice(-8)
          : placements,
      parentIds,
      lineage,
      changedAt: previous?.changedAt ?? now,
      retired: false,
    };
  });
  const archived = ledger.entries
    .filter((e) => !used.has(e.id))
    .map((e) => ({ ...e, retired: true }));
  return { serial, entries: [...next, ...archived].slice(0, 2000) };
}

/** Called only after Harper has checked the complete wording's spelling. */
export function settleSentenceWording(
  entry: SentenceEntry,
  now: number,
  cursor: number | null,
  spellingChecked: boolean,
): SentenceEntry {
  if (!spellingChecked || !completeSentence(entry.text) || entry.retired)
    return entry;
  if (
    cursor !== null &&
    cursor >= entry.from &&
    cursor <= entry.to &&
    now - entry.changedAt < SENTENCE_SETTLE_MS
  )
    return entry;
  if (
    entry.wordings.some(
      (w) => w.text === entry.text || wordingDistance(w.text, entry.text) < 3,
    )
  )
    return entry;
  const wordings = entry.wordings.filter(
    (w) => !wordingIsPrefix(w.text, entry.text),
  );
  if (wordings.some((w) => wordingIsPrefix(entry.text, w.text))) return entry;
  return {
    ...entry,
    wordings: [
      ...wordings,
      { text: entry.text, at: now, source: "yours" as const },
    ].slice(-6),
  };
}
