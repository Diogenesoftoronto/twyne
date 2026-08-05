/**
 * Pure, content-agnostic checks for AI generation telemetry.
 *
 * These checks are guardrails, not quality judges. They make malformed
 * structured responses and broken protocols visible to PostHog without
 * turning an event property into an LLM evaluation result.
 */

export const AI_EVALUATION_VERSION = 1 as const;
export const MAX_AI_CONTENT_CHARS = 6000;

export type AiContentMode = "redacted" | "full";

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface DeterministicAiChecks {
  structuredOutput: boolean | null;
  scoreRange: boolean | null;
  protocol: boolean | null;
  citationIntegrity: boolean | null;
  status: "pass" | "fail" | "not_applicable";
}

export function createAiTraceId(feature: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${feature}:${uuid}`;
}

export function clampAiContent(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= MAX_AI_CONTENT_CHARS) return text;
  return `${text.slice(0, MAX_AI_CONTENT_CHARS)}\n\n[truncated]`;
}

export function serializeAiContent(
  text: string | undefined,
  mode: AiContentMode,
): string | undefined {
  if (text === undefined) return undefined;
  return mode === "full" ? clampAiContent(text) : "[redacted]";
}

export function normalizeAiUsage(value: unknown): AiUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const details =
    raw.inputTokenDetails && typeof raw.inputTokenDetails === "object"
      ? (raw.inputTokenDetails as Record<string, unknown>)
      : {};
  const outputDetails =
    raw.outputTokenDetails && typeof raw.outputTokenDetails === "object"
      ? (raw.outputTokenDetails as Record<string, unknown>)
      : {};
  const number = (candidate: unknown): number | undefined =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(0, Math.floor(candidate))
      : undefined;
  const usage: AiUsage = {
    inputTokens: number(raw.inputTokens),
    outputTokens: number(raw.outputTokens),
    totalTokens: number(raw.totalTokens),
    cacheReadTokens: number(raw.cachedInputTokens ?? details.cacheReadTokens),
    cacheWriteTokens: number(details.cacheWriteTokens),
    reasoningTokens: number(
      raw.reasoningTokens ?? outputDetails.reasoningTokens,
    ),
  };
  return Object.values(usage).some((entry) => entry !== undefined)
    ? usage
    : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const candidates = [
    text.trim(),
    text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim(),
    text.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Try the next tolerant candidate.
    }
  }
  return null;
}

function structuredOutputCheck(
  output: string,
  expectedFormat: unknown,
): { valid: boolean; scoreRange: boolean | null } | null {
  if (typeof expectedFormat !== "string") return null;
  const parsed = parseJsonObject(output);
  if (!parsed) return { valid: false, scoreRange: null };

  switch (expectedFormat) {
    case "json_score_rationale": {
      const score = parsed.score;
      const validScore =
        typeof score === "number" &&
        Number.isInteger(score) &&
        score >= 1 &&
        score <= 10;
      return {
        valid:
          validScore &&
          typeof parsed.rationale === "string" &&
          !!parsed.rationale.trim(),
        scoreRange: validScore,
      };
    }
    case "json_rewrite":
      return {
        valid:
          typeof parsed.replacement === "string" && !!parsed.replacement.trim(),
        scoreRange: null,
      };
    case "json_dossier_observations":
      return { valid: Array.isArray(parsed.observations), scoreRange: null };
    case "json_criteria":
      return { valid: Array.isArray(parsed.criteria), scoreRange: null };
    default:
      return { valid: true, scoreRange: null };
  }
}

function protocolCheck(
  output: string,
  signals: Record<string, unknown>,
): boolean | null {
  const required = signals.twyne_required_protocol_markers;
  if (Array.isArray(required)) {
    return required.every(
      (marker) => typeof marker === "string" && output.includes(marker),
    );
  }
  const any = signals.twyne_any_protocol_markers;
  if (Array.isArray(any)) {
    return any.some(
      (marker) => typeof marker === "string" && output.includes(marker),
    );
  }
  return null;
}

function citationCheck(
  output: string,
  signals: Record<string, unknown>,
): boolean | null {
  if (signals.twyne_requires_sources !== true) return null;
  if (/javascript:/i.test(output)) return false;
  const urls = output.match(/https?:\/\/[^\s)<>]+/gi) ?? [];
  const bracketCitations = output.match(/\[\d+\]/g) ?? [];
  return urls.length > 0 || bracketCitations.length > 0;
}

export function evaluateAiOutput({
  output,
  evalSignals = {},
}: {
  output?: string;
  evalSignals?: Record<string, unknown>;
}): DeterministicAiChecks {
  const text = output ?? "";
  const structured = structuredOutputCheck(
    text,
    evalSignals.twyne_expected_format,
  );
  const checks: DeterministicAiChecks = {
    structuredOutput: structured?.valid ?? null,
    scoreRange: structured?.scoreRange ?? null,
    protocol: protocolCheck(text, evalSignals),
    citationIntegrity: citationCheck(text, evalSignals),
    status: "not_applicable",
  };
  const applicable = [
    checks.structuredOutput,
    checks.scoreRange,
    checks.protocol,
    checks.citationIntegrity,
  ].filter((check): check is boolean => check !== null);
  checks.status =
    applicable.length === 0
      ? "not_applicable"
      : applicable.every(Boolean)
        ? "pass"
        : "fail";
  return checks;
}

export function deterministicEvalProperties(
  output: string | undefined,
  evalSignals: Record<string, unknown> = {},
): Record<string, unknown> {
  const checks = evaluateAiOutput({ output, evalSignals });
  return {
    twyne_eval_version: AI_EVALUATION_VERSION,
    twyne_eval_status: checks.status,
    twyne_eval_structured_output_valid: checks.structuredOutput,
    twyne_eval_score_range_valid: checks.scoreRange,
    twyne_eval_protocol_valid: checks.protocol,
    twyne_eval_citation_integrity_valid: checks.citationIntegrity,
  };
}
