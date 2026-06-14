/**
 * Client-side AI engine for BYOK (Bring Your Own Key).
 *
 * This module runs AI calls entirely in the browser using the Vercel AI SDK
 * and the provider packages bundled with the app. Provider API keys are read
 * from the caller's `AiSettings` object (stored in IndexedDB only). They are
 * never sent to any server.
 *
 * The prompt builders from `convex/agentPrompts.ts` are reused so the voices
 * stay identical whether the call runs client-side or server-side.
 *
 * Usage:
 *   const result = await runClientAgent("persona-feedback", agentRequest, settings);
 *   if (result) { use it } else { fallback to Convex action }
 */

import { generateText, type LanguageModel } from "ai";
import type {
  AiSettings,
  AiFeature,
  AiProviderConfig,
  AiFeatureOverride,
} from "../types";
import type {
  AgentRequest,
  AgentResponse,
  FeedbackType,
} from "../../convex/agentPrompts";
import {
  buildSystemPrompt,
  buildUserPrompt,
} from "../../convex/agentPrompts";

/* ── Provider factory ───────────────────────────────────────────── */

async function createModel(
  config: AiProviderConfig,
  modelOverride?: string,
): Promise<LanguageModel | null> {
  try {
    const modelId = modelOverride || config.defaultModel;
    switch (config.type) {
      case "openai": {
        const { createOpenAI } = await import("@ai-sdk/openai");
        const openai = createOpenAI({ apiKey: config.apiKey });
        return openai.chat(modelId);
      }
      case "anthropic": {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        const anthropicProvider = createAnthropic({ apiKey: config.apiKey });
        return anthropicProvider.chat(modelId);
      }
      case "google": {
        const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
        const googleProvider = createGoogleGenerativeAI({ apiKey: config.apiKey });
        return googleProvider(modelId);
      }
      case "openai-compatible": {
        const { createOpenAI } = await import("@ai-sdk/openai");
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
        });
        return openai.chat(modelId);
      }
      default:
        return null;
    }
  } catch (err) {
    console.warn("[twyne:ai-client] failed to create model:", err);
    return null;
  }
}

/* ── Feature routing ────────────────────────────────────────────── */

/**
 * Resolve the effective provider + model + params for a feature.
 * Falls back to the global default provider when a feature has no override.
 */
export function resolveFeatureConfig(
  settings: AiSettings,
  feature: AiFeature,
): {
  provider: AiProviderConfig;
  model: string;
  temperature: number;
  maxTokens: number;
} | null {
  if (!settings.advancedMode || settings.providers.length === 0) {
    return null;
  }

  const override: AiFeatureOverride | undefined = settings.perFeature[feature];
  const providerId = override?.providerId ?? settings.defaultProviderId;
  if (!providerId) return null;

  const provider = settings.providers.find((p) => p.id === providerId);
  if (!provider) return null;

  return {
    provider,
    model: override?.model ?? provider.defaultModel,
    temperature: override?.temperature ?? defaultTemperature(feature),
    maxTokens: override?.maxTokens ?? defaultMaxTokens(feature),
  };
}

function defaultTemperature(feature: AiFeature): number {
  switch (feature) {
    case "rubric-judge":
      return 0.2;
    case "citation-format":
      return 0.1;
    case "source-summarize":
      return 0.3;
    case "source-detect-missing":
      return 0.2;
    default:
      return 0.4;
  }
}

function defaultMaxTokens(feature: AiFeature): number {
  switch (feature) {
    case "persona-feedback":
      return 380;
    case "persona-reply":
      return 320;
    case "persona-rewrite":
      return 320;
    case "rubric-judge":
      return 220;
    case "comment-reply":
      return 280;
    case "citation-format":
      return 180;
    case "source-summarize":
      return 200;
    case "source-detect-missing":
      return 350;
    default:
      return 300;
  }
}

/* ── Classification (mirrors convex/agents.ts) ──────────────────── */

const typeKeywords: Record<FeedbackType, RegExp> = {
  encouragement: /\b(protect|strength|alive|good|works|love|keep)\b/i,
  suggestion: /\b(try|consider|suggest|add|cut|move|compress|split|drop)\b/i,
  critique:
    /\b(weak|fail|missing|wrong|load[- ]bearing|unstated|evade|counterpoint|reject)\b/i,
  perspective:
    /\b(as a|reader|audience|expect|signal|outcome|trust|confused|won over)\b/i,
};

