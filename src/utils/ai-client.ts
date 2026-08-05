/**
 * Client-side AI engine for BYOK (Bring Your Own Key).
 *
 * This module runs AI calls from the browser using the Vercel AI SDK and the
 * provider packages bundled with the app. Provider API keys are read from the
 * caller's `AiSettings` object (stored in IndexedDB only). Providers receive
 * them directly except when a provider does not support browser CORS; Tinker
 * calls use Twyne's fixed same-origin relay and the key is never persisted
 * server-side.
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
  streamText,
  type LanguageModel,
  type ToolSet,
} from "ai";
import decodeAudio from "audio-decode";
import { encode as encodeWav } from "wav-encoder";
import type {
  AiSettings,
  AiFeature,
  AiProviderConfig,
  AiFeatureOverride,
  ResearchTarget,
} from "../types";
import { VOICE_ONLY_PROVIDER_TYPES } from "../types";
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
  buildEvidenceJudgeSystemPrompt,
  buildEvidenceJudgePrompt,
  buildIntegrityJudgeSystemPrompt,
  buildIntegrityJudgePrompt,
  buildTargetFitJudgeSystemPrompt,
  buildTargetFitJudgePrompt,
  targetFitCommission,
  probeParticularsBlock,
  buildCustomCriterionSystemPrompt,
  buildCustomCriterionPrompt,
  type MemoForSynthesis,
} from "../../convex/agentPrompts";
import { buildQuoteTools } from "../../convex/agentTools";
import type { DossierProbe, ProjectBrief as ProjectBriefType } from "../types";
import { normalizeProbe } from "./dossier-probes";
import {
  localAiBaseUrl,
  LOCAL_MODEL_ID,
  LOCAL_PROVIDER_ID,
} from "./desktop-bridge";
import { captureAiGeneration } from "./ai-evals";
import {
  createAiTraceId,
  normalizeAiUsage,
  type AiUsage,
} from "./ai-deterministic-evals";
import {
  createVisibleTextFilter,
  hasReasoningTags,
  removeReasoningTagMarkers,
  stripReasoningTags,
} from "./reasoning-tags";
import {
  extractFirstJsonObject,
  extractTaggedJson,
  parseJudgeOutput,
  stripTaggedJson,
} from "./llm-parsing";
import {
  DEFAULT_TARGETS_PER_PASS,
  buildResearchExtractSystemPrompt,
  buildResearchExtractUserPrompt,
  parseResearchTargets,
} from "./research-targets";
import {
  createInterviewStreamSnapshot,
  type InterviewStreamSnapshot,
} from "./interview-stream";
import {
  createAppError,
  failureResult,
  successResult,
} from "./application-errors";
import type { ApplicationResult } from "../types/application-errors";
import { reportApplicationDiagnostic } from "./application-diagnostics";

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

const TINKER_HOST = "tinker.thinkingmachines.dev";

export function isTinkerProviderConfig(
  config: Pick<AiProviderConfig, "baseUrl">,
): boolean {
  if (!config.baseUrl) return false;
  try {
    return new URL(config.baseUrl).hostname.toLowerCase() === TINKER_HOST;
  } catch {
    return false;
  }
}

function tinkerRelayBaseUrl(): string {
  const origin =
    typeof globalThis.location !== "undefined"
      ? globalThis.location.origin
      : "http://localhost";
  return `${origin}/api/tinker`;
}

/** Speaks and listens, but has no language model behind it. */
export function isVoiceOnlyProvider(type: AiProviderConfig["type"]): boolean {
  return VOICE_ONLY_PROVIDER_TYPES.includes(type);
}

/** Features that want a voice, not a mind. */
const VOICE_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>([
  "voice-narration",
  "voice-transcription",
]);

/** Can this provider serve the requested speech feature? */
function supportsVoiceFeature(
  type: AiProviderConfig["type"],
  feature: "voice-narration" | "voice-transcription",
  provider?: AiProviderConfig,
): boolean {
  if (feature === "voice-narration") {
    return (
      type === "openai" ||
      isOpenAiCompatibleProvider(type) ||
      isVoiceOnlyProvider(type)
    );
  }
  // Audio-capable language models can transcribe by reading the recording as
  // a file. Google and local/OpenAI-compatible multimodal models use that
  // path; Anthropic-compatible endpoints are intentionally excluded because
  // the Messages API does not define an audio content block.
  return (
    type === "openai" ||
    isOpenAiCompatibleProvider(type) ||
    (provider ? isTinkerProviderConfig(provider) : false) ||
    type === "google" ||
    type === "litert" ||
    isVoiceOnlyProvider(type)
  );
}

/** Can a provider type serve this feature's modality? */
export function providerSupportsFeature(
  type: AiProviderConfig["type"],
  feature: AiFeature,
  provider?: AiProviderConfig,
): boolean {
  return VOICE_FEATURES.has(feature)
    ? supportsVoiceFeature(
        type,
        feature as "voice-narration" | "voice-transcription",
        provider,
      )
    : !isVoiceOnlyProvider(type);
}

