/** "3,5-7" ⇄ [3, 5, 6, 7]. Tolerant of whitespace; ignores anything else. */
const MAX_LINE = 100_000;
const MAX_LINES = 5_000;

export function parseLineRanges(spec: string | null | undefined): number[] {
  const lines = new Set<number>();
  for (const part of (spec ?? "").split(",")) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from || to > MAX_LINE) continue;
    for (let n = from; n <= to && lines.size < MAX_LINES; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/** Canonical compact form of a spec, or "" when it holds no valid lines. */
export function normalizeLineRanges(spec: string | null | undefined): string {
  const lines = parseLineRanges(spec);
  const parts: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (lines[j + 1] === lines[j] + 1) j++;
    parts.push(j > i ? `${lines[i]}-${lines[j]}` : String(lines[i]));
    i = j + 1;
  }
  return parts.join(",");
}