const typeOrder: FeedbackType[] = [
  "critique",
  "suggestion",
  "encouragement",
  "perspective",
];

function classifyType(text: string, fallback: FeedbackType): FeedbackType {
  const scores = typeOrder.map((t) => ({
    t,
    score: (text.match(typeKeywords[t]) ?? []).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  if (scores[0]?.score > 0) return scores[0].t;
  return fallback;
}

function defaultTypeForPersona(personaId: string): FeedbackType {
  switch (personaId) {
    case "devil":
      return "critique";
    case "angel":
      return "encouragement";
    case "scholar":
    case "editor":
      return "suggestion";
    case "reader":
    default:
      return "perspective";
  }
}

/* ── Rewrite response parser (mirrors convex/agents.ts) ─────────── */

function parseRewriteOutput(
  text: string,
): { replacement: string; rationale: string } | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const tryParse = (s: string) => {
    try {
      const o = JSON.parse(s);
      if (o && typeof o.replacement === "string" && o.replacement.trim()) {
        return {
          replacement: o.replacement.trim(),
          rationale:
            typeof o.rationale === "string" ? o.rationale.trim() : "",
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  };
  return (
    tryParse(stripped) ??
    tryParse(stripped.match(/\{[\s\S]*\}/)?.[0] ?? "")
  );
}

/* ── Public: run a rewrite client-side ──────────────────────────── */

export interface RewriteClientRequest {
  persona: AgentRequest["persona"];
  brief: AgentRequest["brief"];
  draftText: string;
  original: string;
  level: "sentence" | "paragraph";
}

export interface RewriteClientResult {
  replacement: string;
  rationale: string;
  provider: string;
}

export async function runClientRewrite(
  req: RewriteClientRequest,
  settings: AiSettings,
): Promise<RewriteClientResult | null> {
  const resolved = resolveFeatureConfig(settings, "persona-rewrite");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = buildSystemPrompt(req.persona);
    const sizeRule =
      req.level === "sentence"
        ? "Keep the replacement to a single sentence."
        : "The replacement may be up to one paragraph, but no longer than the original.";
    const user = `${buildUserPrompt({
      persona: req.persona,
      brief: req.brief,
      draftText: req.draftText,
      instruction: "rewrite-suggestion",
    })}

REWRITE TASK: Rewrite the PASSAGE below in your voice, preserving its meaning but doing the work better. ${sizeRule}
Respond as JSON only, no prose: {"replacement": "<rewritten passage as plain text>", "rationale": "<one sentence, in your voice>"}

PASSAGE:
"${req.original}"`;

    const { text } = await generateText({
      model,
      system,
      prompt: user,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });

    const parsed = parseRewriteOutput(text);
    if (parsed) {
      return {
        replacement: parsed.replacement,
        rationale: parsed.rationale,
        provider: resolved.provider.type,
      };
    }
    return null;
  } catch (err) {
    console.warn("[twyne:ai-client] rewrite failed:", err);
    return null;
  }
}

/* ── Public: run an agent client-side ───────────────────────────── */

export async function runClientAgent(
  feature: AiFeature,
  req: AgentRequest,
  settings: AiSettings,
): Promise<AgentResponse | null> {
  const resolved = resolveFeatureConfig(settings, feature);
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = buildSystemPrompt(req.persona);
    const user = buildUserPrompt(req);
    const fallbackType = defaultTypeForPersona(req.persona.id);

    const { text } = await generateText({
      model,
      system,
      prompt: user,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });

    const cleaned = text.trim();
    return {
      text: cleaned || "(no response)",
      type: classifyType(cleaned, fallbackType),
      provider: resolved.provider.type as AgentResponse["provider"],
    };
  } catch (err) {
    console.warn("[twyne:ai-client] generateText failed:", err);
    return null;
  }
}

/* ── Judge output parser (mirrors convex/agents.ts) ─────────────── */

function parseJudgeOutput(
  text: string,
): { score: number; rationale: string } | null {
  const stripped = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    const obj = JSON.parse(stripped);
    if (typeof obj.score === "number" && typeof obj.rationale === "string") {
      return { score: clampScore(obj.score), rationale: obj.rationale };
    }
  } catch {
    // fall through
  }
  const scoreMatch = stripped.match(/"?score"?\s*[:=]\s*(\d+)/i);
  const rationaleMatch = stripped.match(
    /"?rationale"?\s*[:=]\s*"([^"]+)"/i,
  );
  if (scoreMatch) {
    return {
      score: clampScore(parseInt(scoreMatch[1], 10)),
      rationale:
        rationaleMatch?.[1] ??
        "The draft does part of the work and leaves the rest to the writer.",
    };
  }
  return null;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

/* ── Public: run a single judge client-side ─────────────────────── */

export async function runClientJudge(
  req: AgentRequest,
  settings: AiSettings,
): Promise<{ score: number; rationale: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "rubric-judge");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = buildSystemPrompt(req.persona);
    const user =
      buildUserPrompt({
        persona: req.persona,
        brief: req.brief,
        draftText: req.draftText,
        instruction: "feedback",
      }) +
      `

JUDGE TASK: Give the draft an integer score from 1 to 10. 5 is "doing the work but with clear issues." 7 is "in good shape." 9 is "publishable as-is." Be honest.

Respond with JSON only: {"score": <int>, "rationale": "<one sentence in your voice>"}`;

    const { text } = await generateText({
      model,
      system,
      prompt: user,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });

    const parsed = parseJudgeOutput(text);
    if (parsed) {
      return {
        ...parsed,
        provider: resolved.provider.type,
      };
    }
    return null;
  } catch (err) {
    console.warn("[twyne:ai-client] judge failed:", err);
    return null;
  }
}