async function createModel(
  config: AiProviderConfig,
  modelOverride?: string,
): Promise<LanguageModel | null> {
  try {
    const modelId =
      modelOverride || config.defaultModel || config.availableModels?.[0] || "";
    if (!modelId) return null;
    if (isTinkerProviderConfig(config)) {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const tinker = createOpenAI({
        apiKey: config.apiKey,
        baseURL: tinkerRelayBaseUrl(),
      });
      return tinker.chat(modelId);
    }
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
      case "fishaudio":
        // Voice only — there is no language model to build. Callers fall back
        // to the server path, which is the correct behaviour.
        return null;
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
    reportApplicationDiagnostic("twyne:ai-client:create-model", err);
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

  // A voice-only provider can serve the voice features and nothing else; an
  // LLM provider that can't speak is no use for narration. Narrow the pool
  // before picking, so a writer with (say) Anthropic for the room and Fish
  // Audio for the voices gets the right one for each without configuring
  // per-feature overrides by hand.
  const eligible = normalized.providers.filter((p) =>
    providerSupportsFeature(p.type, feature, p),
  );
  if (eligible.length === 0) return null;

  const override: AiFeatureOverride | undefined =
    normalized.perFeature[feature];
  // An explicit per-feature override wins, but only if it names a provider
  // that can actually do the job.
  const overridden = override?.providerId
    ? eligible.find((p) => p.id === override.providerId)
    : undefined;
  const preferred =
    overridden ??
    eligible.find((p) => p.id === normalized.defaultProviderId) ??
    eligible[0];
  if (!preferred) return null;
  const provider = preferred;

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

/**
 * Is there a client-side provider that can do *language* work?
 *
 * Voice-only providers are excluded deliberately. Callers use this to decide
 * whether to take the BYOK path at all, and several of them treat a BYOK
 * attempt that yields nothing as a hard error rather than falling back to the
 * server — so counting a Fish Audio key here would break the Cast panel for
 * anyone who configured voice but not an LLM.
 */
export function hasConfiguredAiProvider(
  settings: Partial<AiSettings> | AiSettings | null | undefined,
): boolean {
  if (!settings) return false;
  return normalizeAiSettings(settings).providers.some(
    (p) => !isVoiceOnlyProvider(p.type),
  );
}

/** Is there a client-side provider that can speak or listen? */
export function hasConfiguredVoiceProvider(
  settings: Partial<AiSettings> | AiSettings | null | undefined,
): boolean {
  if (!settings) return false;
  return normalizeAiSettings(settings).providers.some(
    (p) =>
      supportsVoiceFeature(p.type, "voice-narration", p) ||
      supportsVoiceFeature(p.type, "voice-transcription", p),
  );
}

/**
 * Whether the selected model should receive the recording itself rather than
 * being sent to a dedicated `/audio/transcriptions` endpoint.
 *
 * models.dev metadata is authoritative when present. The name fallback keeps
 * manually entered models such as Inkling and Gemma useful until their
 * provider catalog has been loaded.
 */
export function modelAcceptsDirectAudio(
  provider: AiProviderConfig,
  model: string,
): boolean {
  const modalities = provider.modelModalities?.[model];
  if (modalities) {
    return (
      modalities.input.includes("audio") && modalities.output.includes("text")
    );
  }
  if (provider.type === "google" || provider.type === "litert") return true;
  const id = model.toLowerCase();
  return /(?:inkling|gemma|gemini|audio|omni)/i.test(id);
}

function defaultModelForFeature(
  feature: AiFeature,
  provider: AiProviderConfig,
): string {
  if (
    feature === "voice-transcription" &&
    modelAcceptsDirectAudio(provider, provider.defaultModel)
  ) {
    return provider.defaultModel;
  }
  if (
    feature === "voice-narration" &&
    (provider.type === "openai" || isOpenAiCompatibleProvider(provider.type))
  ) {
    return "gpt-4o-mini-tts";
  }
  if (
    feature === "voice-transcription" &&
    (provider.type === "openai" || isOpenAiCompatibleProvider(provider.type))
  ) {
    return "gpt-4o-mini-transcribe";
  }
  if (provider.type === "fishaudio") {
    // Fish's v1 TTS contract documents s2-pro and s1. Keep the default on a
    // documented model rather than the retired s2.1-pro-free id.
    return feature === "voice-transcription" ? "asr-1" : "s2-pro";
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
    case "voice-transcription":
      return 0.4;
    case "citation-format":
      return 0.1;
    case "source-summarize":
      return 0.3;
    case "source-detect-missing":
      return 0.2;
    case "research-web-search":
    case "research-extract":
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
    case "voice-transcription":
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
    case "research-extract":
      return 1600;
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
    !supportsVoiceFeature(
      resolved.provider.type,
      "voice-narration",
      resolved.provider,
    )
  ) {
    reportApplicationDiagnostic(
      "twyne:ai-client:voice-unsupported-provider",
      createAppError("CONFIGURATION_ERROR", { source: "provider" }),
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

  if (resolved.provider.type === "fishaudio") {
    return runFishAudioSpeech({
      provider: resolved.provider,
      model: resolved.model,
      text: input,
      voice,
      responseFormat,
      speed,
    });
  }

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
    reportApplicationDiagnostic("twyne:ai-client:voice", err);
    throw err;
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

/**
 * Called as an answer arrives, with the visible text *so far* — not the delta.
 *
 * A cumulative string rather than a diff because every consumer is rendering
 * a paragraph, not appending to a terminal: it makes the reasoning filter
 * below possible (a `<think>` that opens mid-answer retracts the text it was
 * about to show), it makes a discarded-and-regenerated answer a simple reset
 * to `""`, and it makes a dropped or out-of-order call harmless.
 */
export type StreamText = (visibleSoFar: string) => void;

/**
 * One attempt at an answer, streamed when someone is listening.
 *
 * The reasoning filter runs over the accumulated raw text on every chunk
 * rather than over the chunk itself. Tags arrive split across chunk
 * boundaries, and an unclosed `<think>` has to hide everything after it —
 * neither is knowable from a delta alone. Re-stripping a note-sized string a
 * few dozen times costs nothing next to the network call producing it.
 */
async function runOnce({
  model,
  system,
  prompt,
  temperature,
  maxOutputTokens,
  tools,
  stopWhen,
  onText,
}: {
  model: LanguageModel;
  system?: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  tools?: ToolSet;
  stopWhen?: ReturnType<typeof stepCountIs>;
  onText?: StreamText;
}): Promise<{ text: string; usage?: AiUsage }> {
  if (!onText) {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature,
      maxOutputTokens,
      ...(tools ? { tools, stopWhen } : {}),
    });
    return { text: result.text, usage: normalizeAiUsage(result.totalUsage) };
  }

  const result = streamText({
    model,
    system,
    prompt,
    temperature,
    maxOutputTokens,
    ...(tools ? { tools, stopWhen } : {}),
  });

  const visibleText = createVisibleTextFilter();
  for await (const delta of result.textStream) {
    const visible = visibleText(delta);
    if (visible !== null) onText(visible);
  }

  return {
    text: await result.text,
    usage: normalizeAiUsage(await result.totalUsage),
  };
}

async function generateTrackedText({
  feature,
  resolved,
  model,
  system,
  prompt,
  spanName,
  traceId,
  evalSignals,
  tools,
  onText,
  onTrace,
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
  /** Stream the answer as it arrives. See {@link StreamText}. */
  onText?: StreamText;
  onTrace?: (traceId: string) => void;
  /** Reuse a caller-owned trace when a streaming branch needs manual capture. */
  traceId?: string;
}): Promise<string> {
  const start = performance.now();
  const generationTraceId = traceId ?? createAiTraceId(feature);
  onTrace?.(generationTraceId);
  // When tools are present the model needs at least one extra step after the
  // tool result to write its visible answer.
  const stopWhen = tools ? stepCountIs(3) : undefined;
  const run = (userPrompt: string) =>
    runOnce({
      model,
      system,
      prompt: userPrompt,
      temperature: resolved.temperature,
      maxOutputTokens: resolved.maxTokens,
      tools,
      stopWhen,
      onText,
    });
  try {
    const first = await run(prompt);
    const text = first.text;
    let usage = first.usage;
    let cleaned = stripReasoningTags(text);
    // Any reply that reached for the reasoning channel is thrown away and
    // asked again — not just one that strips to nothing. A model that thinks
    // out loud mid-note leaves prose with the seams showing, and stripping
    // only hides the tags, not the damage. Regenerate once with a nudge to
    // answer outside the channel; if that comes back empty too, keep the
    // best text we have so the card is never blank.
    if (!cleaned || hasReasoningTags(text)) {
      const retryPrompt = `${prompt}\n\nRespond with your note as plain visible text. Do not place your whole answer inside <think> tags.`;
      // The discarded attempt may already have painted the screen. Blank it
      // before the second one starts writing, so the reader sees a note begin
      // again rather than two answers spliced together.
      onText?.("");
      const retry = await run(retryPrompt);
      usage = retry.usage ?? usage;
      const retryCleaned = stripReasoningTags(retry.text);
      cleaned =
        (!hasReasoningTags(retry.text) && retryCleaned) ||
        cleaned ||
        retryCleaned ||
        removeReasoningTagMarkers(retry.text);
    }
    // Streaming is best-effort progress, but the last callback is a contract:
    // it must exactly match the text the caller is about to file.
    onText?.(cleaned);
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
      traceId: generationTraceId,
      usage,
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
      traceId: generationTraceId,
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
  writerProfile?: AgentRequest["writerProfile"];
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
      writerProfile: req.writerProfile,
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
    reportApplicationDiagnostic("twyne:ai-client:rewrite", err);
    return null;
  }
}

/* ── Public: run an agent client-side ───────────────────────────── */

export async function runClientAgent(
  feature: AiFeature,
  req: AgentRequest,
  settings: AiSettings,
  onText?: StreamText,
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
    let traceId: string | undefined;

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
      onText,
      onTrace: (nextTraceId) => {
        traceId = nextTraceId;
      },
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
      traceId,
      anchor,
    };
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:generate", err);
    return null;
  }
}

/* ── Public: room synthesis (combine the five memos) ────────────── */

export async function runClientRoomSynthesis(
  memos: MemoForSynthesis[],
  brief: ProjectBriefType | null,
  settings: AiSettings,
  writerProfile?: AgentRequest["writerProfile"],
  onText?: StreamText,
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
      prompt: buildSynthesisPrompt(memos, brief, writerProfile),
      spanName: "room_synthesis",
      evalSignals: { twyne_memo_count: memos.length },
      onText,
    });
    const cleaned = text.trim();
    return cleaned ? { text: cleaned, provider: resolved.provider.type } : null;
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:room-synthesis", err);
    return null;
  }
}

