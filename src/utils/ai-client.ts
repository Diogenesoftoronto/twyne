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
import { buildSystemPrompt, buildUserPrompt } from "../../convex/agentPrompts";
import {
  localAiBaseUrl,
  LOCAL_MODEL_ID,
  LOCAL_PROVIDER_ID,
} from "./desktop-bridge";
import { captureAiGeneration } from "./ai-evals";

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
        const googleProvider = createGoogleGenerativeAI({
          apiKey: config.apiKey,
        });
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
      case "litert": {
        // Desktop-only native model exposed as an OpenAI-compatible server on
        // loopback by the Electrobun shell. No real key; baseUrl is the local
        // endpoint discovered from the desktop bridge.
        const { createOpenAI } = await import("@ai-sdk/openai");
        const openai = createOpenAI({
          apiKey: config.apiKey || "local",
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

async function generateTrackedText({
  feature,
  resolved,
  model,
  system,
  prompt,
  spanName,
  evalSignals,
}: {
  feature: AiFeature;
  resolved: {
    provider: AiProviderConfig;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  model: LanguageModel;
  system?: string;
  prompt: string;
  spanName?: string;
  evalSignals?: Record<string, unknown>;
}): Promise<string> {
  const start = performance.now();
  try {
    const { text } = await generateText({
      model,
      system,
      prompt,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
    });
    await captureAiGeneration({
      feature,
      provider: resolved.provider.type,
      model: resolved.model,
      system,
      prompt,
      output: text,
      latencyMs: performance.now() - start,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      spanName,
      evalSignals,
    });
    return text;
  } catch (err) {
    await captureAiGeneration({
      feature,
      provider: resolved.provider.type,
      model: resolved.model,
      system,
      prompt,
      latencyMs: performance.now() - start,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      spanName,
      error: err,
      evalSignals,
    });
    throw err;
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
          rationale: typeof o.rationale === "string" ? o.rationale.trim() : "",
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  };
  return (
    tryParse(stripped) ?? tryParse(stripped.match(/\{[\s\S]*\}/)?.[0] ?? "")
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

    const text = await generateTrackedText({
      feature: "persona-rewrite",
      resolved,
      model,
      system,
      prompt: user,
      spanName: "persona_rewrite",
      evalSignals: {
        twyne_persona_id: req.persona.id,
        twyne_rewrite_level: req.level,
      },
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

    const text = await generateTrackedText({
      feature,
      resolved,
      model,
      system,
      prompt: user,
      spanName: feature,
      evalSignals: {
        twyne_persona_id: req.persona.id,
        twyne_instruction: req.instruction ?? "feedback",
      },
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
  const rationaleMatch = stripped.match(/"?rationale"?\s*[:=]\s*"([^"]+)"/i);
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

    const text = await generateTrackedText({
      feature: "rubric-judge",
      resolved,
      model,
      system,
      prompt: user,
      spanName: "rubric_judge",
      evalSignals: {
        twyne_persona_id: req.persona.id,
        twyne_expected_format: "json_score_rationale",
      },
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

    const text = await generateTrackedText({
      feature: "citation-format",
      resolved,
      model,
      system,
      prompt: user,
      spanName: "citation_format",
      evalSignals: {
        twyne_citation_style: req.style,
        twyne_expected_format: "json_citation",
      },
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
          author:
            typeof o.author === "string"
              ? o.author.trim() || undefined
              : undefined,
          year:
            typeof o.year === "string" ? o.year.trim() || undefined : undefined,
          url:
            typeof o.url === "string" ? o.url.trim() || undefined : undefined,
          doi:
            typeof o.doi === "string" ? o.doi.trim() || undefined : undefined,
          publisher:
            typeof o.publisher === "string"
              ? o.publisher.trim() || undefined
              : undefined,
          formatted:
            typeof o.formatted === "string"
              ? o.formatted.trim()
              : o.title.trim(),
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

    const text = await generateTrackedText({
      feature: "source-summarize",
      resolved,
      model,
      system,
      prompt: user,
      spanName: "source_summarize",
      evalSignals: {
        twyne_has_source_url: !!req.url,
        twyne_expected_format: "json_source_summary",
      },
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
        const score =
          typeof o.relevanceScore === "number"
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

    const text = await generateTrackedText({
      feature: "source-detect-missing",
      resolved,
      model,
      system,
      prompt: user,
      spanName: "source_detect_missing",
      evalSignals: {
        twyne_existing_sources_count: req.existingSources.length,
        twyne_expected_format: "json_missing_source_claims",
      },
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
            .filter(
              (c: unknown) =>
                c && typeof (c as Record<string, unknown>).claim === "string",
            )
            .map((c: Record<string, unknown>) => ({
              claim: String(c.claim).trim(),
              reason:
                typeof c.reason === "string"
                  ? c.reason.trim()
                  : "Needs verifiable source",
              suggestedQuery:
                typeof c.suggestedQuery === "string"
                  ? c.suggestedQuery.trim()
                  : String(c.claim).trim(),
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
  const base: AiSettings = !partial
    ? defaults
    : {
        ...defaults,
        ...partial,
        providers: partial.providers ?? [],
        perFeature: partial.perFeature ?? {},
      };
  return withDesktopLocalProvider(stripManagedDesktopLocalProvider(base));
}

/** Remove the transient desktop-local provider before persisting settings. */
export function stripManagedDesktopLocalProvider(
  settings: AiSettings,
): AiSettings {
  const providers = settings.providers.filter(
    (p) => p.id !== LOCAL_PROVIDER_ID,
  );
  const defaultProviderId =
    settings.defaultProviderId === LOCAL_PROVIDER_ID
      ? (providers[0]?.id ?? null)
      : settings.defaultProviderId;
  const perFeature = Object.fromEntries(
    Object.entries(settings.perFeature).filter(
      ([, override]) => override?.providerId !== LOCAL_PROVIDER_ID,
    ),
  ) as AiSettings["perFeature"];

  return {
    ...settings,
    providers,
    defaultProviderId,
    perFeature,
  };
}

/**
 * When running inside the Electrobun desktop shell with the local LiteRT model
 * available, inject a managed `litert` provider so every panel can use it
 * without the writer configuring anything. No-op on the web (the bridge
 * reports unavailable), so the local surface stays hidden there.
 */
function withDesktopLocalProvider(settings: AiSettings): AiSettings {
  const baseUrl = localAiBaseUrl();
  if (!baseUrl) return settings;

  const local: AiProviderConfig = {
    id: LOCAL_PROVIDER_ID,
    name: "Local — Gemma 4 E4B",
    type: "litert",
    apiKey: "local",
    baseUrl,
    defaultModel: LOCAL_MODEL_ID,
  };
  const providers = settings.providers.some((p) => p.id === LOCAL_PROVIDER_ID)
    ? settings.providers.map((p) => (p.id === LOCAL_PROVIDER_ID ? local : p))
    : [...settings.providers, local];

  return {
    ...settings,
    advancedMode: true,
    providers,
    // Only claim the default slot if the writer hasn't chosen one.
    defaultProviderId: settings.defaultProviderId ?? LOCAL_PROVIDER_ID,
  };
}

/* ── Conversational interview (BYOK) ────────────────────────────── */

import type { ProjectBrief, ProjectInterviewAnswers } from "../types";

export type InterviewConfidence = "high" | "medium" | "low";

export interface InterviewMessage {
  author: "writer" | "interviewer";
  text: string;
}

export type InterviewMode = "first-run" | "refine";

export interface InterviewTurnRequest {
  messages: InterviewMessage[];
  mode: InterviewMode;
  currentBrief: ProjectBrief | null;
}

/**
 * The synthesis the AI hands back when it has enough information to
 * draft a dossier. `brief` is filled best-effort from the conversation
 * (defaults to the writer's current answer if a field wasn't discussed);
 * `confidence` is per-field so the UI can mark the speculative ones.
 */
export type InterviewTurnResult =
  | { kind: "question"; text: string; provider: string; model: string }
  | {
      kind: "synthesis";
      brief: ProjectInterviewAnswers;
      confidence: Partial<
        Record<keyof ProjectInterviewAnswers, InterviewConfidence>
      >;
      provider: string;
      model: string;
    };

/**
 * Run one conversational-interview turn against the writer's configured
 * provider. Returns null when BYOK is off / no providers — the caller
 * is expected to fall back to the form-based `AntiTabulaRasa`.
 */
export async function runClientInterviewTurn(
  request: InterviewTurnRequest,
  settings: AiSettings,
): Promise<InterviewTurnResult | null> {
  const cfg = resolveFeatureConfig(settings, "interview-turn");
  if (!cfg) return null;
  const model = await createModel(cfg.provider, cfg.model);
  if (!model) return null;
  try {
    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.author === "writer");
    const system = [
      "You are a kind, incisive editorial interviewer helping a writer build a project dossier.",
      "Ask one question at a time. Keep it short. When you have enough to draft the dossier, append a line that begins with `SYNTHESIZE:` followed by a JSON object with the fields { workingTitle, format, audience, goal, tone, constraints, successSignal } and a second JSON object with per-field confidence in { high, medium, low }.",
      request.mode === "refine" && request.currentBrief
        ? `Existing dossier: ${JSON.stringify(request.currentBrief.answers)} — refine it, don't restart.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const transcript = request.messages
      .map((m) => `${m.author === "writer" ? "Writer" : "You"}: ${m.text}`)
      .join("\n");
    const text = await generateTrackedText({
      feature: "interview-turn",
      resolved: cfg,
      model,
      system,
      prompt: transcript,
      spanName: "interview_turn",
      evalSignals: {
        twyne_interview_mode: request.mode,
        twyne_message_count: request.messages.length,
      },
    });
    const synthMatch = text.match(
      /SYNTHESIZE:\s*(\{[\s\S]*?\})\s*(\{[\s\S]*?\})?/,
    );
    if (synthMatch) {
      try {
        const brief = JSON.parse(synthMatch[1]) as ProjectInterviewAnswers;
        const confidence = synthMatch[2]
          ? (JSON.parse(synthMatch[2]) as Partial<
              Record<keyof ProjectInterviewAnswers, InterviewConfidence>
            >)
          : {};
        return {
          kind: "synthesis",
          brief,
          confidence,
          provider: cfg.provider.name,
          model: cfg.model,
        };
      } catch {
        // Malformed synthesis — fall through to a question reply.
      }
    }
    const reply =
      text.trim() ||
      (lastUser ? "Tell me more." : "What is the working title of this piece?");
    return {
      kind: "question",
      text: reply,
      provider: cfg.provider.name,
      model: cfg.model,
    };
  } catch (err) {
    console.warn("[twyne:ai-client] interview turn failed:", err);
    return null;
  }
}

/* ── Dossier check (BYOK) ───────────────────────────────────────── */

/** Reads a draft against the brief, surfaces drift. */
export interface DossierCheckRequest {
  brief: ProjectBrief;
  draftText: string | null;
}

/**
 * Runs the "Read my draft" pass — asks the configured provider to
 * compare the draft against the dossier and report fields that have
 * drifted. Returns null when BYOK is off (caller shows the empty state).
 */
export async function runClientDossierCheck(
  request: DossierCheckRequest,
  settings: AiSettings,
): Promise<{
  observations: Array<{
    field: keyof ProjectInterviewAnswers;
    current: string;
    suggested: string;
    reason: string;
  }>;
  provider: string;
} | null> {
  const cfg = resolveFeatureConfig(settings, "dossier-check");
  if (!cfg) return null;
  const model = await createModel(cfg.provider, cfg.model);
  if (!model) return null;
  try {
    const system = [
      "You read a writer's draft against their project dossier.",
      "Identify fields of the dossier that the draft has outgrown or contradicted.",
      "Respond with a JSON object { observations: [{ field, current, suggested, reason }] }.",
      "Valid fields: workingTitle, format, audience, goal, tone, constraints, successSignal.",
      "If the draft is consistent with the dossier, return { observations: [] }.",
    ].join("\n");
    const user = `Dossier: ${JSON.stringify(request.brief.answers)}\n\nDraft:\n${request.draftText ?? "(no draft yet)"}`;
    const text = await generateTrackedText({
      feature: "dossier-check",
      resolved: cfg,
      model,
      system,
      prompt: user,
      spanName: "dossier_check",
      evalSignals: {
        twyne_expected_format: "json_dossier_observations",
      },
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { observations: [] };
    const observations = Array.isArray(parsed.observations)
      ? parsed.observations
      : [];
    return {
      observations: observations.filter(
        (o: { field?: string }) =>
          typeof o.field === "string" && o.field in DEFAULT_FIELDS,
      ),
      provider: cfg.provider.name,
    };
  } catch (err) {
    console.warn("[twyne:ai-client] dossier check failed:", err);
    return null;
  }
}

const DEFAULT_FIELDS: Record<keyof ProjectInterviewAnswers, true> = {
  workingTitle: true,
  format: true,
  audience: true,
  goal: true,
  tone: true,
  constraints: true,
  successSignal: true,
};