/* ── Public: test a provider configuration ──────────────────────── */

export async function testProvider(
  config: AiProviderConfig,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const model = await createModel(config);
    if (!model) {
      return { ok: false, latencyMs: 0, error: "Failed to create model" };
    }
    await generateText({
      model,
      prompt: "Say 'ok' and nothing else.",
      maxOutputTokens: 10,
    });
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: (err as Error).message ?? "Connection failed",
    };
  }
}

/* ── Public: format a raw citation into structured bibliographic data ─ */

export interface CitationFormatRequest {
  rawText: string;
  style: "mla" | "apa" | "chicago";
  context?: string;
}

export interface CitationFormatResult {
  title: string;
  author?: string;
  year?: string;
  url?: string;
  doi?: string;
  publisher?: string;
  formatted: string;
  provider: string;
}

export async function runClientCitationFormat(
  req: CitationFormatRequest,
  settings: AiSettings,
): Promise<CitationFormatResult | null> {
  const resolved = resolveFeatureConfig(settings, "citation-format");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = `You are a meticulous research librarian. Your only job is to take a messy, informal, or incomplete citation and return a clean, properly formatted bibliographic entry. Extract all available fields (title, author, year, URL, DOI, publisher). If information is missing, leave that field blank. Respond as JSON only.`;

    const user = `FORMAT THIS CITATION in ${req.style.toUpperCase()} style.

Raw citation: "${req.rawText}"
${req.context ? `Context from draft: ${req.context}` : ""}

Respond with JSON only:
{"title": "<title>", "author": "<author if known>", "year": "<year if known>", "url": "<url if known>", "doi": "<doi if known>", "publisher": "<publisher if known>", "formatted": "<full ${req.style} citation>"}`;

    const { text } = await generateText({
      model,
      system,
      prompt: user,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });

    const stripped = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    try {
      const o = JSON.parse(stripped);
      if (typeof o.title === "string" && o.title.trim()) {
        return {
          title: o.title.trim(),
          author: typeof o.author === "string" ? o.author.trim() || undefined : undefined,
          year: typeof o.year === "string" ? o.year.trim() || undefined : undefined,
          url: typeof o.url === "string" ? o.url.trim() || undefined : undefined,
          doi: typeof o.doi === "string" ? o.doi.trim() || undefined : undefined,
          publisher: typeof o.publisher === "string" ? o.publisher.trim() || undefined : undefined,
          formatted: typeof o.formatted === "string" ? o.formatted.trim() : o.title.trim(),
          provider: resolved.provider.type,
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  } catch (err) {
    console.warn("[twyne:ai-client] citation format failed:", err);
    return null;
  }
}

/* ── Public: summarize a source from title/URL ──────────────────── */

export interface SourceSummarizeRequest {
  title: string;
  url?: string;
  author?: string;
}

export interface SourceSummarizeResult {
  summary: string;
  keyClaims: string[];
  relevanceScore: number; // 1-10
  provider: string;
}

export async function runClientSourceSummarize(
  req: SourceSummarizeRequest,
  settings: AiSettings,
): Promise<SourceSummarizeResult | null> {
  const resolved = resolveFeatureConfig(settings, "source-summarize");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = `You are a research assistant tasked with summarizing sources for a writer. Given only the title (and optionally URL/author) of a source, infer what the source likely covers and provide a concise summary. Be honest about what you can and cannot know without reading the full text. Respond as JSON only.`;

    const user = `SUMMARIZE THIS SOURCE for a writer's bibliography.

Title: ${req.title}
${req.author ? `Author: ${req.author}` : ""}
${req.url ? `URL: ${req.url}` : ""}

Based on the title${req.url ? " and domain" : ""}, provide:
1. A 1-2 sentence summary of what this source likely argues or covers
2. 2-3 key claims or findings (inferred from the title/context)
3. A relevance score (1-10) for academic writing

Respond with JSON only:
{"summary": "<1-2 sentences>", "keyClaims": ["<claim 1>", "<claim 2>"], "relevanceScore": <1-10>}`;

    const { text } = await generateText({
      model,
      system,
      prompt: user,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });

    const stripped = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    try {
      const o = JSON.parse(stripped);
      if (typeof o.summary === "string" && o.summary.trim()) {
        const claims = Array.isArray(o.keyClaims)
          ? o.keyClaims.filter((c: unknown) => typeof c === "string")
          : [];
        const score = typeof o.relevanceScore === "number"
          ? Math.max(1, Math.min(10, Math.round(o.relevanceScore)))
          : 5;
        return {
          summary: o.summary.trim(),
          keyClaims: claims,
          relevanceScore: score,
          provider: resolved.provider.type,
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  } catch (err) {
    console.warn("[twyne:ai-client] source summarize failed:", err);
    return null;
  }
}

/* ── Public: detect missing citations in a draft ────────────────── */

export interface MissingSourceRequest {
  draftText: string;
  existingSources: string[]; // titles of already-cited sources
}

export interface MissingSourceResult {
  claims: Array<{
    claim: string;
    reason: string;
    suggestedQuery: string;
  }>;
  provider: string;
}

export async function runClientMissingSourceDetect(
  req: MissingSourceRequest,
  settings: AiSettings,
): Promise<MissingSourceResult | null> {
  const resolved = resolveFeatureConfig(settings, "source-detect-missing");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = `You are a scholarly fact-checker reading a draft. Your job is to identify claims, statistics, or assertions that clearly need a citation or source but don't have one. Be conservative: only flag claims that are specific, factual, or research-backed (not opinions or common knowledge). Respond as JSON only.`;

    const existingBlock = req.existingSources.length
      ? `Already-cited sources (do NOT flag claims that reference these):\n${req.existingSources.map((s) => `- ${s}`).join("\n")}`
      : "No sources have been cited yet.";

    const user = `DETECT MISSING CITATIONS in this draft.

${existingBlock}

Draft:
"""
${req.draftText.slice(0, 3000)}
"""

Identify up to 5 claims that need citations. For each:
1. The exact claim text (quote it)
2. Why it needs a source
3. A suggested search query to find a source

Respond with JSON only:
{"claims": [{"claim": "<quoted claim>", "reason": "<why it needs citation>", "suggestedQuery": "<search query>"}]}`;

    const { text } = await generateText({
      model,
      system,
      prompt: user,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });

    const stripped = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    try {
      const o = JSON.parse(stripped);
      if (Array.isArray(o.claims) && o.claims.length > 0) {
        return {
          claims: o.claims
            .filter((c: unknown) => c && typeof (c as Record<string, unknown>).claim === "string")
            .map((c: Record<string, unknown>) => ({
              claim: String(c.claim).trim(),
              reason: typeof c.reason === "string" ? c.reason.trim() : "Needs verifiable source",
              suggestedQuery: typeof c.suggestedQuery === "string" ? c.suggestedQuery.trim() : String(c.claim).trim(),
            })),
          provider: resolved.provider.type,
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  } catch (err) {
    console.warn("[twyne:ai-client] missing source detect failed:", err);
    return null;
  }
}

/* ── Public: build full settings from partial ───────────────────── */

export function normalizeAiSettings(
  partial: Partial<AiSettings> | null,
): AiSettings {
  const defaults: AiSettings = {
    advancedMode: false,
    providers: [],
    defaultProviderId: null,
    perFeature: {},
    showProviderTags: false,
  };
  if (!partial) return defaults;
  return {
    ...defaults,
    ...partial,
    providers: partial.providers ?? [],
    perFeature: partial.perFeature ?? {},
  };
}