/* ── Public: full narrative rubric review ───────────────────────── */

export interface RubricReviewRequest {
  combined: number;
  grade: string;
  judgeMean: number;
  minJudge: number;
  staticTotal: number;
  judges: Array<{ personaId: string; score: number; rationale: string }>;
  staticFeedback: string[];
  brief: ProjectBriefType | null;
  draftText: string;
}

export async function runClientRubricReview(
  req: RubricReviewRequest,
  settings: AiSettings,
  onText?: StreamText,
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
      onText,
      evalSignals: { twyne_combined_score: req.combined },
    });
    const cleaned = text.trim();
    return cleaned ? { text: cleaned, provider: resolved.provider.type } : null;
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:rubric-review", err);
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
    reportApplicationDiagnostic("twyne:ai-client:judge", err);
    return null;
  }
}

/** Fish Audio's API root. Not configurable — it is a single hosted service. */
const FISH_AUDIO_BASE = "https://api.fish.audio";

/**
 * Fish Audio speaks through its own API, not an OpenAI-compatible one:
 * `POST /v1/tts`, the model in a `model:` header rather than the body, and the
 * voice selected by `reference_id` (a voice-model id from their library)
 * rather than by a name like "alloy".
 *
 * Because Fish requires a reference voice id, persona-specific Fish ids are
 * forwarded when they look like one. A writer using Fish directly must put a
 * 32-character model id in the Voice field in Settings.
 */
