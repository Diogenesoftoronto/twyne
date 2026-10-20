export interface PassageRange {
  from: number;
  to: number;
  passage: string;
}

export function manuscriptParagraphs(draft: string): PassageRange[] {
  const out: PassageRange[] = [];
  for (const match of draft.matchAll(/[^\n]+/g)) {
    const from = match.index!;
    // Bound even a manuscript written as one paragraph.
    for (let offset = 0; offset < match[0].length; offset += 8000) {
      const start = from + offset;
      const to = Math.min(start + 8000, from + match[0].length);
      if (draft.slice(start, to).trim())
        out.push({ from: start, to, passage: draft.slice(start, to) });
    }
  }
  return out;
}

export function selectPassageWindow(
  draft: string,
  query: string,
  limit = 96_000,
  max = Infinity,
) {
  const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const ranked = manuscriptParagraphs(draft)
    .map((p) => {
      const words = new Set(
        p.passage.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
      );
      return {
        ...p,
        score: [...terms].filter((word) => words.has(word)).length,
      };
    })
    .sort((a, b) => b.score - a.score || a.from - b.from);
  const selected: PassageRange[] = [];
  let size = 0;
  for (const p of ranked) {
    if (selected.length >= max) break;
    if (size + p.passage.length + 2 > limit) continue;
    selected.push(p);
    size += p.passage.length + 2;
  }
  selected.sort((a, b) => a.from - b.from);
  let state = "";
  const segments = selected.map((p) => {
    const start = state.length;
    state += p.passage + "\n\n";
    return { ...p, start, end: state.length - 2 };
  });
  return {
    state: state.slice(0, -2),
    truncated: selected.length < ranked.length,
    resolve(span: unknown): PassageRange | null {
      if (!Array.isArray(span) || span.length !== 2) return null;
      const [s, e] = span;
      if (
        !Number.isSafeInteger(s) ||
        !Number.isSafeInteger(e) ||
        s < 0 ||
        e <= s
      )
        return null;
      const segment = segments.find((p) => s >= p.start && e <= p.end);
      if (!segment) return null;
      const from = segment.from + s - segment.start;
      const to = segment.from + e - segment.start;
      return { from, to, passage: draft.slice(from, to) };
    },
  };
}
