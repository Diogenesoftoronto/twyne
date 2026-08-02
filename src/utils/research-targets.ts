import type { ResearchTarget, ResearchTargetKind } from "../types";
import { extractFirstJsonObject, stripJsonFences } from "./llm-parsing";
import { stripReasoningTags } from "./reasoning-tags";

export const DEFAULT_TARGETS_PER_PASS = 4;
/** Largest draft slice the extractor will read at once. */
export const DRAFT_SCAN_MAX_CHARS = 9000;
/** Longest anchor quoted back to the writer. */
export const MAX_ANCHOR_CHARS = 200;

export const RESEARCH_TARGET_LABELS: Record<ResearchTargetKind, string> = {
  quote: "Quote",
  work: "Film / book / work",
  person: "Person",
  statistic: "Statistic",
  claim: "Claim",
  event: "Event",
};

export function targetKindLabel(kind: string): string {
  return RESEARCH_TARGET_LABELS[kind as ResearchTargetKind] ?? "Source";
}

/* ── Prompt construction ───────────────────────────────────────── */

export function buildResearchExtractSystemPrompt(): string {
  return `You are a scholarly research librarian working for a writer of serious nonfiction. You read the draft and decide, with surgical discipline, exactly which passages require a source — and what precise question would resolve them.

You do not invent sources, and you do not produce a bibliography. You only produce the intake for the next agent: one target per passage that genuinely needs authority behind it.

You are looking for:
- QUOTES that need attribution — who actually said or wrote this? Capture the distinctive words in the search query so a later agent can find the origin.
- WORKS that are named or referenced — a film, book, play, album, TV series, or artwork the reader is expected to know.
- PEOPLE who are named and relied on because the reader is expected to know who they are.
- STATISTICS and figures such as surveys, percentages, population numbers, or dates that are presented as fact.
- CLAIMS about the world that are checkable, such as something that happened, a cause, or a claim about a group.
- EVENTS that are referenced as real — a war, a strike, a scandal, a court ruling.

Rules of discipline:
- Only one target per distinct passage. Never file the same idea twice.
- Do not target the draft's own argument, thesis, opinions, metaphors, or common knowledge.
- Do not target a proper noun merely because it is capitalized or in italics.
- If the sentence names its own source ("according to the 2024 WHO report…"), it is covered — skip it.
- Anchor must be verbatim: copy the exact sentence or phrase from the draft, and keep it short (under ${MAX_ANCHOR_CHARS} characters).
- For QUOTES, the query should carry a distinctive span of the phrase plus the attribution ask, e.g. who said "…".
- For WORKS, the query should be the title plus the medium so results cannot miss.
- For STATISTICS, the query should name the number and the context.
- Order the list by importance, most important first. Fewer, correct, sharp targets beat many misty ones.
- Be conservative: a target appears only when withholding a source would genuinely weaken the draft.

Respond with only a JSON object — no prose, no markdown fences:
{"targets":[{"kind":"quote|work|person|statistic|claim|event","anchor":"<exact passage from the draft>","reason":"<one sentence: why this must not stand uncited>","query":"<a precise search query 12-60 characters that would resolve this>","importance":<1-5>}]}`;
}

export function buildResearchExtractUserPrompt(input: {
  draftText: string;
  existingSources: string[];
  maxTargets: number;
  instructions?: string;
}): string {
  const existing =
    input.existingSources.length > 0
      ? `Already covered in the writer's bibliography (do not flag these):\n${input.existingSources.map((s) => `- ${s}`).join("\n")}`
      : "The writer's bibliography is empty.";
  const extra = input.instructions?.trim()
    ? `\n\nExtra directions from the writer:\n${input.instructions.trim()}`
    : "";
  return `FIND UP TO ${input.maxTargets} ITEMS in this draft that need a source.

${existing}

Draft:
"""
${input.draftText.slice(0, DRAFT_SCAN_MAX_CHARS)}
"""
${extra}

Return a JSON object only.`;
}

/* ── Parsing ────────────────────────────────────────────────────── */

function normalizeKind(k: unknown): ResearchTargetKind {
  switch (k) {
    case "quote":
    case "work":
    case "person":
    case "statistic":
    case "claim":
    case "event":
      return k;
    default:
      return "claim";
  }
}

