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

import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";
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
  generateLocalFeedback,
  buildSynthesisSystemPrompt,
  buildSynthesisPrompt,
  buildRubricReviewSystemPrompt,
  buildRubricReviewPrompt,
  type MemoForSynthesis,
} from "../../convex/agentPrompts";
import { buildQuoteTools } from "../../convex/agentTools";
import type { ProjectBrief as ProjectBriefType } from "../types";
import {
  localAiBaseUrl,
  LOCAL_MODEL_ID,
  LOCAL_PROVIDER_ID,
} from "./desktop-bridge";
import { captureAiGeneration } from "./ai-evals";
import { stripReasoningTags } from "./reasoning-tags";
import {
  extractFirstJsonObject,
  extractTaggedJson,
  parseJudgeOutput,
  stripTaggedJson,
} from "./llm-parsing";

/* ── Provider factory ───────────────────────────────────────────── */

function isOpenAiCompatibleProvider(type: AiProviderConfig["type"]): boolean {
  return (
    type === "openai-compatible" ||
    type === "deepseek" ||
    type === "openrouter" ||
    type === "ollama" ||
    type === "zai" ||
    type === "minimax"
  );
}

async function createModel(
  config: AiProviderConfig,
  modelOverride?: string,
): Promise<LanguageModel | null> {
  try {
    const modelId =
      modelOverride || config.defaultModel || config.availableModels?.[0] || "";
    if (!modelId) return null;
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
      case "anthropic-compatible": {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        const anthropicProvider = createAnthropic({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
        });
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
      case "deepseek":
      case "openrouter":
      case "ollama":
      case "zai":
      case "minimax": {
        const { createOpenAI } = await import("@ai-sdk/openai");
        const openai = createOpenAI({
          apiKey: config.apiKey || "local",
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
  const normalized = normalizeAiSettings(settings);
  if (normalized.providers.length === 0) {
    return null;
  }

  const override: AiFeatureOverride | undefined =
    normalized.perFeature[feature];
  const providerId =
    override?.providerId ??
    normalized.defaultProviderId ??
    normalized.providers[0]?.id;
  if (!providerId) return null;

  const provider = normalized.providers.find((p) => p.id === providerId);
  if (!provider) return null;

  return {
    provider,
    model: override?.model ?? defaultModelForFeature(feature, provider),
    temperature: override?.temperature ?? defaultTemperature(feature),
    maxTokens: override?.maxTokens ?? defaultMaxTokens(feature),
  };
}

/**
 * Like {@link resolveFeatureConfig}, but lets a persona override the provider,
 * model, and temperature. This is what lets each editor run on its own model
 * so the voices differ at the generation level, not just in the prompt.
 * BYOK/client path only — the Convex hosted path uses one picked provider.
 */
export function resolveFeatureConfigForPersona(
  settings: AiSettings,
  feature: AiFeature,
  persona: { providerId?: string; model?: string; temperature?: number },
): ReturnType<typeof resolveFeatureConfig> {
  const base = resolveFeatureConfig(settings, feature);
  if (!base) return null;

  const normalized = normalizeAiSettings(settings);
  const personaProvider = persona.providerId
    ? normalized.providers.find((p) => p.id === persona.providerId)
    : undefined;
  const provider = personaProvider ?? base.provider;

  return {
    provider,
    model:
      persona.model ?? (personaProvider ? provider.defaultModel : base.model),
    temperature: persona.temperature ?? base.temperature,
    maxTokens: base.maxTokens,
  };
}

export function hasConfiguredAiProvider(
  settings: Partial<AiSettings> | AiSettings | null | undefined,
): boolean {
  if (!settings) return false;
  return normalizeAiSettings(settings).providers.length > 0;
}

function defaultModelForFeature(
  feature: AiFeature,
  provider: AiProviderConfig,
): string {
  if (
    feature === "voice-narration" &&
    (provider.type === "openai" || isOpenAiCompatibleProvider(provider.type))
  ) {
    return "gpt-4o-mini-tts";
  }
  return provider.defaultModel;
}

function defaultTemperature(feature: AiFeature): number {
  switch (feature) {
    case "rubric-judge":
      return 0.2;
    case "rubric-review":
      return 0.3;
    case "persona-analysis":
      return 0.5;
    case "room-synthesis":
      return 0.4;
    case "voice-narration":
      return 0.4;
    case "citation-format":
      return 0.1;
    case "source-summarize":
      return 0.3;
    case "source-detect-missing":
      return 0.2;
    case "research-web-search":
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
    case "persona-analysis":
      return 1400;
    case "room-synthesis":
      return 1200;
    case "rubric-judge":
      return 220;
    case "rubric-review":
      return 1200;
    case "voice-narration":
      return 0;
    case "comment-reply":
      return 280;
    case "citation-format":
      return 180;
    case "source-summarize":
      return 200;
    case "source-detect-missing":
      return 350;
    case "research-web-search":
      return 900;
    default:
      return 300;
  }
}

/* ── Public: generate speech client-side (BYOK) ─────────────────── */

export interface VoiceSpeechRequest {
  text: string;
  voice?: string;
  instructions?: string;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
}

export interface VoiceSpeechResult {
  audio: Blob;
  provider: string;
  model: string;
  voice: string;
  responseFormat: string;
}

export async function runClientVoiceSpeech(
  req: VoiceSpeechRequest,
  settings: AiSettings,
): Promise<VoiceSpeechResult | null> {
  const resolved = resolveFeatureConfig(settings, "voice-narration");
  if (!resolved) return null;
  if (
    resolved.provider.type !== "openai" &&
    !isOpenAiCompatibleProvider(resolved.provider.type)
  ) {
    console.warn(
      "[twyne:ai-client] voice narration requires an OpenAI or OpenAI-compatible provider.",
    );
    return null;
  }

  const input = req.text.trim().slice(0, 4096);
  if (!input) return null;

  const override = settings.perFeature["voice-narration"];
  const voice = req.voice ?? override?.voice ?? "alloy";
  const responseFormat =
    req.responseFormat ?? override?.responseFormat ?? "mp3";
  const speed = req.speed ?? override?.speed;
  const instructions = req.instructions ?? override?.instructions;
  const baseURL =
    isOpenAiCompatibleProvider(resolved.provider.type) &&
    resolved.provider.baseUrl
      ? resolved.provider.baseUrl.replace(/\/$/, "")
      : "https://api.openai.com/v1";

  try {
    const res = await fetch(`${baseURL}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resolved.provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: resolved.model,
        input,
        voice,
        response_format: responseFormat,
        ...(instructions ? { instructions } : {}),
        ...(speed ? { speed } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Voice generation failed (${res.status}): ${detail.slice(0, 240)}`,
      );
    }
    const audio = new Blob([await res.arrayBuffer()], {
      type: audioMimeType(responseFormat),
    });
    return {
      audio,
      provider: resolved.provider.type,
      model: resolved.model,
      voice,
      responseFormat,
    };
  } catch (err) {
    console.warn("[twyne:ai-client] voice narration failed:", err);
    return null;
  }
}

function audioMimeType(format: string): string {
  switch (format) {
    case "opus":
      return "audio/opus";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
    case "mp3":
    default:
      return "audio/mpeg";
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
  tools,
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
  /** Tools the model may call (e.g. quote_passage). */
  tools?: ToolSet;
}): Promise<string> {
  const start = performance.now();
  // When tools are present the model needs at least one extra step after the
  // tool result to write its visible answer.
  const stopWhen = tools ? stepCountIs(3) : undefined;
  try {
    const { text } = await generateText({
      model,
      system,
      prompt,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
      ...(tools ? { tools, stopWhen } : {}),
    });
    let cleaned = stripReasoningTags(text);
    // Reasoning models sometimes wrap the whole reply in <think> (or never
    // close the tag), so stripping leaves nothing. Regenerate once, nudging
    // the model to answer outside the reasoning channel; if it still comes
    // back empty, fall back to the raw text so the note is never blank.
    if (!cleaned) {
      const retryPrompt = `${prompt}\n\nRespond with your note as plain visible text. Do not place your whole answer inside <think> tags.`;
      const retry = await generateText({
        model,
        system,
        prompt: retryPrompt,
        temperature: resolved.temperature,
        maxOutputTokens: resolved.maxTokens,
        ...(tools ? { tools, stopWhen } : {}),
      });
      cleaned = stripReasoningTags(retry.text) || retry.text.trim();
    }
    await captureAiGeneration({
      feature,
      provider: resolved.provider.type,
      model: resolved.model,
      system,
      prompt,
      output: cleaned,
      latencyMs: performance.now() - start,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      spanName,
      evalSignals,
    });
    return cleaned;
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
  const stripped = stripReasoningTags(text)
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
  const resolved = resolveFeatureConfigForPersona(
    settings,
    feature,
    req.persona,
  );
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = buildSystemPrompt(req.persona);
    const user = buildUserPrompt(req);
    const fallbackType = defaultTypeForPersona(req.persona.id);
    const { tools, getAnchor } = buildQuoteTools(req.draftText);

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
      tools,
    });

    const cleaned = text.trim();
    const anchor = getAnchor();
    // No usable text and no anchored quote — hand off to the deterministic
    // local generator, which carries its own anchor.
    if (!cleaned) {
      return generateLocalFeedback(req);
    }
    return {
      text: cleaned,
      type: classifyType(cleaned, fallbackType),
      provider: resolved.provider.type as AgentResponse["provider"],
      anchor,
    };
  } catch (err) {
    console.warn("[twyne:ai-client] generateText failed:", err);
    return null;
  }
}

/* ── Public: room synthesis (combine the five memos) ────────────── */

export async function runClientRoomSynthesis(
  memos: MemoForSynthesis[],
  brief: ProjectBriefType | null,
  settings: AiSettings,
): Promise<{ text: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "room-synthesis");
  if (!resolved) return null;
  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;
  try {
    const text = await generateTrackedText({
      feature: "room-synthesis",
      resolved,
      model,
      system: buildSynthesisSystemPrompt(),
      prompt: buildSynthesisPrompt(memos, brief),
      spanName: "room_synthesis",
      evalSignals: { twyne_memo_count: memos.length },
    });
    const cleaned = text.trim();
    return cleaned ? { text: cleaned, provider: resolved.provider.type } : null;
  } catch (err) {
    console.warn("[twyne:ai-client] room synthesis failed:", err);
    return null;
  }
}

/* ── Public: full narrative rubric review ───────────────────────── */

export interface RubricReviewRequest {
  combined: number;
  grade: string;
  judgeMean: number;
  staticTotal: number;
  judges: Array<{ personaId: string; score: number; rationale: string }>;
  staticFeedback: string[];
  brief: ProjectBriefType | null;
  draftText: string;
}

export async function runClientRubricReview(
  req: RubricReviewRequest,
  settings: AiSettings,
): Promise<{ text: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "rubric-review");
  if (!resolved) return null;
  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;
  try {
    const text = await generateTrackedText({
      feature: "rubric-review",
      resolved,
      model,
      system: buildRubricReviewSystemPrompt(),
      prompt: buildRubricReviewPrompt(req),
      spanName: "rubric_review",
      evalSignals: { twyne_combined_score: req.combined },
    });
    const cleaned = text.trim();
    return cleaned ? { text: cleaned, provider: resolved.provider.type } : null;
  } catch (err) {
    console.warn("[twyne:ai-client] rubric review failed:", err);
    return null;
  }
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

Do not reward confident-sounding bullshit. Penalize generic filler, repeated paragraphs, unsupported universal claims, vibes without evidence, fake specificity, and any passage that sounds polished while dodging the stated audience/goal.

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

export interface ProviderModelDiscoveryResult {
  models: string[];
  source: "remote" | "fallback";
}

function normalizeApiBaseUrl(
  baseUrl: string | undefined,
  fallback: string,
): string {
  const raw = baseUrl?.trim() || fallback;
  return raw.replace(/\/+$/, "");
}

function dedupeModels(models: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      models.map((m) => m?.trim()).filter((m): m is string => Boolean(m)),
    ),
  );
}