async function runFishAudioSpeech(args: {
  provider: AiProviderConfig;
  model: string;
  text: string;
  voice: string;
  responseFormat: string;
  speed?: number;
}): Promise<VoiceSpeechResult | null> {
  // Fish voice ids are 32-character hex; the OpenAI voice names we default to
  // ("alloy", "onyx", …) are not, and sending one would 422.
  const referenceId = /^[0-9a-f]{32}$/i.test(args.voice)
    ? args.voice
    : undefined;
  if (!referenceId) {
    throw new Error(
      "Fish Audio needs a 32-character reference voice id in Voice Narration settings.",
    );
  }
  const format = ["mp3", "wav", "pcm", "opus"].includes(args.responseFormat)
    ? args.responseFormat
    : "mp3";

  try {
    const res = await fetch(`${FISH_AUDIO_BASE}/v1/tts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.provider.apiKey}`,
        "content-type": "application/json",
        model: args.model,
      },
      body: JSON.stringify({
        text: args.text,
        format,
        ...(referenceId ? { reference_id: referenceId } : {}),
        ...(args.speed ? { prosody: { speed: args.speed } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Fish Audio speech failed (${res.status}): ${detail.slice(0, 240)}`,
      );
    }
    return {
      audio: new Blob([await res.arrayBuffer()], {
        type: audioMimeType(format),
      }),
      provider: "fishaudio",
      model: args.model,
      voice: referenceId ?? "default",
      responseFormat: format,
    };
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:fishaudio-speech", err);
    throw err;
  }
}

/**
 * Fish Audio transcribes via `POST /v1/asr` as multipart form data — not the
 * OpenAI `/audio/transcriptions` shape, and with no `model` field in the body.
 */
async function runFishAudioTranscribe(args: {
  provider: AiProviderConfig;
  model: string;
  audio: Blob;
}): Promise<VoiceTranscribeResult | null> {
  const start = performance.now();
  try {
    const form = new FormData();
    form.append("audio", args.audio, `note.${blobExtension(args.audio.type)}`);
    form.append("ignore_timestamps", "true");

    const res = await fetch(`${FISH_AUDIO_BASE}/v1/asr`, {
      method: "POST",
      headers: { authorization: `Bearer ${args.provider.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Fish Audio transcription failed (${res.status}): ${detail.slice(0, 240)}`,
      );
    }
    const data = (await res.json()) as { text?: string };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    const traceId = await captureVoiceTranscription({
      provider: "fishaudio",
      model: args.model,
      audio: args.audio,
      output: text,
      latencyMs: performance.now() - start,
    });
    return {
      text,
      provider: "fishaudio",
      model: args.model,
      traceId,
    };
  } catch (err) {
    await captureVoiceTranscription({
      provider: "fishaudio",
      model: args.model,
      audio: args.audio,
      latencyMs: performance.now() - start,
      error: err,
    });
    reportApplicationDiagnostic("twyne:ai-client:fishaudio-transcribe", err);
    return null;
  }
}

interface DirectAudioInput {
  data: Uint8Array;
  mediaType: string;
  filename: string;
}

/** Prepare browser recordings for providers that use OpenAI's input_audio shape. */
async function prepareDirectAudio(
  blob: Blob,
  needsWavOrMp3: boolean,
): Promise<DirectAudioInput> {
  const mediaType = blob.type.split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (
    !needsWavOrMp3 ||
    mediaType === "audio/wav" ||
    mediaType === "audio/mp3" ||
    mediaType === "audio/mpeg"
  ) {
    return {
      data: bytes,
      mediaType: mediaType || "audio/webm",
      filename: `voice-note.${blobExtension(mediaType)}`,
    };
  }

  const decoded = await decodeAudio(bytes);
  const mono =
    decoded.channelData.length > 1
      ? [mixDownToMono(decoded.channelData)]
      : decoded.channelData;
  const wav = await encodeWav({
    sampleRate: decoded.sampleRate,
    channelData: mono,
  });
  return {
    data: new Uint8Array(wav),
    mediaType: "audio/wav",
    filename: "voice-note.wav",
  };
}

function mixDownToMono(channels: Float32Array[]): Float32Array {
  const length = Math.max(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      mono[i] += channel[i] / channels.length;
    }
  }
  return mono;
}

async function runDirectAudioTranscribe(args: {
  provider: AiProviderConfig;
  model: string;
  audio: Blob;
  prompt?: string;
}): Promise<VoiceTranscribeResult | null> {
  const model = await createModel(args.provider, args.model);
  if (!model) return null;
  const start = performance.now();
  try {
    const needsWavOrMp3 =
      args.provider.type === "openai" ||
      isOpenAiCompatibleProvider(args.provider.type) ||
      isTinkerProviderConfig(args.provider) ||
      args.provider.type === "litert";
    const audio = await prepareDirectAudio(args.audio, needsWavOrMp3);
    const result = await generateText({
      model,
      system:
        "You are a transcription service. Return only the spoken words. Preserve meaningful punctuation, but do not add commentary, summaries, speaker labels, or guesses.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                args.prompt?.trim() ||
                "Transcribe this recording exactly. Return only the transcript.",
            },
            {
              type: "file",
              data: audio.data,
              mediaType: audio.mediaType,
              filename: audio.filename,
            },
          ],
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 1200,
    });
    const traceId = await captureVoiceTranscription({
      provider: args.provider.type,
      model: args.model,
      audio: args.audio,
      prompt: args.prompt,
      output: result.text.trim(),
      latencyMs: performance.now() - start,
      usage: normalizeAiUsage(result.totalUsage),
    });
    return {
      text: result.text.trim(),
      provider: args.provider.type,
      model: args.model,
      traceId,
    };
  } catch (err) {
    await captureVoiceTranscription({
      provider: args.provider.type,
      model: args.model,
      audio: args.audio,
      prompt: args.prompt,
      latencyMs: performance.now() - start,
      error: err,
    });
    reportApplicationDiagnostic(
      "twyne:ai-client:direct-audio-transcribe",
      err,
      {
        provider: args.provider.type,
        model: args.model,
      },
    );
    return null;
  }
}

/* ── Public: transcribe speech client-side (BYOK) ───────────────── */

export interface VoiceTranscribeRequest {
  audio: Blob;
  /** Optional nudge for proper nouns and jargon in the recording. */
  prompt?: string;
}

export interface VoiceTranscribeResult {
  text: string;
  provider: string;
  model: string;
  traceId?: string;
}

async function captureVoiceTranscription({
  provider,
  model,
  audio,
  prompt,
  output,
  latencyMs,
  usage,
  error,
}: {
  provider: string;
  model: string;
  audio: Blob;
  prompt?: string;
  output?: string;
  latencyMs: number;
  usage?: AiUsage;
  error?: unknown;
}): Promise<string> {
  return captureAiGeneration({
    feature: "voice-transcription",
    provider,
    model,
    prompt: JSON.stringify({
      audioBytes: audio.size,
      audioType: audio.type,
      hasPrompt: !!prompt?.trim(),
    }),
    output,
    latencyMs,
    usage,
    error,
    evalSignals: { twyne_audio_input: true },
  });
}

/**
 * Transcribe a recording with the writer's own key. Providers with a
 * multimodal model receive the recording as an audio file and return ordinary
 * text; speech-specialist providers keep using their native transcription
 * endpoint.
 */
export async function runClientVoiceTranscribe(
  req: VoiceTranscribeRequest,
  settings: AiSettings,
): Promise<VoiceTranscribeResult | null> {
  const resolved = resolveFeatureConfig(settings, "voice-transcription");
  if (!resolved) return null;
  if (
    !supportsVoiceFeature(
      resolved.provider.type,
      "voice-transcription",
      resolved.provider,
    )
  ) {
    reportApplicationDiagnostic(
      "twyne:ai-client:transcribe-unsupported-provider",
      createAppError("CONFIGURATION_ERROR", { source: "provider" }),
    );
    return null;
  }
  if (req.audio.size === 0) return null;

  if (resolved.provider.type === "fishaudio") {
    return runFishAudioTranscribe({
      provider: resolved.provider,
      model: resolved.model,
      audio: req.audio,
    });
  }

  if (modelAcceptsDirectAudio(resolved.provider, resolved.model)) {
    return runDirectAudioTranscribe({
      provider: resolved.provider,
      model: resolved.model,
      audio: req.audio,
      prompt: req.prompt,
    });
  }

  const baseURL =
    isOpenAiCompatibleProvider(resolved.provider.type) &&
    resolved.provider.baseUrl
      ? resolved.provider.baseUrl.replace(/\/$/, "")
      : "https://api.openai.com/v1";

  try {
    const start = performance.now();
    const form = new FormData();
    form.append("file", req.audio, `note.${blobExtension(req.audio.type)}`);
    form.append("model", resolved.model);
    form.append("response_format", "json");
    if (req.prompt?.trim()) {
      form.append("prompt", req.prompt.trim().slice(0, 800));
    }

    const res = await fetch(`${baseURL}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${resolved.provider.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Transcription failed (${res.status}): ${detail.slice(0, 240)}`,
      );
    }
    const data = (await res.json()) as { text?: string };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    const traceId = await captureVoiceTranscription({
      provider: resolved.provider.type,
      model: resolved.model,
      audio: req.audio,
      prompt: req.prompt,
      output: text,
      latencyMs: performance.now() - start,
    });
    return {
      text,
      provider: resolved.provider.type,
      model: resolved.model,
      traceId,
    };
  } catch (err) {
    await captureVoiceTranscription({
      provider: resolved.provider.type,
      model: resolved.model,
      audio: req.audio,
      prompt: req.prompt,
      latencyMs: 0,
      error: err,
    });
    reportApplicationDiagnostic("twyne:ai-client:voice-transcribe", err);
    return null;
  }
}

function blobExtension(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4" || base === "audio/m4a") return "m4a";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  if (base === "audio/mpeg") return "mp3";
  return "webm";
}

/* ── Public: dedicated evidence & integrity judges (BYOK path) ─── */

export interface EvidenceJudgeRequest {
  brief: ProjectBriefType | null;
  draftText: string;
}

function evidenceStaticNote(draftText: string): string {
  const citations = (
    draftText.match(
      /\(\s*[A-Z][A-Za-z-]+,\s*\d{4}\s*\)|\[\d+\]|\b(?:doi:|https?:\/\/)\S+/g,
    ) ?? []
  ).length;
  const words = draftText.split(/\s+/).filter(Boolean).length;
  const density =
    words > 0
      ? ` (${((citations / words) * 1000).toFixed(1)} per 1,000 words)`
      : "";
  const paragraphs = draftText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean).length;
  return `Citation count: ${citations}${density}, paragraphs: ${paragraphs}.`;
}

function integrityStaticNote(draftText: string): string {
  const fillerCount = (
    draftText.match(
      /\b(very|really|basically|actually|literally|simply|clearly|obviously|undeniably|innovative|robust|leverage|synergy|paradigm|game[- ]changer|cutting[- ]edge|seamless|world[- ]class|transformative)\b/gi,
    ) ?? []
  ).length;
  const vagueCount = (
    draftText.match(
      /\b(thing|things|stuff|various|many|some|people|society|important|interesting|significant|impactful|better|worse|good|bad|a lot|kind of|sort of)\b/gi,
    ) ?? []
  ).length;
  const words = draftText.split(/\s+/).filter(Boolean).length;
  const wpct = (n: number) =>
    words > 0 ? ((n / words) * 100).toFixed(1) + "%" : "0%";
  const universalHits = (
    draftText.match(
      /\b(always|never|everyone|no one|all (?:people|writers|readers|users)|none of|proves?|guarantees?|undeniably|obviously|clearly)\b/gi,
    ) ?? []
  ).length;
  return `Regex signals: filler ${fillerCount} (${wpct(fillerCount)}), vague ${vagueCount} (${wpct(
    vagueCount,
  )}), universal-claim hits: ${universalHits}.`;
}

export async function runClientEvidenceJudge(
  req: EvidenceJudgeRequest,
  settings: AiSettings,
): Promise<{ score: number; rationale: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "rubric-judge");
  if (!resolved) return null;
  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;
  try {
    const goal = req.brief?.answers.goal || "no goal stated in the brief";
    const audience = req.brief?.answers.audience || "a general reader";
    const text = await generateTrackedText({
      feature: "rubric-judge",
      resolved,
      model,
      system: buildEvidenceJudgeSystemPrompt(),
      prompt: buildEvidenceJudgePrompt({
        goal,
        audience,
        draftText: req.draftText,
        staticNote: evidenceStaticNote(req.draftText),
      }),
      spanName: "rubric_judge_evidence",
      evalSignals: { twyne_expected_format: "json_score_rationale" },
    });
    const parsed = parseJudgeOutput(text);
    if (parsed) return { ...parsed, provider: resolved.provider.type };
    return null;
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:evidence-judge", err);
    return null;
  }
}

export async function runClientIntegrityJudge(
  req: EvidenceJudgeRequest,
  settings: AiSettings,
): Promise<{ score: number; rationale: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "rubric-judge");
  if (!resolved) return null;
  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;
  try {
    const goal = req.brief?.answers.goal || "no goal stated in the brief";
    const audience = req.brief?.answers.audience || "a general reader";
    const text = await generateTrackedText({
      feature: "rubric-judge",
      resolved,
      model,
      system: buildIntegrityJudgeSystemPrompt(),
      prompt: buildIntegrityJudgePrompt({
        goal,
        audience,
        draftText: req.draftText,
        staticNote: integrityStaticNote(req.draftText),
      }),
      spanName: "rubric_judge_integrity",
      evalSignals: { twyne_expected_format: "json_score_rationale" },
    });
    const parsed = parseJudgeOutput(text);
    if (parsed) return { ...parsed, provider: resolved.provider.type };
    return null;
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:integrity-judge", err);
    return null;
  }
}

/**
 * The relevance gate (BYOK path). Judges only whether the draft is about the
 * right thing for the right reader — deliberately blind to craft, so the
 * client can use it to cap the shape-derived rubric scores.
 */
export async function runClientTargetFitJudge(
  req: EvidenceJudgeRequest,
  settings: AiSettings,
): Promise<{ score: number; rationale: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "rubric-judge");
  if (!resolved) return null;
  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;
  try {
    const text = await generateTrackedText({
      feature: "rubric-judge",
      resolved,
      model,
      system: buildTargetFitJudgeSystemPrompt(),
      prompt: buildTargetFitJudgePrompt({
        ...targetFitCommission(req.brief),
        draftText: req.draftText,
        particulars: probeParticularsBlock(req.brief),
      }),
      spanName: "rubric_judge_target_fit",
      evalSignals: { twyne_expected_format: "json_score_rationale" },
    });
    const parsed = parseJudgeOutput(text);
    if (parsed) return { ...parsed, provider: resolved.provider.type };
    return null;
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:target-fit-judge", err);
    return null;
  }
}

/**
 * Judge the draft against a criterion the writer wrote (BYOK path).
 * Shares the prompt with the Convex action so the two cannot drift.
 */
export async function runClientCustomCriterionJudge(
  req: {
    brief: ProjectBriefType | null;
    draftText: string;
    label: string;
    description: string;
  },
  settings: AiSettings,
): Promise<{ score: number; rationale: string; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "rubric-judge");
  if (!resolved) return null;
  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;
  try {
    const text = await generateTrackedText({
      feature: "rubric-judge",
      resolved,
      model,
      system: buildCustomCriterionSystemPrompt(),
      prompt: buildCustomCriterionPrompt({
        ...targetFitCommission(req.brief),
        label: req.label,
        description: req.description,
        draftText: req.draftText,
      }),
      spanName: "rubric_judge_custom",
      evalSignals: { twyne_expected_format: "json_score_rationale" },
    });
    const parsed = parseJudgeOutput(text);
    if (parsed) return { ...parsed, provider: resolved.provider.type };
    return null;
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:custom-criterion-judge", err);
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

    const isTinker = isTinkerProviderConfig(config);
    const isAnthropicStyle =
      !isTinker &&
      (config.type === "anthropic" || config.type === "anthropic-compatible");
    const baseUrl = normalizeApiBaseUrl(
      isTinker ? tinkerRelayBaseUrl() : config.baseUrl,
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
  date?: string;
  url?: string;
  doi?: string;
  publisher?: string;
  formatted: string;
  style: "mla" | "apa" | "chicago";
  provider: string;
}

function stripJsonResponse(text: string): string {
  return stripReasoningTags(text)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

export function parseCitationFormatResult(
  text: string,
  style: CitationFormatRequest["style"],
  provider: string,
): CitationFormatResult | null {
  try {
    const stripped = stripJsonResponse(text);
    const candidate = extractFirstJsonObject(stripped) ?? stripped;
    const o = JSON.parse(candidate);
    if (typeof o.title === "string" && o.title.trim()) {
      const year =
        typeof o.year === "string" ? o.year.trim() || undefined : undefined;
      const date =
        typeof o.date === "string" ? o.date.trim() || undefined : year;
      return {
        title: o.title.trim(),
        author:
          typeof o.author === "string"
            ? o.author.trim() || undefined
            : undefined,
        year,
        date,
        url: typeof o.url === "string" ? o.url.trim() || undefined : undefined,
        doi: typeof o.doi === "string" ? o.doi.trim() || undefined : undefined,
        publisher:
          typeof o.publisher === "string"
            ? o.publisher.trim() || undefined
            : undefined,
        formatted:
          typeof o.formatted === "string" ? o.formatted.trim() : o.title.trim(),
        style,
        provider,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
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
{"title": "<title>", "author": "<author if known>", "year": "<year if known>", "date": "<publication date if known>", "url": "<url if known>", "doi": "<doi if known>", "publisher": "<publisher if known>", "formatted": "<full ${req.style} citation>"}`;

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

    return parseCitationFormatResult(text, req.style, resolved.provider.type);
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:citation-format", err);
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
    reportApplicationDiagnostic("twyne:ai-client:source-summary", err);
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

export function parseMissingSourceResult(
  text: string,
  provider: string,
): MissingSourceResult | null {
  try {
    const stripped = stripJsonResponse(text);
    const candidate = extractFirstJsonObject(stripped) ?? stripped;
    const o = JSON.parse(candidate);
    if (Array.isArray(o.claims)) {
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
          }))
          .filter((c: { claim: string }) => c.claim.length > 0),
        provider,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
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

    return parseMissingSourceResult(text, resolved.provider.type);
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:source-detect", err);
    return null;
  }
}

export interface TargetExtractRequest {
  draftText: string;
  existingSources: string[];
  maxTargets?: number;
  instructions?: string;
}

/**
 * The agentic front of auto-research. The model reads the draft and decides
 * exactly which passages need a source (a quote to attribute, a film, a
 * statistic, a claim), and for each returns a precise search query. The
 * background watcher then resolves each target one at a time through the
 * configured research provider.
 */
export async function runClientResearchExtract(
  req: TargetExtractRequest,
  settings: AiSettings,
): Promise<{ targets: ResearchTarget[]; provider: string } | null> {
  const resolved = resolveFeatureConfig(settings, "research-extract");
  if (!resolved) return null;

  const model = await createModel(resolved.provider, resolved.model);
  if (!model) return null;

  const maxTargets = Math.max(
    1,
    Math.min(6, req.maxTargets ?? DEFAULT_TARGETS_PER_PASS),
  );

  try {
    const text = await generateTrackedText({
      feature: "research-extract",
      resolved,
      model,
      system: buildResearchExtractSystemPrompt(),
      prompt: buildResearchExtractUserPrompt({
        draftText: req.draftText,
        existingSources: req.existingSources,
        maxTargets,
        instructions: req.instructions,
      }),
      spanName: "research_extract",
      evalSignals: {
        twyne_draft_chars: req.draftText.length,
        twyne_existing_sources_count: req.existingSources.length,
        twyne_expected_format: "json_research_targets",
      },
    });

    const targets = parseResearchTargets(text);
    if (targets.length === 0) return null;
    return { targets, provider: resolved.provider.type };
  } catch (err) {
    reportApplicationDiagnostic("twyne:ai-client:research-extract", err);
    throw err;
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
    reportApplicationDiagnostic("twyne:ai-client:research-search", err);
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
  /** Provider-authored reasoning shown in a collapsible transcript part. */
  reasoning?: string;
}

export type InterviewMode = "first-run" | "refine";

export interface InterviewTurnRequest {
  messages: InterviewMessage[];
  mode: InterviewMode;
  currentBrief: ProjectBrief | null;
  /** Manuscript text carried over from the dossier refinery's "Start over". */
  startingMaterial?: string | null;
}

export interface InterviewDossierDraft {
  brief: Partial<ProjectInterviewAnswers>;
  confidence: Partial<
    Record<keyof ProjectInterviewAnswers, InterviewConfidence>
  >;
}

export type InterviewStreamUpdate = InterviewStreamSnapshot;

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
      /** A typed follow-up to answer the question with, when one was offered. */
      probe?: DossierProbe;
      provider: string;
      model: string;
      traceId?: string;
    }
  | {
      kind: "synthesis";
      brief: ProjectInterviewAnswers;
      confidence: Partial<
        Record<keyof ProjectInterviewAnswers, InterviewConfidence>
      >;
      provider: string;
      model: string;
      traceId?: string;
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
 * provider. Failures are returned as application errors so the caller can
 * preserve the transcript and offer recovery without exposing provider detail.
 */
export async function runClientInterviewTurn(
  request: InterviewTurnRequest,
  settings: AiSettings,
  onUpdate?: (update: InterviewStreamUpdate) => void,
): Promise<ApplicationResult<InterviewTurnResult>> {
  const cfg = resolveFeatureConfig(settings, "interview-turn");
  if (!cfg) {
    return {
      ok: false,
      error: createAppError("CONFIGURATION_ERROR", {
        source: "provider",
        recovery: { action: "choose-provider", canRetry: false },
        metadata: { feature: "interview-turn" },
      }),
    };
  }
  const model = await createModel(cfg.provider, cfg.model);
  if (!model) {
    return {
      ok: false,
      error: createAppError("CONFIGURATION_ERROR", {
        source: "provider",
        recovery: { action: "check-configuration", canRetry: false },
        metadata: {
          feature: "interview-turn",
          provider: cfg.provider.name,
          model: cfg.model,
        },
      }),
    };
  }
  const generationTraceId = createAiTraceId("interview-turn");
  const generationStart = performance.now();
  let generationPrompt = "";
  try {
    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.author === "writer");
    const startingMaterial = request.startingMaterial?.trim() ?? "";
    const system = [
      "You are a kind, incisive editorial interviewer helping a writer build a project dossier.",
      "Ask one question at a time. Keep it short. You are building a writer's room: identify the piece, reader, goal, tone, constraints, success signal, and what kind of advisors/editors the writer wants around it.",
      'After every ordinary question, append `DOSSIER:` followed by JSON { "brief": { workingTitle, format, audience, goal, tone, constraints, successSignal }, "confidence": { field: "high" | "medium" | "low" } }. Only include fields you can reasonably infer.',
      "When the dossier is complete enough for review, respond only with `SYNTHESIZE:` followed by the same JSON shape. Put requested advisors/editors into constraints or goal until the product has a dedicated advisor schema.",
      request.mode === "refine" && request.currentBrief
        ? `Existing dossier: ${JSON.stringify(request.currentBrief.answers)} — refine it, don't restart.`
        : "",
      startingMaterial
        ? `The writer has already drafted the following manuscript. Read it before asking — orient the dossier around what is already on the page rather than starting from a blank brief.\n\n--- BEGIN MANUSCRIPT ---\n${startingMaterial}\n--- END MANUSCRIPT ---`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const transcript = request.messages
      .map((m) => `${m.author === "writer" ? "Writer" : "You"}: ${m.text}`)
      .join("\n");
    generationPrompt = transcript;
    let text: string;
    if (onUpdate) {
      const streamed = streamText({
        model,
        system,
        prompt: generationPrompt,
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxTokens,
      });
      let rawText = "";
      let nativeReasoning = "";
      for await (const part of streamed.fullStream) {
        if (part.type === "text-delta") rawText += part.text;
        if (part.type === "reasoning-delta") nativeReasoning += part.text;
        if (
          part.type === "text-delta" ||
          part.type === "reasoning-delta" ||
          part.type === "reasoning-end"
        ) {
          onUpdate(createInterviewStreamSnapshot(rawText, nativeReasoning));
        }
      }
      text = await streamed.text;
      await captureAiGeneration({
        feature: "interview-turn",
        provider: cfg.provider.type,
        model: cfg.model,
        system,
        prompt: transcript,
        output: text,
        latencyMs: performance.now() - generationStart,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
        spanName: "interview_turn",
        traceId: generationTraceId,
        usage: normalizeAiUsage(await streamed.totalUsage),
        evalSignals: {
          twyne_interview_mode: request.mode,
          twyne_message_count: request.messages.length,
          twyne_any_protocol_markers: ["DOSSIER:", "PROBE:", "SYNTHESIZE:"],
        },
      });
    } else {
      text = await generateTrackedText({
        feature: "interview-turn",
        resolved: cfg,
        model,
        system,
        prompt: transcript,
        spanName: "interview_turn",
        traceId: generationTraceId,
        evalSignals: {
          twyne_interview_mode: request.mode,
          twyne_message_count: request.messages.length,
        },
      });
    }
    if (!text.trim()) {
      return {
        ok: false,
        error: createAppError("MALFORMED_RESPONSE", {
          source: "provider",
          metadata: {
            feature: "interview-turn",
            provider: cfg.provider.name,
            model: cfg.model,
          },
        }),
      };
    }
    const synthSegment = extractTaggedJson(text, "SYNTHESIZE");
    if (synthSegment) {
      const draft = normalizeInterviewDossierDraft(synthSegment.value);
      if (draft) {
        return successResult({
          kind: "synthesis",
          brief: draft.brief as ProjectInterviewAnswers,
          confidence: draft.confidence,
          provider: cfg.provider.name,
          model: cfg.model,
          traceId: generationTraceId,
        });
      }
      return {
        ok: false,
        error: createAppError("MALFORMED_RESPONSE", {
          source: "provider",
          metadata: { feature: "interview-turn" },
        }),
      };
    }

    // Backward compatibility for the previous two-object SYNTHESIZE format.
    const legacySynthMatch = text.match(
      /SYNTHESIZE:\s*(\{[\s\S]*?\})\s*(\{[\s\S]*?\})?/,
    );
    if (legacySynthMatch) {
      try {
        return successResult({
          kind: "synthesis",
          brief: JSON.parse(legacySynthMatch[1]) as ProjectInterviewAnswers,
          confidence: legacySynthMatch[2]
            ? (JSON.parse(legacySynthMatch[2]) as Partial<
                Record<keyof ProjectInterviewAnswers, InterviewConfidence>
              >)
            : {},
          provider: cfg.provider.name,
          model: cfg.model,
          traceId: generationTraceId,
        });
      } catch {
        return {
          ok: false,
          error: createAppError("MALFORMED_RESPONSE", {
            source: "provider",
            metadata: { feature: "interview-turn" },
          }),
        };
      }
    }

    const dossierSegment = extractTaggedJson(text, "DOSSIER");
    if (!dossierSegment && /\b(?:DOSSIER|SYNTHESIZE)\s*:/i.test(text)) {
      return {
        ok: false,
        error: createAppError("MALFORMED_RESPONSE", {
          source: "provider",
          metadata: { feature: "interview-turn" },
        }),
      };
    }
    const draft = dossierSegment
      ? normalizeInterviewDossierDraft(dossierSegment.value)
      : null;

    // A probe is an optional garnish on a question, so a malformed one is
    // dropped rather than failing the turn — the writer still gets asked,
    // just in prose. Mirrors the Convex path exactly.
    const probeSegment = extractTaggedJson(text, "PROBE");
    const probe = probeSegment ? normalizeProbe(probeSegment.value) : null;

    let body = text;
    if (dossierSegment) body = stripTaggedJson(body, dossierSegment);
    if (probeSegment) {
      const reSegment = extractTaggedJson(body, "PROBE");
      if (reSegment) body = stripTaggedJson(body, reSegment);
    }
    const reply =
      body.trim() ||
      (lastUser ? "Tell me more." : "What is the working title of this piece?");
    return successResult({
      kind: "question",
      text: reply,
      draft: draft ?? undefined,
      probe: probe ?? undefined,
      provider: cfg.provider.name,
      model: cfg.model,
      traceId: generationTraceId,
    });
  } catch (err) {
    if (onUpdate) {
      await captureAiGeneration({
        feature: "interview-turn",
        provider: cfg.provider.type,
        model: cfg.model,
        prompt: generationPrompt,
        latencyMs: performance.now() - generationStart,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
        spanName: "interview_turn",
        traceId: generationTraceId,
        error: err,
        evalSignals: {
          twyne_interview_mode: request.mode,
          twyne_message_count: request.messages.length,
        },
      });
    }
    return failureResult(err, {
      source: "provider",
      metadata: {
        feature: "interview-turn",
        provider: cfg.provider.name,
        model: cfg.model,
      },
    });
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
    reportApplicationDiagnostic("twyne:ai-client:dossier-check", err);
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
