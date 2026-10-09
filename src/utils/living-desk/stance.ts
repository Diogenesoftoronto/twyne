import {
  choice,
  isChoice,
  type SystemOneAnswer,
  type ChoiceQuestion,
} from "../system-one";
import { finding, occurrence, type Block, matchCase } from "./segment";
import type { Finding, Occurrence } from "../living-desk-contract";

export const STANCE_OPTIONS = [
  "the author alone (an editorial or royal we)",
  "the author and the reader together",
  "a group the author belongs to",
  "a character or quoted speaker",
  "people in general",
];
export interface Classification {
  label: string;
  probability: number;
  editorial: number;
  note: string;
}
export type StanceCache = Map<string, Map<number, Classification>>;
export interface StanceCandidate {
  occurrence: Occurrence;
  sentence: string;
  previous: string;
  offset: number;
  cacheKey: string;
}
export interface StanceAnalysis {
  singular: number;
  plural: number;
  candidates: StanceCandidate[];
  finding: Finding | null;
}

export function outsideQuotes(text: string): string {
  // Preserve offsets. Apostrophes in contractions are not quotation marks.
  return text.replace(/"[^"\n]*"|“[^”]*”|‘[^’]*’/g, (s) =>
    " ".repeat(s.length),
  );
}

export function agreementFix(
  text: string,
  start: number,
): { length: number; fix: string } | null {
  const m = /^(we|us|our|ours|ourselves)\b(?:([’']re)|\s+(are|were)\b)?/i.exec(
    text.slice(start),
  );
  if (!m) return null;
  const replacements: Record<string, string> = {
    we: "I",
    us: "me",
    our: "my",
    ours: "mine",
    ourselves: "myself",
  };
  const pronoun = m[1].toLowerCase();
  const suffix =
    pronoun === "we"
      ? m[2]
        ? `${m[2][0]}${matchCase(m[2].slice(1), "m")}`
        : m[3]
          ? `${m[0].slice(m[1].length, -m[3].length)}${matchCase(m[3], m[3].toLowerCase() === "are" ? "am" : "was")}`
          : ""
      : "";
  return {
    length: pronoun === "we" ? m[0].length : m[1].length,
    fix: matchCase(m[1], replacements[pronoun]) + suffix,
  };
}

function ruleLabel(sentence: string, previous: string, offset: number): string {
  const tail = sentence.slice(offset).toLowerCase();
  const before = sentence.slice(0, offset).toLowerCase();
  if (
    /^(?:we (?:would argue|argue|contend|believe|must admit|think|have shown|will show)|our (?:view|argument|thesis))\b/.test(
      tail,
    )
  )
    return "editorial";
  if (
    /^let['’]s\s+\w+/.test(tail) ||
    (/^us\s+\w+/.test(tail) && /let\s*$/.test(before)) ||
    /^we can see\b/.test(tail) ||
    (/as\s*$/.test(before) && /^we(?:['’]ll see| have seen)\b/.test(tail))
  )
    return "inclusive";
  if (
    /^we (?:kids|children|students|villagers|both|all|writers|siblings|parents|members)\b/.test(
      tail,
    ) ||
    /my family and I/i.test(previous + " " + sentence)
  )
    return "group";
  return "unclassified";
}

export function analyzeStance(
  blocks: Block[],
  cache: StanceCache = new Map(),
): StanceAnalysis {
  let singular = 0,
    plural = 0;
  for (const block of blocks) {
    if (
      block.kind === "quote" ||
      block.kind === "code" ||
      block.kind === "heading"
    )
      continue;
    for (const token of outsideQuotes(block.text).matchAll(
      /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves|let['’]s)\b/gi,
    )) {
      if (/^(I|me|my|mine|myself)$/i.test(token[0])) singular++;
      else plural++;
    }
  }
  const candidates: StanceCandidate[] = [];
  const singulars: Occurrence[] = [];
  let previous = "";
  for (const block of blocks) {
    if (
      block.kind === "quote" ||
      block.kind === "code" ||
      block.kind === "heading"
    )
      continue;
    const visible = outsideQuotes(block.text);
    const sentences = [...visible.matchAll(/[^.!?]+[.!?]*/g)];
    for (const span of sentences) {
      const start = span.index!;
      const sentence = block.text.slice(start, start + span[0].length).trim();
      const trim = span[0].length - span[0].trimStart().length;
      for (const token of span[0].matchAll(
        /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves|let['’]s)\b/gi,
      )) {
        const offset = start + token.index!;
        if (/^(I|me|my|mine|myself)$/i.test(token[0])) {
          singulars.push(
            occurrence(block, offset, token[0].length, "stance", {
              flagged: false,
              label: "singular",
            }),
          );
          continue;
        }
        const sentenceOffset = token.index! - trim;
        const cacheKey = JSON.stringify([sentence, previous, singular, plural]);
        const result = cache.get(cacheKey)?.get(sentenceOffset);
        const label =
          result?.label ?? ruleLabel(sentence, previous, sentenceOffset);
        const flagged = result
          ? result.editorial >= 0.6
          : label === "editorial";
        const fix = agreementFix(block.text, offset);
        const occ = occurrence(
          block,
          offset,
          fix?.length ?? token[0].length,
          "stance",
          {
            label,
            flagged,
            ...(flagged && fix ? { fix: fix.fix } : {}),
            provenance: result ? "jev" : "rule",
            probability: result?.probability,
            note:
              result?.note ??
              (label === "inclusive"
                ? "the author and the reader together"
                : label === "group"
                  ? "a group the author belongs to"
                  : label === "editorial"
                    ? "the author alone"
                    : "meaning unclassified"),
          },
        );
        candidates.push({
          occurrence: occ,
          sentence,
          previous,
          offset: sentenceOffset,
          cacheKey,
        });
      }
      previous = sentence;
    }
  }
  const eligible =
    singular >= 3 && singular / (singular + plural) >= 0.6 && plural > 0;
  const count = candidates.filter((c) => c.occurrence.flagged).length;
  return {
    singular,
    plural,
    candidates,
    finding: eligible
      ? finding(
          "stance",
          "stance",
          "Editorial “we” in an “I” essay",
          `${count} editorial “we” · ${singular} singular pronouns`,
          [...candidates.map((c) => c.occurrence), ...singulars],
        )
      : null,
  };
}

export async function classifyStance(
  analysis: StanceAnalysis,
  cache: StanceCache,
  ask: (request: {
    state: Record<string, string>;
    questions: Record<string, ChoiceQuestion>;
  }) => Promise<{ ok: boolean; answers?: Record<string, unknown> }>,
): Promise<{ ok: boolean; remaining: boolean }> {
  const pending = analysis.candidates.filter(
    (c) => !cache.get(c.cacheKey)?.has(c.offset),
  );
  const batch = pending.slice(0, 24);
  if (!batch.length) return { ok: true, remaining: false };
  const state: Record<string, string> = {
    counts: `${analysis.singular} singular; ${analysis.plural} plural`,
  };
  const questions: Record<string, ChoiceQuestion> = {};
  batch.forEach((c, i) => {
    state[`sentence${i}`] = c.sentence;
    state[`previous${i}`] = c.previous;
    questions[`stance${i}`] = choice(
      `Who does “${c.occurrence.text}” at character ${c.offset} in sentence${i} refer to? Use previous${i} and counts as context.`,
      STANCE_OPTIONS,
    );
  });
  const response = await ask({ state, questions });
  if (!response.ok || !response.answers) return { ok: false, remaining: true };
  let complete = true;
  batch.forEach((c, i) => {
    const answer = response.answers![`stance${i}`] as
      | SystemOneAnswer
      | undefined;
    if (
      !isChoice(answer) ||
      !STANCE_OPTIONS.every((o) => Number.isFinite(answer.probabilities?.[o]))
    ) {
      complete = false;
      return;
    }
    const editorial = answer.probabilities[STANCE_OPTIONS[0]];
    const index = editorial >= 0.6 ? 0 : STANCE_OPTIONS.indexOf(answer.choice);
    if (index < 0) {
      complete = false;
      return;
    }
    const entries = cache.get(c.cacheKey) ?? new Map<number, Classification>();
    entries.set(c.offset, {
      editorial,
      label: ["editorial", "inclusive", "group", "quoted", "general"][index],
      probability: answer.probabilities[STANCE_OPTIONS[index]],
      note: index === 0 ? "the author alone" : STANCE_OPTIONS[index],
    });
    cache.set(c.cacheKey, entries);
  });
  while (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return { ok: complete, remaining: pending.length > batch.length };
}