function fallbackModelsForProvider(config: AiProviderConfig): string[] {
  return dedupeModels([config.defaultModel, ...(config.availableModels ?? [])]);
}

export async function discoverProviderModels(
  config: AiProviderConfig,
): Promise<ProviderModelDiscoveryResult> {
  const fallback = fallbackModelsForProvider(config);

  try {
    if (config.type === "google") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.apiKey)}`,
      );
      if (!res.ok) {
        throw new Error(`Model discovery failed (${res.status})`);
      }
      const body = (await res.json()) as {
        models?: Array<{ name?: string; displayName?: string }>;
      };
      const models = dedupeModels(
        (body.models ?? []).flatMap((m) => [
          m.name?.replace(/^models\//, ""),
          m.displayName,
        ]),
      );
      return {
        models: models.length > 0 ? models : fallback,
        source: models.length > 0 ? "remote" : "fallback",
      };
    }

    const isAnthropicStyle =
      config.type === "anthropic" || config.type === "anthropic-compatible";
    const baseUrl = normalizeApiBaseUrl(
      config.baseUrl,
      isAnthropicStyle
        ? "https://api.anthropic.com/v1"
        : "https://api.openai.com/v1",
    );
    const headers: Record<string, string> = isAnthropicStyle
      ? {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        }
      : config.apiKey && config.type !== "ollama"
        ? {
            authorization: `Bearer ${config.apiKey}`,
          }
        : {};

    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) {
      throw new Error(`Model discovery failed (${res.status})`);
    }

    const body = (await res.json()) as {
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ id?: string; name?: string; displayName?: string }>;
    };

    const models = dedupeModels([
      ...(body.data ?? []).flatMap((m) => [m.id, m.name]),
      ...(body.models ?? []).flatMap((m) => [m.id, m.name, m.displayName]),
    ]);

    return {
      models: models.length > 0 ? models : fallback,
      source: models.length > 0 ? "remote" : "fallback",
    };
  } catch (err) {
    const message = (err as Error)?.message ?? "Model discovery failed";
    if (fallback.length > 0) {
      return { models: fallback, source: "fallback" };
    }
    throw new Error(message);
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

    const stripped = stripReasoningTags(text)
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

    const stripped = stripReasoningTags(text)
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

    const stripped = stripReasoningTags(text)
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

export interface ClientResearchSource {
  title: string;
  url: string;
  snippet: string;
  author?: string;
  publisher?: string;
  date?: string;
  why?: string;
}

export async function runClientResearchWebSearch(
  req: {
    query: string;
    context?: string;
    maxResults: number;
    instructions?: string;
  },
  settings: AiSettings,
): Promise<{ results: ClientResearchSource[]; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "research-web-search");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  try {
    const system = [
      "You are Twyne's bibliography research assistant.",
      "Use the model endpoint's web-search capability if it is available. Return only sources you can ground in real web results.",
      "Respond as JSON only.",
      req.instructions?.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const prompt = `Find up to ${req.maxResults} credible sources for this writing project.

