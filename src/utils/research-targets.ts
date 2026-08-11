import type { ResearchTarget, ResearchTargetKind } from "../types";
import { extractFirstJsonObject, stripJsonFences } from "./llm-parsing";
import { stripReasoningTags } from "./reasoning-tags";
import { prompt as renderNamed } from "./prompts";

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
  return renderNamed("research-extract-system", {
    maxAnchorChars: MAX_ANCHOR_CHARS,
  });
}

export function buildResearchExtractUserPrompt(input: {
  draftText: string;
  existingSources: string[];
  maxTargets: number;
  instructions?: string;
}): string {
  const existingBlock =
    input.existingSources.length > 0
      ? renderNamed("blocks/research-extract-existing", {
          probeLines: input.existingSources.map((s) => `- ${s}`).join("\n"),
        })
      : renderNamed("blocks/research-extract-existing-empty");
  const extra = input.instructions?.trim()
    ? renderNamed("blocks/research-extract-extra", {
        instructions: input.instructions.trim(),
      })
    : "";
  return renderNamed("research-extract-user", {
    maxTargets: input.maxTargets,
    existingBlock,
    draftExcerpt: input.draftText.slice(0, DRAFT_SCAN_MAX_CHARS),
    extra,
  });
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
