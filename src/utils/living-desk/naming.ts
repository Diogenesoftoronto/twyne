import { finding, occurrence, type Block } from "./segment";
import type { Finding, Occurrence } from "../living-desk-contract";

const STOP = new Set(
  "I We He She It They The A An This That These Those There Here But And Or For From To In On At As If When While After Before By With Without My Our Your His Her Its Their Yes No Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Opening Chapter Section Part However Therefore Indeed Finally First Second Third One Two Three Four Five Six Seven Eight Nine Ten US UK".split(
    " ",
  ),
);
export interface NameGroup {
  canonical: string;
  variants: string[];
  mentions: Occurrence[];
}

/** Optimal-string-alignment Damerau distance, with adjacent transposition. */
export function nameDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}

export function analyzeNaming(blocks: Block[]): {
  groups: NameGroup[];
  findings: Finding[];
} {
  const tokens = new Map<string, Occurrence[]>();
  const candidates: {
    name: string;
    offset: number;
    block: Block;
    initial: boolean;
  }[] = [];
  for (const block of blocks) {
    if (block.kind === "code" || block.kind === "heading") continue;
    for (const m of block.text.matchAll(
      /\b[A-Z][\p{L}’'-]+(?:\s+[A-Z][\p{L}’'-]+)*/gu,
    )) {
      const words = m[0].split(/\s+/);
      while (words.length && STOP.has(words[0])) words.shift();
      if (!words.length || words.some((word) => STOP.has(word))) continue;
      const name = words.join(" ");
      const offset = m.index! + m[0].lastIndexOf(name);
      const initial =
        !block.text.slice(0, offset).trim() ||
        /[.!?]\s*$/.test(block.text.slice(0, offset));
      candidates.push({ name, offset, block, initial });
    }
  }
  // Discover names in unambiguous positions, then collect ALL their mentions,
  // including sentence starts and near-spelled variants at sentence starts.
  const discovered = new Set(
    candidates.filter((c) => !c.initial).map((c) => c.name),
  );
  const seeds = [...discovered];
  for (const { name, offset, block, initial } of candidates) {
    if (
      initial &&
      !discovered.has(name) &&
      !seeds.some((seed) => {
        const length = Math.min(name.length, seed.length),
          limit = length >= 8 ? 2 : length >= 5 ? 1 : 0;
        return (
          limit > 0 &&
          name[0] === seed[0] &&
          Math.abs(name.length - seed.length) <= limit &&
          nameDistance(name.toLowerCase(), seed.toLowerCase()) <= limit
        );
      })
    )
      continue;
    const list = tokens.get(name) ?? [];
    list.push(
      occurrence(block, offset, name.length, "naming", {
        flagged: false,
        label: "canonical",
      }),
    );
    tokens.set(name, list);
  }
  const ordered = [...tokens.keys()].sort(
    (a, b) =>
      tokens.get(b)!.length - tokens.get(a)!.length || a.localeCompare(b),
  );
  const used = new Set<string>();
  const groups: NameGroup[] = [];
  for (const canonical of ordered) {
    if (used.has(canonical)) continue;
    used.add(canonical);
    const count = tokens.get(canonical)!.length;
    const variants = ordered.filter((other) => {
      if (
        used.has(other) ||
        other[0] !== canonical[0] ||
        count < 2 * tokens.get(other)!.length
      )
        return false;
      const length = Math.min(other.length, canonical.length),
        limit = length >= 8 ? 2 : length >= 5 ? 1 : 0;
      return (
        limit > 0 &&
        Math.abs(other.length - canonical.length) <= limit &&
        nameDistance(canonical.toLowerCase(), other.toLowerCase()) <= limit
      );
    });
    variants.forEach((v) => used.add(v));
    groups.push({
      canonical,
      variants,
      mentions: [
        ...tokens.get(canonical)!,
        ...variants.flatMap((v) =>
          tokens.get(v)!.map((o) => ({
            ...o,
            flagged: true,
            fix: canonical,
            label: "variant",
            note: `“${canonical}” is the majority spelling`,
          })),
        ),
      ].sort((a, b) => a.from - b.from),
    });
  }
  const findings = groups
    .filter((g) => g.variants.length)
    .map((g) => {
      const variant = g.mentions.find((o) => o.flagged)!;
      const metric =
        [
          `“${g.canonical}” ×${g.mentions.filter((o) => !o.flagged).length}`,
          ...g.variants.map(
            (v) => `“${v}” ×${g.mentions.filter((o) => o.text === v).length}`,
          ),
        ].join(" · ") + ` in ¶${variant.paragraph}`;
      return finding(
        `naming:${g.canonical.toLowerCase()}`,
        "naming",
        `${g.canonical} is spelled ${g.variants.length === 1 ? "two" : "several"} ways`,
        metric,
        g.mentions,
      );
    });
  return { groups, findings };
}