Query:
${req.query}

Context:
${req.context?.trim() || "(none)"}

Return JSON in this exact shape:
{"results":[{"title":"...","url":"https://...","snippet":"1-2 sentence relevance summary","author":"optional","publisher":"optional","date":"optional","why":"why this source helps the draft"}]}`;

    const text = await generateTrackedText({
      feature: "research-web-search",
      resolved,
      model,
      system,
      prompt,
      spanName: "research_web_search",
      evalSignals: { twyne_expected_format: "json_research_sources" },
    });
    const candidate = extractFirstJsonObject(stripReasoningTags(text));
    if (!candidate) return null;
    const parsed = JSON.parse(candidate) as { results?: unknown };
    const results = normalizeResearchSources(parsed.results, req.maxResults);
    return results.length
      ? { results, provider: `${resolved.provider.type}:web-search` }
      : null;
  } catch (err) {
    console.warn("[twyne:ai-client] research web search failed:", err);
    return null;
  }
}

function normalizeResearchSources(
  value: unknown,
  maxResults: number,
): ClientResearchSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      const url = typeof rec.url === "string" ? rec.url.trim() : "";
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      if (!url || !/^https?:\/\//i.test(url)) return null;
      const source: ClientResearchSource = {
        title: title || url,
        url,
        snippet:
          typeof rec.snippet === "string" && rec.snippet.trim()
            ? rec.snippet.trim()
            : "Source returned by the configured web-search model endpoint.",
      };
      if (typeof rec.author === "string" && rec.author.trim()) {
        source.author = rec.author.trim();
      }
      if (typeof rec.publisher === "string" && rec.publisher.trim()) {
        source.publisher = rec.publisher.trim();
      }
      if (typeof rec.date === "string" && rec.date.trim()) {
        source.date = rec.date.trim();
      }
      if (typeof rec.why === "string" && rec.why.trim()) {
        source.why = rec.why.trim();
      }
      return source;
    })
    .filter((source): source is ClientResearchSource => source !== null)
    .slice(0, maxResults);
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
    availableModels: [LOCAL_MODEL_ID],
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

export interface InterviewDossierDraft {
  brief: Partial<ProjectInterviewAnswers>;
  confidence: Partial<
    Record<keyof ProjectInterviewAnswers, InterviewConfidence>
  >;
}

/**
 * The synthesis the AI hands back when it has enough information to
 * draft a dossier. `brief` is filled best-effort from the conversation
 * (defaults to the writer's current answer if a field wasn't discussed);
 * `confidence` is per-field so the UI can mark the speculative ones.
 */
export type InterviewTurnResult =
  | {
      kind: "question";
      text: string;
      draft?: InterviewDossierDraft;
      provider: string;
      model: string;
    }
  | {
      kind: "synthesis";
      brief: ProjectInterviewAnswers;
      confidence: Partial<
        Record<keyof ProjectInterviewAnswers, InterviewConfidence>
      >;
      provider: string;
      model: string;
    };

const INTERVIEW_FIELDS = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
] as const satisfies ReadonlyArray<keyof ProjectInterviewAnswers>;

function normalizeInterviewDossierDraft(
  value: unknown,
): InterviewDossierDraft | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const briefSource =
    obj.brief && typeof obj.brief === "object"
      ? (obj.brief as Record<string, unknown>)
      : obj;
  const confidenceSource =
    obj.confidence && typeof obj.confidence === "object"
      ? (obj.confidence as Record<string, unknown>)
      : {};

  const brief: Partial<ProjectInterviewAnswers> = {};
  const confidence: Partial<
    Record<keyof ProjectInterviewAnswers, InterviewConfidence>
  > = {};
  for (const field of INTERVIEW_FIELDS) {
    const raw = briefSource[field];
    if (typeof raw === "string" && raw.trim()) {
      brief[field] = raw.trim();
    }
    const c = confidenceSource[field];
    if (c === "high" || c === "medium" || c === "low") {
      confidence[field] = c;
    }
  }
  return Object.keys(brief).length > 0 ? { brief, confidence } : null;
}

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
      "Ask one question at a time. Keep it short. You are building a writer's room: identify the piece, reader, goal, tone, constraints, success signal, and what kind of advisors/editors the writer wants around it.",
      'After every ordinary question, append `DOSSIER:` followed by JSON { "brief": { workingTitle, format, audience, goal, tone, constraints, successSignal }, "confidence": { field: "high" | "medium" | "low" } }. Only include fields you can reasonably infer.',
      "When the dossier is complete enough for review, respond only with `SYNTHESIZE:` followed by the same JSON shape. Put requested advisors/editors into constraints or goal until the product has a dedicated advisor schema.",
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
    const synthSegment = extractTaggedJson(text, "SYNTHESIZE");
    if (synthSegment) {
      const draft = normalizeInterviewDossierDraft(synthSegment.value);
      if (draft) {
        return {
          kind: "synthesis",
          brief: draft.brief as ProjectInterviewAnswers,
          confidence: draft.confidence,
          provider: cfg.provider.name,
          model: cfg.model,
        };
      }
    }

    // Backward compatibility for the previous two-object SYNTHESIZE format.
    const legacySynthMatch = text.match(
      /SYNTHESIZE:\s*(\{[\s\S]*?\})\s*(\{[\s\S]*?\})?/,
    );
    if (legacySynthMatch) {
      try {
        return {
          kind: "synthesis",
          brief: JSON.parse(legacySynthMatch[1]) as ProjectInterviewAnswers,
          confidence: legacySynthMatch[2]
            ? (JSON.parse(legacySynthMatch[2]) as Partial<
                Record<keyof ProjectInterviewAnswers, InterviewConfidence>
              >)
            : {},
          provider: cfg.provider.name,
          model: cfg.model,
        };
      } catch {
        // Malformed synthesis — fall through to a question reply.
      }
    }

    const dossierSegment = extractTaggedJson(text, "DOSSIER");
    const draft = dossierSegment
      ? normalizeInterviewDossierDraft(dossierSegment.value)
      : null;
    const reply =
      (dossierSegment ? stripTaggedJson(text, dossierSegment) : text).trim() ||
      (lastUser ? "Tell me more." : "What is the working title of this piece?");
    return {
      kind: "question",
      text: reply,
      draft: draft ?? undefined,
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
