import type {
  ProjectBrief,
  ResearchTarget,
  ResearchTargetKind,
} from "../types";
import { extractFirstJsonObject, stripJsonFences } from "./llm-parsing";
import { stripReasoningTags } from "./reasoning-tags";
import { prompt as renderNamed } from "./prompts";

/** Extraction is deliberately deeper than the per-run search budget. Covered
 * targets fall away on later passes, allowing the queue to advance through a
 * dense draft without bursting hosted-provider rate limits. */
export const DEFAULT_TARGETS_PER_PASS = 12;
/** Largest draft slice the extractor will read at once. */
export const DRAFT_SCAN_MAX_CHARS = 18_000;
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

export interface DirectedResearchTargetInput {
  anchor: string;
  query?: string;
  instructions?: string;
  kind?: ResearchTargetKind;
}

export type DossierResearchMode = "fiction" | "nonfiction" | "general";

const FICTION_FORMAT =
  /\b(novel|novella|fiction|short stor(?:y|ies)|screenplay|teleplay|stage play|graphic novel|comic|narrative game)\b/i;
const NONFICTION_FORMAT =
  /\b(non[- ]?fiction|essay|article|report\w*|journalism|memoir|biograph\w*|white paper|academic|research|op[- ]?ed|opinion|column|feature|explainer|investigat\w*|analys[ie]s|commentary|review|interview|documentary|textbook|thesis|dissertation|case stud(?:y|ies)|newsletter|profile|history|criticism|proposal)\b/i;

/** The Dossier's declared form is authoritative. Goal/constraints are only a
 * fallback for older or loosely worded dossiers such as "book-length work". */
export function dossierResearchMode(
  brief: ProjectBrief | null,
): DossierResearchMode {
  if (!brief) return "general";
  const format = brief.answers.format.trim();
  if (NONFICTION_FORMAT.test(format)) return "nonfiction";
  if (FICTION_FORMAT.test(format)) return "fiction";
  const fallback = [
    brief.answers.goal,
    brief.answers.constraints,
    ...(brief.probes ?? []).flatMap((probe) =>
      Array.isArray(probe.answer)
        ? probe.answer
        : probe.answer === undefined
          ? []
          : [String(probe.answer)],
    ),
  ].join(" ");
  if (FICTION_FORMAT.test(fallback)) return "fiction";
  if (NONFICTION_FORMAT.test(fallback)) return "nonfiction";
  return "general";
}

function compactDossierValue(value: string, max = 500): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Turn the whole useful Dossier—not only title/tone—into an explicit modus
 * operandi for target extraction. Kept bounded because it shares context with
 * the manuscript. */
export function buildDossierResearchInstructions(
  brief: ProjectBrief | null,
): string {
  if (!brief) {
    return [
      "Research mode selected from Dossier: GENERAL (no Dossier available).",
      "Treat real-world quotations, people, statistics, events, works, and factual claims as checkable, while leaving clearly invented material alone.",
    ].join("\n");
  }

  const mode = dossierResearchMode(brief);
  const a = brief.answers;
  const lines = [
    `Research mode selected from Dossier: ${mode.toUpperCase()}.`,
    "Dossier particulars:",
    `- Format: ${compactDossierValue(a.format)}`,
    `- Working title: ${compactDossierValue(a.workingTitle)}`,
    `- Audience: ${compactDossierValue(a.audience)}`,
    `- Goal: ${compactDossierValue(a.goal)}`,
    `- Tone: ${compactDossierValue(a.tone)}`,
    `- Constraints: ${compactDossierValue(a.constraints)}`,
    `- Success signal: ${compactDossierValue(a.successSignal)}`,
  ];

  const answeredProbes = (brief.probes ?? [])
    .filter((probe) => probe.answer !== undefined)
    .slice(0, 6)
    .map((probe) => {
      const answer = Array.isArray(probe.answer)
        ? probe.answer.join("; ")
        : String(probe.answer);
      return `- ${compactDossierValue(probe.prompt, 240)} => ${compactDossierValue(answer, 300)}`;
    });
  if (answeredProbes.length > 0) {
    lines.push("Answered Dossier probes:", ...answeredProbes);
  }

  const references = brief.attachments
    .slice(0, 6)
    .map(
      (attachment) =>
        `- ${compactDossierValue(attachment.title, 200)}: ${compactDossierValue(attachment.why, 300)}`,
    );
  if (references.length > 0) {
    lines.push("Dossier reference notes:", ...references);
  }

  lines.push(
    mode === "fiction"
      ? "Modus operandi: research for authenticity, period and setting accuracy, real people and works, cultural and professional context, physical plausibility, and quotation provenance. Do not fact-check invented plot, characters, worldbuilding, narration, or dialogue merely because it is written declaratively."
      : mode === "nonfiction"
        ? "Modus operandi: fact-check every material external claim; verify quotation wording and provenance, each named person's asserted context, statistics, dates, events, scope, and whether named sources actually support the prose."
        : "Modus operandi: use the Dossier to distinguish invented material from real-world assertions; verify or authenticate every material outside-world detail.",
  );
  return lines.join("\n");
}

/** Give every provider the verification question behind a search, not only a
 * generic request for links. Search APIs may ignore this context; model/MCP
 * providers can use it to distinguish corroboration from topical similarity. */
export function buildResearchSearchContext(target: ResearchTarget): string {
  const mandate: Record<ResearchTargetKind, string> = {
    quote:
      "Verify the exact wording, speaker or author, original source, date, and immediate context of this quotation.",
    person:
      "Verify this person's identity and the specific role, relationship, action, viewpoint, or chronology asserted here.",
    statistic:
      "Verify the exact figure, population, time period, methodology, and original dataset or study.",
    claim:
      "Fact-check the exact assertion, including evidence that supports or contradicts it and any missing scope or qualification.",
    event:
      "Verify what happened, where and when it happened, who was involved, and whether the draft's characterization is accurate.",
    work: "Verify the identity, authorship, publication or release details, medium, and contextual claim about this work.",
  };
  return [
    mandate[target.kind],
    `Draft passage: "${target.anchor}"`,
    `Why it was flagged: ${target.reason}`,
  ].join("\n");
}

export function buildResearchSearchInstructions(
  target: ResearchTarget,
): string {
  const specific =
    target.kind === "quote"
      ? "For a quotation, prefer the original text, recording, transcript, archival document, or a reliable edition that establishes wording and context."
      : target.kind === "person"
        ? "For a person, require a source that supports the specific contextual statement, not merely a generic biography page."
        : "Prefer primary sources and authoritative records; include secondary analysis when it is needed to interpret or challenge the claim.";
  return `${specific} Return only sources whose available evidence can support, correct, or meaningfully contextualize the flagged passage. Topical similarity alone is not enough.`;
}

/** Build the single target used when a writer researches selected text. */
export function directedResearchTarget(
  request: DirectedResearchTargetInput,
): ResearchTarget | null {
  const anchor = request.anchor.trim();
  if (!anchor) return null;
  const instructions = request.instructions?.trim();
  const query =
    request.query?.trim() ||
    (instructions ? `${anchor} ${instructions}` : anchor);
  return {
    id: `directed-${crypto.randomUUID()}`,
    kind: request.kind ?? "claim",
    anchor,
    query,
    reason: instructions || "The writer requested sources for this passage.",
    importance: 5,
  };
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