function hashToken(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function collectList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is Record<string, unknown> =>
        !!v && typeof v === "object" && !Array.isArray(v),
    );
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["targets", "items", "results"]) {
      if (Array.isArray(rec[key])) {
        return collectList(rec[key]);
      }
    }
  }
  return [];
}

/**
 * Parse an extraction reply into normalized {@link ResearchTarget}s.
 * Drops entries that could not possibly drive a search and removes
 * duplicate anchor/query pairs so the watcher never researches the same
 * passage twice in one pass.
 */
export function parseResearchTargets(text: string): ResearchTarget[] {
  const cleanTarget = (candidate: string): ResearchTarget[] => {
    let data: unknown;
    try {
      data = JSON.parse(candidate) as unknown;
    } catch {
      return [];
    }
    const list = collectList(data);
    const seenAnchors = new Set<string>();
    const seenQueries = new Set<string>();
    const targets: ResearchTarget[] = [];
    for (const rec of list) {
      const anchor = typeof rec.anchor === "string" ? rec.anchor.trim() : "";
      const rawQuery = typeof rec.query === "string" ? rec.query.trim() : "";
      const query =
        rawQuery.length >= 3 ? rawQuery.slice(0, 160) : anchor.slice(0, 80);
      if (anchor.length < 3 || query.length < 3) continue;
      const anchorKey = anchor.toLowerCase();
      const queryKey = query.toLowerCase();
      if (seenAnchors.has(anchorKey) || seenQueries.has(queryKey)) continue;
      seenAnchors.add(anchorKey);
      seenQueries.add(queryKey);
      const reason =
        typeof rec.reason === "string" && rec.reason.trim()
          ? rec.reason.trim().slice(0, 240)
          : "Needs a verifiable source";
      const importance =
        typeof rec.importance === "number"
          ? Math.max(1, Math.min(5, Math.round(rec.importance)))
          : 3;
      targets.push({
        id: `k-${targets.length}-${hashToken(anchorKey)}`,
        kind: normalizeKind(rec.kind),
        anchor: anchor.slice(0, MAX_ANCHOR_CHARS),
        reason,
        query,
        importance,
      });
    }
    targets.sort((a, b) => b.importance - a.importance);
    return targets;
  };

  const stripped = stripJsonFences(stripReasoningTags(text));
  const firstObject = extractFirstJsonObject(stripped);
  if (firstObject) {
    const fromObject = cleanTarget(firstObject);
    if (fromObject.length) return fromObject;
  }
  const firstArray = stripped.indexOf("[");
  if (firstArray >= 0) {
    const maybeArray = stripped.slice(firstArray);
    try {
      if (Array.isArray(JSON.parse(maybeArray))) {
        return cleanTarget(maybeArray);
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

/* ── Dedupe across passes ───────────────────────────────────────── */

/** Stable identity for a target, used to avoid re-researching. */
export function targetKey(t: Pick<ResearchTarget, "kind" | "anchor">): string {
  return `${t.kind}|${t.anchor.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/**
 * Pick the targets that will do the most new work: excludes anchors
 * already covered in the bibliography or just researched, then takes the
 * first `budget` (the model ordered by importance).
 */
export function selectFreshTargets(
  targets: ResearchTarget[],
  opts: {
    budget: number;
    coveredKeys?: ReadonlySet<string>;
    recentKeys?: ReadonlySet<string>;
  },
): ResearchTarget[] {
  const fresh = targets.filter(
    (t) =>
      !opts.coveredKeys?.has(targetKey(t)) &&
      !opts.recentKeys?.has(targetKey(t)),
  );
  return fresh.slice(0, Math.max(0, opts.budget));
}

/* ── Result ranking ────────────────────────────────────────────── */

/**
 * Rank the provider's returned sources for a single target. Provider-agnostic
 * ordering that prefers a source with a real snippet and an author or p
 * publisher label; the provider's own ordering breaks ties. The caller still
 * applies URL dedupe and the per-pass save budget.
 */
export function rankSourcesForTarget<
  T extends {
    url: string;
    snippet?: string;
    title?: string;
    author?: string;
    publisher?: string;
  },
>(sources: T[]): T[] {
  const scored = sources
    .map((source, index) => ({
      source,
      score:
        (source.snippet && source.snippet.trim().length >= 40 ? 1 : 0) +
        (source.author ? 0.5 : 0) +
        (source.publisher ? 0.5 : 0) +
        (source.title ? 0.25 : 0) +
        Math.max(0, 1 - index * 0.2),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.source);
}
