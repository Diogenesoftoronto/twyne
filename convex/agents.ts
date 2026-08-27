"use node";

/**
 * Convex actions for the room of editors. Each action is a thin wrapper
 * around `runAgent`, which selects a provider based on environment
 * variables and falls back to the local generator if no provider is
 * configured. The provider chain is:
 *
 *   1. Rivet agentOS (RIVET_ENDPOINT) — Rivet's hosted or self-hosted
 *      agent runtime, OpenAI-compatible API.
 *   2. Anthropic (ANTHROPIC_API_KEY) — direct call via the Vercel AI SDK.
 *   3. OpenAI (OPENAI_API_KEY) — direct call via the Vercel AI SDK.
 *   4. Local deterministic generator — always available, no network.
 *
 * Setting one of the env vars upgrades the room from mock to real.
 * The local path is what the original Twyne panel used; it is preserved
 * so the room never breaks entirely when no provider is configured.
 */

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { generateText, stepCountIs, streamText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  buildSystemPrompt,
  buildUserPrompt,
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
  type AgentPersona,
  type AgentRequest,
  type AgentResponse,
  type FeedbackType,
  type MemoForSynthesis,
} from "./agentPrompts";
import { buildQuoteTools } from "./agentTools";
import type {
  DossierCheckResult,
  DossierProbe,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../src/types";
import { normalizeProbe } from "../src/utils/dossier-probes";
import { parseDossierCheckResult } from "../src/utils/dossier-check";
import {
  removeReasoningTagMarkers,
  stripReasoningTags,
} from "../src/utils/reasoning-tags";
import { scoreStaticFeatures, scoreSufficiency } from "../src/utils/rubric";
import {
  clampScore,
  extractTaggedJson,
  parseJudgeOutput,
  stripTaggedJson,
} from "../src/utils/llm-parsing";
import "./arizeTracing";
import { tracingEnabled, flushArize } from "./arizeTracing";
import { captureServerAiGeneration } from "./posthog";
import type { ServerAiObservabilityContext } from "./posthog";
import {
  createAiTraceId,
  normalizeAiUsage,
  type AiUsage,
} from "../src/utils/ai-deterministic-evals";
import {
  normalizeUsageAiFeature,
  USAGE_LIMITS,
  utcDayFromTimestamp,
  type AiFeature,
  type UsageEvent,
} from "../src/utils/usage-domain";
import {
  estimateUsageCost,
  resolveUsageCost,
} from "../src/utils/usage-pricing";
import {
  countWords,
  MIN_EDITOR_WORDS,
  MIN_MARKUP_WORDS,
  MIN_RUBRIC_WORDS,
} from "../src/utils/draft-thresholds";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import {
  issueNotOrganicAccessToken,
  notOrganicEnabled,
  notOrganicIssuer,
  notOrganicOpenAiRoute,
  type NotOrganicModelAlias,
} from "./lib/notorganic";
import {
  applicationError,
  reportedApplicationError,
} from "./lib/applicationErrors";
import { createInterviewStreamSnapshot } from "../src/utils/interview-stream";
import {
  createGenerationStreamAccumulator,
  createPublishGate,
  type GenerationStreamSnapshot,
} from "../src/utils/generation-stream";
import { prompt as renderNamed } from "../src/utils/prompts";
import { internal } from "./_generated/api";

/* ── Provider selection ─────────────────────────────────────────── */

interface ProviderConfig {
  model: LanguageModel;
  label: "rivet" | "anthropic" | "openai" | "portkey";
  /** Default model id used by this provider. */
  modelId: string;
}

const writeInterviewStreamReference = makeFunctionReference<
  "mutation",
  {
    userId: string;
    streamId: string;
    text: string;
    reasoning: string;
    phase: "reasoning" | "answer";
    status: "running" | "complete" | "error";
  },
  unknown
>("interviewStreams:write");

const recordTrustedUsageReference = makeFunctionReference<
  "mutation",
  { ownerId: string; event: UsageEvent },
  { inserted: boolean }
>("usage:recordTrustedEvent");

interface HostedUsageCapture {
  ctx: ActionCtx;
  ownerId: string;
  provider: ProviderConfig;
  feature: AiFeature | string;
  traceId: string;
  editorialActionId?: string;
  folioId?: string;
}

function newHostedUsageCapture(
  ctx: ActionCtx,
  ownerId: string,
  provider: ProviderConfig,
  feature: AiFeature,
): HostedUsageCapture {
  return {
    ctx,
    ownerId,
    provider,
    feature,
    traceId: createAiTraceId(feature),
  };
}

async function recordHostedAttempt(
  capture: HostedUsageCapture,
  attempt: number,
  outcome: "completed" | "failed",
  usage?: AiUsage,
) {
  const occurredAt = Date.now();
  const boundedUsage = Object.fromEntries(
    Object.entries(usage ?? {}).filter(
      ([, value]) =>
        Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= USAGE_LIMITS.tokenCount,
    ),
  ) as AiUsage;
  const model = capture.provider.modelId.slice(0, USAGE_LIMITS.model);
  const estimate = estimateUsageCost({
    source: "hosted",
    provider: capture.provider.label,
    model,
    usage: boundedUsage,
  });
  const cost = resolveUsageCost({ source: "hosted", estimate });
  const event: UsageEvent = {
    eventKey: `${capture.traceId}:${attempt}:${capture.provider.label}:${model}`,
    occurredAt,
    day: utcDayFromTimestamp(occurredAt),
    source: "hosted",
    authority: "server",
    feature: normalizeUsageAiFeature(capture.feature),
    provider: capture.provider.label,
    model,
    folioId: capture.folioId?.slice(0, USAGE_LIMITS.opaqueId),
    editorialActionId: (capture.editorialActionId ?? capture.traceId).slice(
      0,
      USAGE_LIMITS.opaqueId,
    ),
    traceId: capture.traceId,
    attempt,
    outcome,
    ...boundedUsage,
    costMicrousd:
      cost.kind === "actual" || cost.kind === "estimated"
        ? cost.costMicrousd
        : undefined,
    costKind: cost.kind,
    pricingVersion: cost.kind === "estimated" ? cost.pricingVersion : undefined,
    pricing: cost.kind === "estimated" ? cost.pricing : undefined,
  };
  await capture.ctx.runMutation(recordTrustedUsageReference, {
    ownerId: capture.ownerId,
    event,
  });
}

async function trackedGenerateText(
  capture: HostedUsageCapture,
  attempt: number,
  generation: Parameters<typeof generateText>[0],
) {
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText(generation);
  } catch (error) {
    await recordHostedAttempt(capture, attempt, "failed").catch((recordError) =>
      console.error(
        "[twyne:usage] failed to record failed provider attempt",
        recordError,
      ),
    );
    throw error;
  }
  await recordHostedAttempt(
    capture,
    attempt,
    "completed",
    normalizeAiUsage(result.totalUsage),
  );
  return result;
}

function pickLegacyProvider(): ProviderConfig | null {
  const rivetUrl = process.env.RIVET_ENDPOINT;
  const rivetToken = process.env.RIVET_TOKEN;
  if (rivetUrl) {
    const modelId = process.env.RIVET_MODEL ?? "anthropic/claude-sonnet-4-6";
    const rivet = createOpenAI({
      baseURL: rivetUrl.replace(/\/$/, "") + "/v1",
      apiKey: rivetToken ?? "rivet-anonymous",
    });
    return {
      model: rivet.chat(modelId),
      label: "rivet",
      modelId,
    };
  }

  const portkeyKey = process.env.PORTKEY_API_KEY;
  if (portkeyKey) {
    const modelId =
      process.env.PORTKEY_DEFAULT_MODEL ?? "@neuralwatt/qwen3.5-397b-fast";
    const portkey = createOpenAI({
      baseURL: (
        process.env.PORTKEY_BASE_URL ?? "https://api.portkey.ai/v1"
      ).replace(/\/$/, ""),
      // Portkey accepts the key as a standard bearer token; the @provider
      // prefix on the model id routes to the Model Catalog provider, so no
      // extra headers are needed.
      apiKey: portkeyKey,
    });
    return {
      model: portkey.chat(modelId),
      label: "portkey",
      modelId,
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const modelId = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
    return {
      model: anthropic(modelId),
      label: "anthropic",
      modelId,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const modelId = process.env.OPENAI_MODEL ?? "gpt-5.5";
    return {
      model: openai(modelId),
      label: "openai",
      modelId,
    };
  }

  return null;
}

const linkedDidReference = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");

/**
 * Prefer the feature-flagged shared provider for linked users. Any missing
 * identity, link, configuration, or exchange failure falls through to the
 * existing Rivet/Portkey/BYO chain and ultimately the deterministic local
 * generator.
 */
async function pickProvider(
  ctx: ActionCtx,
  feature: string,
  alias: NotOrganicModelAlias = "balanced",
): Promise<ProviderConfig | null> {
  if (notOrganicEnabled()) {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        const link = await ctx.runQuery(linkedDidReference, {
          productSubject: identity.subject || identity.tokenIdentifier,
        });
        if (link) {
          const token = await issueNotOrganicAccessToken({
            did: link.did,
            feature,
            capabilities: [`infer:${alias}`],
            sessionVersion: link.sessionVersion,
          });
          const route = notOrganicOpenAiRoute(
            token,
            alias,
            feature,
            notOrganicIssuer(),
          );
          const provider = createOpenAI({
            baseURL: route.baseURL,
            apiKey: route.apiKey,
            headers: route.headers,
            fetch: route.fetch,
          });
          return {
            model: provider.chat(route.model),
            // Preserve the public response union: Not Organic is an
            // OpenAI-compatible transport, distinguished by alias + headers.
            label: "openai",
            modelId: alias,
          };
        }
      }
    } catch (error) {
      console.warn(
        `[twyne:notorganic] ${feature} unavailable; using existing provider fallback`,
        error,
      );
    }
  }
  return pickLegacyProvider();
}

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

/* ── LLM call wrapper ───────────────────────────────────────────── */

/**
 * Twyne sets no output ceiling.
 *
 * These call sites used to carry per-feature budgets — 380 tokens for a note,
 * 200 for a judge — sized against how long the visible answer ought to run.
 * On a model that thinks before it answers the budget is spent on the thinking
 * too, and when it runs out mid-thought the answer never arrives: the reply
 * strips to nothing and a template is filed in its place. Nothing about that
 * looks like a failure to the writer.
 *
 * The ceiling was never what kept an answer short — the prompts do that — so
 * leaving it unset costs nothing. Each provider falls back to its own model
 * maximum, and generation is billed on what a model writes rather than on what
 * it was permitted to write.
 */
const NO_OUTPUT_CEILING = undefined;

/**
 * How often a generation in flight republishes itself, at most. Ten times a
 * second reads as continuous to someone watching the words appear, and it is
 * the difference between a convened room costing a few hundred writes and
 * costing a few thousand.
 */
const STREAM_PUBLISH_INTERVAL_MS = 100;

/**
 * Where a hosted note publishes itself while it is still being written.
 * Absent means the caller wants the old one-shot behaviour.
 */
interface NoteStreamTarget {
  ctx: ActionCtx;
  userId: string;
  streamId: string;
  personaId: string;
}

/**
 * Run a generation with `streamText`, publishing snapshots to the panel as
 * they arrive.
 *
 * Returns the same `{ text, totalUsage }` shape `generateText` gives back, so
 * everything downstream — the empty-result retry, tracing, anchor capture — is
 * identical whether or not anyone was watching. Reads `fullStream` rather than
 * `textStream` for the same reason the client does: providers with a native
 * reasoning channel emit `reasoning-delta` parts, while OpenAI-compatible
 * endpoints inline `<think>` in the text, and both have to reach the reader as
 * reasoning rather than as prose or as nothing.
 */
async function streamNote(
  target: NoteStreamTarget,
  generation: Parameters<typeof streamText>[0],
): Promise<{ text: string; totalUsage: unknown }> {
  const accumulator = createGenerationStreamAccumulator();
  const worthWriting = createPublishGate(STREAM_PUBLISH_INTERVAL_MS);

  const publish = async (
    snapshot: GenerationStreamSnapshot,
    status: "running" | "complete" | "error",
  ) => {
    if (!worthWriting({ ...snapshot, status })) return;
    await target.ctx.runMutation(internal.personaNoteStreams.write, {
      userId: target.userId,
      streamId: target.streamId,
      personaId: target.personaId,
      text: snapshot.text,
      reasoning: snapshot.reasoning,
      phase: snapshot.activePart === "reasoning" ? "reasoning" : "answer",
      status,
    });
  };

  const streamed = streamText(generation);
  for await (const part of streamed.fullStream) {
    switch (part.type) {
      case "text-delta":
        await publish(
          accumulator.push({ type: "text-delta", text: part.text }),
          "running",
        );
        break;
      case "reasoning-start":
        await publish(accumulator.push({ type: "reasoning-start" }), "running");
        break;
      case "reasoning-delta":
        await publish(
          accumulator.push({ type: "reasoning-delta", text: part.text }),
          "running",
        );
        break;
      case "reasoning-end":
        await publish(accumulator.push({ type: "reasoning-end" }), "running");
        break;
      default:
        break;
    }
  }

  const text = await streamed.text;
  const totalUsage = await streamed.totalUsage;
  await publish(accumulator.push({ type: "finish" }), "complete");
  return { text, totalUsage };
}

async function trackedStreamNote(
  target: NoteStreamTarget,
  generation: Parameters<typeof streamText>[0],
  capture: HostedUsageCapture,
  attempt: number,
) {
  let result: Awaited<ReturnType<typeof streamNote>>;
  try {
    result = await streamNote(target, generation);
  } catch (error) {
    await recordHostedAttempt(capture, attempt, "failed").catch((recordError) =>
      console.error(
        "[twyne:usage] failed to record failed provider attempt",
        recordError,
      ),
    );
    throw error;
  }
  await recordHostedAttempt(
    capture,
    attempt,
    "completed",
    normalizeAiUsage(result.totalUsage),
  );
  return result;
}

async function runLlm(
  ctx: ActionCtx,
  ownerId: string,
  provider: ProviderConfig,
  req: AgentRequest,
  feature:
    | "persona-feedback"
    | "persona-reply"
    | "persona-analysis" = "persona-feedback",
  maxTokens: number | undefined = NO_OUTPUT_CEILING,
  observability?: ServerAiObservabilityContext,
  stream?: NoteStreamTarget,
): Promise<AgentResponse> {
  const system = buildSystemPrompt(req.persona);
  const user = buildUserPrompt(req);
  const fallbackType: FeedbackType = defaultTypeForPersona(req.persona);
  const temperature =
    req.persona.temperature ?? (provider.label === "openai" ? 0.6 : 0.4);
  const start = Date.now();
  const { tools, getAnchor } = buildQuoteTools(req.draftText);
  const usageTraceId = observability?.traceId ?? createAiTraceId(feature);
  const capture: HostedUsageCapture = {
    ctx,
    ownerId,
    provider,
    feature,
    traceId: usageTraceId,
    editorialActionId: observability?.editorialActionId,
    folioId: observability?.folioId,
  };

  try {
    const generation = {
      model: provider.model,
      system,
      prompt: user,
      temperature,
      maxOutputTokens: maxTokens,
      tools,
      stopWhen: stepCountIs(3),
      experimental_telemetry: {
        isEnabled: tracingEnabled,
        functionId: feature,
        metadata: {
          feature,
          persona: req.persona.id,
          provider: provider.label,
          model: provider.modelId,
        },
      },
    };
    const first = stream
      ? await trackedStreamNote(stream, generation, capture, 1)
      : await trackedGenerateText(capture, 1, generation);
    const text = first.text;
    let usage = normalizeAiUsage(first.totalUsage);
    let visibleText = stripReasoningTags(text);
    // Reasoning is a mode, not a defect. The thinking is already stripped from
    // what the reader sees, so a model that thinks first has cost us nothing.
    // Only regenerate when nothing visible survived — an unclosed block, which
    // in practice means the token budget cut the generation short.
    if (!visibleText) {
      const retry = await trackedGenerateText(capture, 2, {
        model: provider.model,
        system,
        prompt: `${user}\n\nClose your <think> block, then write the note.`,
        temperature,
        maxOutputTokens: maxTokens,
        tools,
        stopWhen: stepCountIs(3),
        experimental_telemetry: {
          isEnabled: tracingEnabled,
          functionId: `${feature}:retry`,
          metadata: {
            feature,
            persona: req.persona.id,
            provider: provider.label,
            model: provider.modelId,
          },
        },
      });
      usage = normalizeAiUsage(retry.totalUsage) ?? usage;
      // Still nothing visible: keep the model's words with the tag markers
      // removed, so the card is never blank.
      visibleText =
        stripReasoningTags(retry.text) || removeReasoningTagMarkers(retry.text);
    }
    const traceId = await captureServerAiGeneration({
      feature,
      provider: provider.label,
      model: provider.modelId,
      req,
      output: visibleText,
      latencyMs: Date.now() - start,
      temperature,
      maxTokens,
      spanName: feature,
      usage,
      observability: { ...observability, traceId: usageTraceId },
    });

    const cleaned = visibleText.trim();
    await flushArize();
    return {
      text: cleaned || "(no response)",
      type: classifyType(cleaned, fallbackType),
      provider: provider.label,
      traceId,
      anchor: getAnchor() ?? req.anchor,
    };
  } catch (err) {
    await captureServerAiGeneration({
      feature,
      provider: provider.label,
      model: provider.modelId,
      req,
      latencyMs: Date.now() - start,
      temperature,
      maxTokens,
      spanName: feature,
      observability,
      error: err,
    });
    await flushArize();
    throw err;
  }
}

/**
 * Generate plain long-form text from a system + user prompt, with the same
 * empty-after-strip retry as {@link runLlm}. Used for the room synthesis and
 * the narrative rubric review, neither of which speaks as a single persona.
 */
async function runPlainLlm(
  capture: HostedUsageCapture,
  provider: ProviderConfig,
  system: string,
  user: string,
  maxTokens: number | undefined,
  feature: string,
): Promise<string> {
  const gen = async (prompt: string, suffix?: string) =>
    trackedGenerateText(capture, suffix ? 2 : 1, {
      model: provider.model,
      system,
      prompt,
      temperature: 0.4,
      maxOutputTokens: maxTokens,
      experimental_telemetry: {
        isEnabled: tracingEnabled,
        functionId: suffix ? `${feature}:${suffix}` : feature,
        metadata: {
          feature,
          provider: provider.label,
          model: provider.modelId,
        },
      },
    });
  const { text } = await gen(user);
  let visible = stripReasoningTags(text);
  // Only an empty result is worth a second call — see runLlm.
  if (!visible) {
    const retry = await gen(
      `${user}\n\nClose your <think> block, then write your answer.`,
      "retry",
    );
    visible =
      stripReasoningTags(retry.text) || removeReasoningTagMarkers(retry.text);
  }
  await flushArize();
  return visible.trim();
}

function defaultTypeForPersona(p: AgentPersona): FeedbackType {
  switch (p.id) {
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

/* ── Public actions ─────────────────────────────────────────────── */

const personaValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: v.string(),
  description: v.string(),
  focus: v.string(),
  backstory: v.optional(v.string()),
  criticalMethod: v.optional(v.string()),
  voice: v.optional(v.string()),
  signatureMoves: v.optional(v.array(v.string())),
  avoidances: v.optional(v.array(v.string())),
  sampleLines: v.optional(v.array(v.string())),
  providerId: v.optional(v.string()),
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  color: v.optional(v.string()),
  icon: v.optional(v.string()),
});

const attachmentValidator = v.object({
  id: v.string(),
  kind: v.union(v.literal("document"), v.literal("link")),
  title: v.string(),
  url: v.optional(v.string()),
  text: v.optional(v.string()),
  why: v.string(),
  addedAt: v.number(),
});

const projectInterviewAnswersValidator = v.object({
  workingTitle: v.string(),
  format: v.string(),
  audience: v.string(),
  goal: v.string(),
  tone: v.string(),
  constraints: v.string(),
  successSignal: v.string(),
});

/**
 * A typed interview follow-up. Every field past `id`/`kind`/`prompt` is
 * optional because the shape varies by kind — options for a choice, a template
 * for blanks, bounds for a scale — and Convex validators reject unknown keys,
 * so anything the client can attach to a brief has to be declared here or the
 * whole call fails validation.
 */
const probeValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("choice"),
    v.literal("multi"),
    v.literal("blanks"),
    v.literal("scale"),
  ),
  prompt: v.string(),
  options: v.optional(v.array(v.string())),
  template: v.optional(v.string()),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  minLabel: v.optional(v.string()),
  maxLabel: v.optional(v.string()),
  answer: v.optional(v.union(v.string(), v.array(v.string()), v.number())),
  relatesTo: v.optional(v.string()),
});

const projectBriefValidator = v.object({
  answers: projectInterviewAnswersValidator,
  attachments: v.array(attachmentValidator),
  probes: v.optional(v.array(probeValidator)),
  completedAt: v.number(),
  updatedAt: v.number(),
});

const briefValidator = v.union(v.null(), projectBriefValidator);

const writerProfileValidator = v.optional(
  v.object({
    displayName: v.string(),
    personalFacts: v.string(),
    feedbackStyle: v.union(
      v.literal("direct"),
      v.literal("balanced"),
      v.literal("gentle"),
    ),
    feedbackNotes: v.string(),
  }),
);

type InterviewMessage = {
  author: "writer" | "interviewer";
  text: string;
};

type InterviewConfidence = "high" | "medium" | "low";

type InterviewTurnResult =
  | {
      kind: "question";
      text: string;
      draft?: {
        brief: Partial<ProjectInterviewAnswers>;
        confidence: Partial<
          Record<keyof ProjectInterviewAnswers, InterviewConfidence>
        >;
      };
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

/**
 * The interviewer's contract. Three optional tagged segments, all parsed by
 * the same `extractTaggedJson` helper:
 *
 *   DOSSIER:    running inference about the seven brief fields
 *   PROBE:      one typed follow-up (choice / multi / blanks / scale)
 *   SYNTHESIZE: the finished dossier, ending the interview
 *
 * The probe instruction is written as "reach for this when prose was vague"
 * rather than "use these sometimes", because a model told to vary its format
 * will vary it decoratively — asking a multiple-choice question it already
 * knows the answer to. The point of a typed question is to pin down something
 * a paragraph left soft.
 */
function interviewSystemPrompt(
  mode: "first-run" | "refine",
  currentBrief: ProjectBrief | null,
  startingMaterial: string | null = null,
): string {
  const trimmed = startingMaterial?.trim();
  const refineAppendix =
    mode === "refine" && currentBrief
      ? renderNamed("blocks/refine-appendix", {
          dossierJson: JSON.stringify(currentBrief.answers),
        })
      : "";
  const manuscriptAppendix = trimmed
    ? renderNamed("blocks/manuscript-appendix", { manuscript: trimmed })
    : "";
  const base = renderNamed("interview-system", {
    refineAppendix,
    manuscriptAppendix,
  });
  // Drop an empty trailing newline if neither appendix supplied.
  return base.replace(/\n+$/g, "\n");
}

function normalizeInterviewDossierDraft(value: unknown) {
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

function parseInterviewTurnResult(
  text: string,
  provider: string,
  model: string,
  messages: InterviewMessage[],
  traceId?: string,
): InterviewTurnResult {
  const visibleText = stripReasoningTags(text);
  if (!visibleText.trim()) {
    throw applicationError("malformed_response");
  }
  const lastUser = [...messages].reverse().find((m) => m.author === "writer");
  const synthSegment = extractTaggedJson(visibleText, "SYNTHESIZE");
  if (synthSegment) {
    const draft = normalizeInterviewDossierDraft(synthSegment.value);
    if (draft) {
      return {
        kind: "synthesis",
        brief: draft.brief as ProjectInterviewAnswers,
        confidence: draft.confidence,
        provider,
        model,
        traceId,
      };
    }
    throw applicationError("malformed_response");
  }

  const legacySynthMatch = visibleText.match(
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
        provider,
        model,
      };
    } catch {
      throw applicationError("malformed_response");
    }
  }

  const dossierSegment = extractTaggedJson(visibleText, "DOSSIER");
  if (!dossierSegment && /\b(?:DOSSIER|SYNTHESIZE)\s*:/i.test(visibleText)) {
    throw applicationError("malformed_response");
  }
  const draft = dossierSegment
    ? normalizeInterviewDossierDraft(dossierSegment.value)
    : null;

  // A probe is an optional garnish on a question, so a malformed one is
  // dropped rather than failing the turn — the writer still gets asked, just
  // in prose. This is why it does not join the strict tag check above.
  const probeSegment = extractTaggedJson(visibleText, "PROBE");
  const probe = probeSegment ? normalizeProbe(probeSegment.value) : null;

  let body = visibleText;
  if (dossierSegment) body = stripTaggedJson(body, dossierSegment);
  if (probeSegment) {
    const reSegment = extractTaggedJson(body, "PROBE");
    if (reSegment) body = stripTaggedJson(body, reSegment);
  }
  const reply =
    body.trim() ||
    (lastUser ? "Tell me more." : "What is the working title of this piece?");

  return {
    kind: "question",
    text: reply,
    draft: draft ?? undefined,
    probe: probe ?? undefined,
    provider,
    model,
    traceId,
  };
}

export const runInterviewTurn = action({
  args: {
    messages: v.array(
      v.object({
        author: v.union(v.literal("writer"), v.literal("interviewer")),
        text: v.string(),
      }),
    ),
    mode: v.union(v.literal("first-run"), v.literal("refine")),
    currentBrief: briefValidator,
    streamId: v.optional(v.string()),
    /**
     * Manuscript text the writer has already drafted, surfaced by the
     * dossier refinery's "Start over" flow. When present, the system
     * prompt reads it as the starting context for the conversation so the
     * AI asks questions that fit the work-in-progress instead of
     * rediscovering it from scratch.
     */
    startingMaterial: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<InterviewTurnResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw applicationError("authentication_required");
    }
    const provider = await pickProvider(ctx, "interview-turn", "balanced");
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const transcript = (args.messages as InterviewMessage[])
      .map((m) => `${m.author === "writer" ? "Writer" : "You"}: ${m.text}`)
      .join("\n");
    const temperature = provider.label === "openai" ? 0.6 : 0.4;
    const maxTokens = NO_OUTPUT_CEILING;
    const traceId = createAiTraceId("interview-turn");
    const start = Date.now();
    const input = JSON.stringify({
      mode: args.mode,
      transcript,
      startingMaterial: args.startingMaterial,
    });
    const usageCapture: HostedUsageCapture = {
      ctx,
      ownerId: identity.tokenIdentifier,
      provider,
      feature: "interview-turn",
      traceId,
    };
    let providerSettled = false;
    try {
      const generation = {
        model: provider.model,
        system: interviewSystemPrompt(
          args.mode,
          (args.currentBrief ?? null) as ProjectBrief | null,
          args.startingMaterial ?? null,
        ),
        prompt: transcript,
        temperature,
        maxOutputTokens: maxTokens,
        experimental_telemetry: {
          isEnabled: tracingEnabled,
          functionId: "interview-turn",
          metadata: {
            feature: "interview-turn",
            provider: provider.label,
            model: provider.modelId,
            mode: args.mode,
          },
        },
      };
      let text: string;
      let usage;
      if (args.streamId) {
        let rawText = "";
        let nativeReasoning = "";
        const worthWriting = createPublishGate(STREAM_PUBLISH_INTERVAL_MS);
        const streamed = streamText(generation);
        for await (const part of streamed.fullStream) {
          if (part.type === "text-delta") rawText += part.text;
          if (part.type === "reasoning-delta") nativeReasoning += part.text;
          if (
            part.type === "text-delta" ||
            part.type === "reasoning-delta" ||
            part.type === "reasoning-end"
          ) {
            const snapshot = createInterviewStreamSnapshot(
              rawText,
              nativeReasoning,
            );
            if (!worthWriting({ ...snapshot, status: "running" })) continue;
            await ctx.runMutation(writeInterviewStreamReference, {
              userId: identity.subject || identity.tokenIdentifier,
              streamId: args.streamId,
              ...snapshot,
              status: "running",
            });
          }
        }
        text = await streamed.text;
        usage = normalizeAiUsage(await streamed.totalUsage);
        providerSettled = true;
        await recordHostedAttempt(usageCapture, 1, "completed", usage);
        const finalSnapshot = createInterviewStreamSnapshot(
          text,
          nativeReasoning,
        );
        await ctx.runMutation(writeInterviewStreamReference, {
          userId: identity.subject || identity.tokenIdentifier,
          streamId: args.streamId,
          ...finalSnapshot,
          status: "complete",
        });
      } else {
        const result = await trackedGenerateText(usageCapture, 1, generation);
        providerSettled = true;
        text = result.text;
        usage = normalizeAiUsage(result.totalUsage);
      }
      await captureServerAiGeneration({
        feature: "interview-turn",
        provider: provider.label,
        model: provider.modelId,
        generationInput: input,
        output: text,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "interview-turn",
        usage,
        observability: {
          distinctId: identity.tokenIdentifier,
          traceId,
        },
        evalSignals: {
          twyne_interview_mode: args.mode,
          twyne_any_protocol_markers: ["DOSSIER:", "PROBE:", "SYNTHESIZE:"],
        },
      });
      await flushArize();
      return parseInterviewTurnResult(
        text,
        provider.label,
        provider.modelId,
        args.messages as InterviewMessage[],
        traceId,
      );
    } catch (error) {
      if (!providerSettled) {
        await recordHostedAttempt(usageCapture, 1, "failed").catch(
          () => undefined,
        );
      }
      if (error instanceof Error && error.name === "ConvexError") {
        await flushArize();
        throw error;
      }
      await captureServerAiGeneration({
        feature: "interview-turn",
        provider: provider.label,
        model: provider.modelId,
        generationInput: input,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "interview-turn",
        observability: {
          distinctId: identity.tokenIdentifier,
          traceId,
        },
        error,
      });
      if (args.streamId) {
        await ctx
          .runMutation(writeInterviewStreamReference, {
            userId: identity.subject || identity.tokenIdentifier,
            streamId: args.streamId,
            text: "",
            reasoning: "",
            phase: "answer",
            status: "error",
          })
          .catch(() => undefined);
      }
      if (error instanceof Error && error.name === "ConvexError") {
        throw error;
      }
      throw reportedApplicationError(
        "agents.interview-turn",
        "provider_unavailable",
        error,
        { recovery: "retry" },
        {
          provider: provider.label,
          model: provider.modelId,
          mode: args.mode,
        },
      );
    }
  },
});

/**
 * Compare the live manuscript with the filed dossier on Twyne's hosted
 * provider path. The client uses the writer's own configured provider first;
 * this action is the signed-in fallback promised by onboarding.
 */
export const runDossierCheck = action({
  args: {
    brief: projectBriefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args): Promise<DossierCheckResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");

    await consumeRateLimit(ctx, {
      action: "agent:dossier-check",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentFeedback,
    });

    if (!args.draftText.trim()) {
      throw applicationError("validation_failed", {
        message: "Write something before asking the room to read the draft.",
      });
    }

    const provider = await pickProvider(ctx, "dossier-check", "balanced");
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const system = renderNamed("dossier-check-system");
    const user = renderNamed("dossier-check-user", {
      dossier: JSON.stringify(args.brief.answers),
      draft: args.draftText,
    });
    const temperature = 0.2;
    const maxTokens = NO_OUTPUT_CEILING;
    const start = Date.now();
    const usageCapture: HostedUsageCapture = {
      ctx,
      ownerId: identity.tokenIdentifier,
      provider,
      feature: "dossier-check",
      traceId: createAiTraceId("dossier-check"),
    };

    try {
      const { text, totalUsage } = await trackedGenerateText(usageCapture, 1, {
        model: provider.model,
        system,
        prompt: user,
        temperature,
        maxOutputTokens: maxTokens,
        experimental_telemetry: {
          isEnabled: tracingEnabled,
          functionId: "dossier_check",
          metadata: {
            feature: "dossier-check",
            provider: provider.label,
            model: provider.modelId,
          },
        },
      });
      const visibleText = stripReasoningTags(text);
      const parsed = parseDossierCheckResult(
        visibleText,
        provider.label,
        args.brief.answers,
      );

      await captureServerAiGeneration({
        feature: "dossier-check",
        provider: provider.label,
        model: provider.modelId,
        generationInput: JSON.stringify({
          brief: args.brief.answers,
          draftText: args.draftText,
        }),
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "dossier_check",
        usage: normalizeAiUsage(totalUsage),
        observability: {
          distinctId: identity.tokenIdentifier,
        },
        evalSignals: {
          twyne_expected_format: "json_dossier_observations",
        },
      });
      await flushArize();

      if (!parsed) {
        throw applicationError("malformed_response", {
          recovery: "retry",
        });
      }
      return parsed;
    } catch (error) {
      // Parsing failures are deliberate, structured application errors. They
      // were already captured with the provider output above, so preserve the
      // malformed-response diagnosis instead of recording it a second time
      // and relabeling it as provider_unavailable.
      if (error instanceof Error && error.name === "ConvexError") {
        throw error;
      }
      await captureServerAiGeneration({
        feature: "dossier-check",
        provider: provider.label,
        model: provider.modelId,
        generationInput: JSON.stringify({
          brief: args.brief.answers,
          draftText: args.draftText,
        }),
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "dossier_check",
        observability: {
          distinctId: identity.tokenIdentifier,
        },
        error,
      });
      await flushArize();
      throw reportedApplicationError(
        "agents.dossier-check",
        "provider_unavailable",
        error,
        { recovery: "retry" },
        {
          provider: provider.label,
          model: provider.modelId,
        },
      );
    }
  },
});

/**
 * Run a single persona agent. Returns the agent's note and metadata.
 * Falls back to the local generator if no provider is configured or the
 * remote call fails — the room never breaks entirely.
 *
 * Security: the hosted LLM (the part that spends provider keys) requires a
 * signed-in account and is rate-limited. Anonymous callers are rejected; signed
 * in free accounts use the real configured provider when one exists.
 */
export const runPersona = action({
  args: {
    persona: personaValidator,
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    anchor: v.optional(v.string()),
    priorMessages: v.optional(
      v.array(
        v.object({
          author: v.union(v.literal("user"), v.literal("persona")),
          text: v.string(),
        }),
      ),
    ),
    userMessage: v.optional(v.string()),
    instruction: v.optional(
      v.union(
        v.literal("feedback"),
        v.literal("elaborate"),
        v.literal("riff"),
        v.literal("rewrite-suggestion"),
      ),
    ),
    observability: v.optional(
      v.object({
        anonymousId: v.optional(v.string()),
        sessionId: v.optional(v.string()),
        folioId: v.optional(v.string()),
        editorialActionId: v.optional(v.string()),
      }),
    ),
    // Present when the panel is watching. The note then publishes itself into
    // `personaNoteStreams` as it is written instead of landing in one jump.
    streamId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AgentResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");

    // Rate limit on the host-provider path only — the local generator is
    // free, but we gate all calls so a noisy client can't bypass with a
    // draft that's just above MIN_EDITOR_WORDS.
    await consumeRateLimit(ctx, {
      action: "agent:feedback",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentFeedback,
    });

    const req: AgentRequest = {
      persona: args.persona as AgentPersona,
      brief: (args.brief ?? null) as ProjectBrief | null,
      draftText: args.draftText,
      writerProfile: args.writerProfile,
      anchor: args.anchor,
      priorMessages: args.priorMessages as AgentRequest["priorMessages"],
      userMessage: args.userMessage,
      instruction: args.instruction,
    };
    if (countWords(req.draftText) < MIN_EDITOR_WORDS) {
      throw applicationError("validation_failed", {
        message:
          "Write a little more before asking an editor to read the draft.",
      });
    }
    return runHostedAgent(ctx, req, args.observability, args.streamId);
  },
});

/* ── Suggested rewrites (editors propose edits) ─────────────────────── */

export interface RewriteResult {
  replacement: string;
  rationale: string;
  provider: "rivet" | "anthropic" | "openai" | "portkey" | "local";
}

/** Parse the strict-JSON rewrite contract, tolerating code fences / prose. */
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

/**
 * Propose a rewrite of a specific passage, in the persona's voice. Returns a
 * structured replacement + rationale so the editor can render an inline
 * tracked change. The proactive "mark up my draft" pass is the client calling
 * this once per target span under the room's level/budget settings.
 */
export const suggestRewrite = action({
  args: {
    persona: personaValidator,
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    original: v.string(),
    level: v.union(v.literal("sentence"), v.literal("paragraph")),
  },
  handler: async (ctx, args): Promise<RewriteResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");

    // Rate limit: the markup pass fans this out once per target span, so
    // we allow a higher budget than the single-shot feedback path.
    await consumeRateLimit(ctx, {
      action: "agent:rewrite",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentRewrite,
    });

    const persona = args.persona as AgentPersona;
    if (countWords(args.draftText) < MIN_MARKUP_WORDS) {
      throw applicationError("validation_failed", {
        message:
          "Write a little more before asking the room to propose an edit.",
      });
    }
    const provider = await pickProvider(ctx, "persona-rewrite", "balanced");
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const system = buildSystemPrompt(persona);
    const sizeRule =
      args.level === "sentence"
        ? "Keep the replacement to a single sentence."
        : "The replacement may be up to one paragraph, but no longer than the original.";
    const user =
      buildUserPrompt({
        persona,
        brief: (args.brief ?? null) as ProjectBrief | null,
        draftText: args.draftText,
        writerProfile: args.writerProfile,
        instruction: "rewrite-suggestion",
      }) +
      `\n\nREWRITE TASK: Rewrite the PASSAGE below in your voice, preserving its meaning but doing the work better. ${sizeRule}\n` +
      `Respond as JSON only, no prose: {"replacement": "<rewritten passage as plain text>", "rationale": "<one sentence, in your voice>"}\n\n` +
      `PASSAGE:\n"${args.original}"`;

    try {
      const start = Date.now();
      const temperature = persona.temperature ?? 0.4;
      const maxTokens = NO_OUTPUT_CEILING;
      const { text } = await trackedGenerateText(
        {
          ctx,
          ownerId: identity.tokenIdentifier,
          provider,
          feature: "persona-rewrite",
          traceId: createAiTraceId("persona-rewrite"),
        },
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature,
          maxOutputTokens: maxTokens,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "persona_rewrite",
            metadata: {
              feature: "persona-rewrite",
              persona: persona.id,
              provider: provider.label,
              model: provider.modelId,
              level: args.level,
            },
          },
        },
      );
      const visibleText = stripReasoningTags(text);
      await captureServerAiGeneration({
        feature: "persona-rewrite",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona,
          brief: (args.brief ?? null) as ProjectBrief | null,
          draftText: args.draftText,
          writerProfile: args.writerProfile,
          instruction: "rewrite-suggestion",
        },
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "persona_rewrite",
        evalSignals: {
          twyne_expected_format: "json_rewrite",
          twyne_rewrite_level: args.level,
        },
      });
      const parsed = parseRewriteOutput(visibleText);
      if (parsed) {
        await flushArize();
        return { ...parsed, provider: provider.label };
      }
      throw applicationError("malformed_response");
    } catch (err) {
      if (err instanceof Error && err.name === "ConvexError") throw err;
      await captureServerAiGeneration({
        feature: "persona-rewrite",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona,
          brief: (args.brief ?? null) as ProjectBrief | null,
          draftText: args.draftText,
          instruction: "rewrite-suggestion",
        },
        latencyMs: 0,
        spanName: "persona_rewrite",
        error: err,
      });
      throw reportedApplicationError(
        "agents.persona-rewrite",
        "provider_unavailable",
        err,
        { recovery: "retry" },
        { provider: provider.label, model: provider.modelId },
      );
    }
  },
});

/**
 * Run the full editorial board in parallel — convene the room. Each
 * persona reads the same brief + draft and returns a single note. The
 * caller is expected to choose anchor sentences client-side and pass
 * them in `anchors[personaId]`. Falls back to the local generator for
 * any persona whose LLM call fails.
 */
export const conveneRoom = action({
  args: {
    personas: v.array(personaValidator),
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    anchors: v.optional(v.record(v.string(), v.string())),
    /** Passages written since the room last read — the background pass. */
    newMaterial: v.optional(v.string()),
    /** Prose digest of how the draft has been moving. */
    trajectory: v.optional(v.string()),
    observability: v.optional(
      v.object({
        anonymousId: v.optional(v.string()),
        sessionId: v.optional(v.string()),
        folioId: v.optional(v.string()),
        editorialActionId: v.optional(v.string()),
      }),
    ),
    // Present when the panel is watching. Each editor then fills their own
    // card as they write, rather than five notes appearing at once at the end.
    streamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");
    // Rate limit: convene fans out to one LLM call per persona, making it
    // one of the most expensive endpoints.
    await consumeRateLimit(ctx, {
      action: "agent:room",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentRoom,
    });
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const short = countWords(args.draftText) < MIN_EDITOR_WORDS;
    const provider = short
      ? null
      : await pickProvider(ctx, "convene-room", "balanced");
    if (short) {
      throw applicationError("validation_failed", {
        message: "Write a little more before convening the room.",
      });
    }
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const tasks = args.personas.map(async (pRaw) => {
      const persona = pRaw as AgentPersona;
      const anchor = args.anchors?.[persona.id];
      const req: AgentRequest = {
        persona,
        brief,
        draftText: args.draftText,
        writerProfile: args.writerProfile,
        anchor,
        instruction: "feedback",
        newMaterial: args.newMaterial,
        trajectory: args.trajectory,
      };
      try {
        // A background pass reads only the new material, so it needs far
        // fewer tokens than a full convene — and should cost less too.
        return await runLlm(
          ctx,
          identity.tokenIdentifier,
          provider,
          req,
          "persona-feedback",
          NO_OUTPUT_CEILING,
          { ...args.observability, distinctId: identity.tokenIdentifier },
          args.streamId
            ? {
                ctx,
                userId: identity.subject || identity.tokenIdentifier,
                streamId: args.streamId,
                personaId: persona.id,
              }
            : undefined,
        );
      } catch (err) {
        throw reportedApplicationError(
          "agents.convene-room",
          "provider_unavailable",
          err,
          { recovery: "retry" },
          {
            provider: provider.label,
            model: provider.modelId,
          },
        );
      }
    });

    const results = await Promise.all(tasks);
    return results.map((r, i) => ({
      personaId: args.personas[i].id,
      ...r,
    }));
  },
});

/**
 * The expanded cast analysis: each editor writes a full-page memo on the whole
 * document, then the room synthesises them. Sign-in gated and rate-limited like
 * {@link conveneRoom}; falls back to the local generator per persona on error.
 */
export const analyzeRoom = action({
  args: {
    personas: v.array(personaValidator),
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    observability: v.optional(
      v.object({
        anonymousId: v.optional(v.string()),
        sessionId: v.optional(v.string()),
        folioId: v.optional(v.string()),
        editorialActionId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");
    await consumeRateLimit(ctx, {
      action: "agent:room",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentRoom,
    });
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const longEnough = countWords(args.draftText) >= MIN_EDITOR_WORDS;
    const provider = longEnough
      ? await pickProvider(ctx, "analyze-room", "reasoning")
      : null;
    if (!longEnough) {
      throw applicationError("validation_failed", {
        message: "Write a little more before asking for a full room analysis.",
      });
    }
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const memos = await Promise.all(
      args.personas.map(async (pRaw) => {
        const persona = pRaw as AgentPersona;
        const req: AgentRequest = {
          persona,
          brief,
          draftText: args.draftText,
          writerProfile: args.writerProfile,
          instruction: "analyze",
        };
        try {
          const r = await runLlm(
            ctx,
            identity.tokenIdentifier,
            provider,
            req,
            "persona-analysis",
            1600,
            {
              ...args.observability,
              distinctId: identity.tokenIdentifier,
            },
          );
          return { personaId: persona.id, ...r };
        } catch (err) {
          throw reportedApplicationError(
            "agents.analyze-room",
            "provider_unavailable",
            err,
            { recovery: "retry" },
            { provider: provider.label, model: provider.modelId },
          );
        }
      }),
    );

    let synthesis: string;
    try {
      const memoInput: MemoForSynthesis[] = args.personas.map((pRaw, i) => {
        const persona = pRaw as AgentPersona;
        return {
          personaName: persona.name,
          role: persona.role,
          text: memos[i].text,
        };
      });
      synthesis = await runPlainLlm(
        {
          ctx,
          ownerId: identity.tokenIdentifier,
          provider,
          feature: "room-synthesis",
          traceId: createAiTraceId("room-synthesis"),
          editorialActionId: args.observability?.editorialActionId,
          folioId: args.observability?.folioId,
        },
        provider,
        buildSynthesisSystemPrompt(),
        buildSynthesisPrompt(memoInput, brief, args.writerProfile),
        NO_OUTPUT_CEILING,
        "persona-analysis:synthesis",
      );
    } catch (err) {
      throw reportedApplicationError(
        "agents.room-synthesis",
        "provider_unavailable",
        err,
        { recovery: "retry" },
        { provider: provider.label, model: provider.modelId },
      );
    }

    return { memos, synthesis, synthesisProvider: provider.label };
  },
});

/**
 * The full-page narrative review for the rubric. Given the already-computed
 * judge scores and static-feature notes, write the prose that explains the
 * grade. Returns an empty review when hosting is unavailable.
 */
export const reviewRubric = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
    combined: v.number(),
    grade: v.string(),
    judgeMean: v.number(),
    minJudge: v.number(),
    staticTotal: v.number(),
    judges: v.array(
      v.object({
        personaId: v.string(),
        score: v.number(),
        rationale: v.string(),
      }),
    ),
    staticFeedback: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    await consumeRateLimit(ctx, {
      action: "agent:feedback",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentFeedback,
    });
    const provider = await pickProvider(ctx, "rubric-review", "reasoning");
    if (!provider) {
      return { review: "", provider: "local" };
    }
    const brief = (args.brief ?? null) as ProjectBrief | null;
    try {
      const review = await runPlainLlm(
        {
          ctx,
          ownerId: identity.tokenIdentifier,
          provider,
          feature: "rubric-review",
          traceId: createAiTraceId("rubric-review"),
        },
        provider,
        buildRubricReviewSystemPrompt(),
        buildRubricReviewPrompt({
          combined: args.combined,
          grade: args.grade,
          judgeMean: args.judgeMean,
          minJudge: args.minJudge,
          staticTotal: args.staticTotal,
          judges: args.judges,
          staticFeedback: args.staticFeedback,
          brief,
          draftText: args.draftText,
        }),
        NO_OUTPUT_CEILING,
        "rubric-review",
      );
      return { review, provider: provider.label };
    } catch (err) {
      console.error("[twyne:agents] rubric review failed:", err);
      return { review: "", provider: "local" };
    }
  },
});

/**
 * Judge the draft as a given persona would. Used by the multi-judge
 * rubric. Returns a single integer score 1-10 and a one-sentence
 * rationale. Falls back to a deterministic heuristic if no provider.
 */
export const judgeDraft = action({
  args: {
    persona: personaValidator,
    brief: briefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const persona = args.persona as AgentPersona;
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localJudge(persona, brief, args.draftText);
    }
    const provider = await pickProvider(ctx, "rubric-judge", "reasoning");

    if (!provider) {
      return localJudge(persona, brief, args.draftText);
    }

    const system = buildSystemPrompt(persona);
    const rubricSuffix = renderNamed("blocks/persona-rubric-judge-suffix", {
      personaName: persona.name,
    });
    const user =
      buildUserPrompt({
        persona,
        brief,
        draftText: args.draftText,
        instruction: "feedback",
      }) +
      "\n" +
      rubricSuffix;

    try {
      const start = Date.now();
      const temperature = persona.temperature ?? 0.2;
      const maxTokens = NO_OUTPUT_CEILING;
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature,
          maxOutputTokens: maxTokens,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_judge",
            metadata: {
              feature: "rubric-judge",
              persona: persona.id,
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      const visibleText = stripReasoningTags(text);
      await captureServerAiGeneration({
        feature: "rubric-judge",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona,
          brief,
          draftText: args.draftText,
          instruction: "feedback",
        },
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "rubric_judge",
        evalSignals: { twyne_expected_format: "json_score_rationale" },
      });
      const parsed = parseJudgeOutput(visibleText);
      if (parsed) {
        await flushArize();
        return { ...parsed, provider: provider.label };
      }
    } catch (err) {
      console.error(`[twyne:agents] ${persona.id} judge call failed:`, err);
    }
    await flushArize();
    return localJudge(persona, brief, args.draftText);
  },
});

function localSufficiency(
  brief: ProjectBrief | null,
  draftText: string,
): { score: number; rationale: string; provider: "local" } {
  const { score, feedback } = scoreSufficiency(
    draftText,
    brief?.answers.goal ?? null,
  );
  return { score, rationale: feedback, provider: "local" };
}

/**
 * A dedicated LLM judge for evidence quality: does each load-bearing claim
 * actually have support, or is the draft papered over with citation-shaped
 * noise, vague appeals to "studies," and fake specificity that the static
 * citation count can't tell apart from genuine grounding? The density/count
 * heuristic in `scoreStaticFeatures` only runs as the offline/local fallback.
 */
export const judgeEvidence = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localEvidence(brief, args.draftText);
    }
    const provider = await pickProvider(
      ctx,
      "rubric-judge-evidence",
      "reasoning",
    );
    if (!provider) {
      return localEvidence(brief, args.draftText);
    }

    const goal = brief?.answers.goal || "no goal stated in the brief";
    const audience = brief?.answers.audience || "a general reader";
    const staticNote = describeEvidenceStatic(args.draftText);
    const system = buildEvidenceJudgeSystemPrompt();
    const user = buildEvidenceJudgePrompt({
      goal,
      audience,
      draftText: args.draftText,
      staticNote,
    });

    try {
      const start = Date.now();
      const temperature = 0.2;
      const maxTokens = NO_OUTPUT_CEILING;
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature,
          maxOutputTokens: maxTokens,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_judge_evidence",
            metadata: {
              feature: "rubric-judge",
              persona: "evidence",
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      const visibleText = stripReasoningTags(text);
      await captureServerAiGeneration({
        feature: "rubric-judge",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona: {
            id: "evidence",
            name: "Evidence Judge",
            role: "Research editor",
            description:
              "Judges whether the draft's evidence actually supports its claims.",
            focus: "Quality of evidence and grounding of claims",
          },
          brief,
          draftText: args.draftText,
          instruction: "feedback",
        },
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "rubric_judge_evidence",
        evalSignals: { twyne_expected_format: "json_score_rationale" },
      });
      const parsed = parseJudgeOutput(visibleText);
      if (parsed) {
        await flushArize();
        return { ...parsed, provider: provider.label };
      }
    } catch (err) {
      console.error("[twyne:agents] evidence judge call failed:", err);
    }
    await flushArize();
    return localEvidence(brief, args.draftText);
  },
});

/**
 * A dedicated LLM judge for bullshit resistance: confident-sounding prose
 * that doesn't pay rent — vague filler dressed as insight, universal claims,
 * fake specificity, polished-but-empty passages. Regex-based bullshit
 * detection misses the sophisticated forms and false-positives on legitimate
 * emphasis, so this is judged; the regex heuristics in `scoreStaticFeatures`
 * only run as the offline/local fallback.
 */
export const judgeIntegrity = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localIntegrity(args.draftText);
    }
    const provider = await pickProvider(
      ctx,
      "rubric-judge-integrity",
      "reasoning",
    );
    if (!provider) {
      return localIntegrity(args.draftText);
    }

    const goal = brief?.answers.goal || "no goal stated in the brief";
    const audience = brief?.answers.audience || "a general reader";
    const staticNote = describeIntegrityStatic(args.draftText);
    const system = buildIntegrityJudgeSystemPrompt();
    const user = buildIntegrityJudgePrompt({
      goal,
      audience,
      draftText: args.draftText,
      staticNote,
    });

    try {
      const start = Date.now();
      const temperature = 0.2;
      const maxTokens = NO_OUTPUT_CEILING;
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature,
          maxOutputTokens: maxTokens,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_judge_integrity",
            metadata: {
              feature: "rubric-judge",
              persona: "integrity",
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      const visibleText = stripReasoningTags(text);
      await captureServerAiGeneration({
        feature: "rubric-judge",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona: {
            id: "integrity",
            name: "Integrity Judge",
            role: "Bullshit detector",
            description:
              "Judges whether the draft's confident prose is actually earning its claims.",
            focus:
              "Bullshit resistance: vague filler, fake specificity, universal claims, polished emptiness",
          },
          brief,
          draftText: args.draftText,
          instruction: "feedback",
        },
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "rubric_judge_integrity",
        evalSignals: { twyne_expected_format: "json_score_rationale" },
      });
      const parsed = parseJudgeOutput(visibleText);
      if (parsed) {
        await flushArize();
        return { ...parsed, provider: provider.label };
      }
    } catch (err) {
      console.error("[twyne:agents] integrity judge call failed:", err);
    }
    await flushArize();
    return localIntegrity(args.draftText);
  },
});

/* ── Local fallbacks for the dedicated judges ──────────────────── */

function localEvidence(
  brief: ProjectBrief | null,
  draftText: string,
): { score: number; rationale: string; provider: "local" } {
  const features = scoreStaticFeatures(draftText).features;
  const density = features.citationDensity;
  let score: number;
  if (features.citationCount === 0) {
    score = clampScore(features.paragraphCount > 0 ? 3 : 1);
  } else if (density >= 1.5 && density <= 6) {
    score = 7;
  } else if (density < 1.5) {
    score = 5;
  } else {
    score = 4;
  }
  const audience = brief?.answers.audience || "the intended reader";
  const rationale = `${features.citationCount} citation-like reference${
    features.citationCount === 1 ? "" : "s"
  } (${density.toFixed(1)} per 1,000 words). This counts shape, not substance — judge locally only; production runs route through the LLM judge to catch padded or fake grounding. For ${audience}, evidence has to earn its claim.`;
  return { score, rationale, provider: "local" };
}

function localIntegrity(draftText: string): {
  score: number;
  rationale: string;
  provider: "local";
} {
  const features = scoreStaticFeatures(draftText).features;
  const deduction =
    features.unsupportedUniversalClaimCount * 0.6 +
    features.duplicateParagraphRatio * 60;
  const score = clampScore(
    deduction > 0 ? Math.max(1, 10 - Math.round(deduction)) : 7,
  );
  const rationale = `${features.unsupportedUniversalClaimCount} unsupported universal claim${
    features.unsupportedUniversalClaimCount === 1 ? "" : "s"
  }, ${(features.fillerWordRatio * 100).toFixed(1)}% filler, ${(
    features.vagueWordRatio * 100
  ).toFixed(1)}% vague wording, ${(
    features.duplicateParagraphRatio * 100
  ).toFixed(
    0,
  )}% duplicated paragraphs. Regex misses sophisticated bullshit and false-positives on legitimate emphatic prose — judge locally only; production runs route through the LLM judge.`;
  return { score, rationale, provider: "local" };
}

function describeEvidenceStatic(draftText: string): string {
  const f = scoreStaticFeatures(draftText).features;
  return `Citation count: ${f.citationCount}, citation density: ${f.citationDensity.toFixed(
    1,
  )} per 1,000 words, paragraphs: ${f.paragraphCount}.`;
}

function describeIntegrityStatic(draftText: string): string {
  const f = scoreStaticFeatures(draftText).features;
  return `Unsupported universal claims (regex): ${f.unsupportedUniversalClaimCount}; filler ratio: ${(
    f.fillerWordRatio * 100
  ).toFixed(1)}%; vague-wording ratio: ${(f.vagueWordRatio * 100).toFixed(
    1,
  )}%; duplicated paragraphs: ${(f.duplicateParagraphRatio * 100).toFixed(0)}%.`;
}

/**
 * A dedicated LLM judge for one question only: does the draft develop
 * enough on-topic material to justify reaching its stated thesis/goal?
 * Keyword overlap can't tell a well-earned argument from a hollow one, so
 * this is judged, not measured — the keyword heuristic in
 * `scoreSufficiency` only runs as the offline/local fallback.
 */
export const judgeSufficiency = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localSufficiency(brief, args.draftText);
    }
    const provider = await pickProvider(
      ctx,
      "rubric-judge-sufficiency",
      "reasoning",
    );
    if (!provider) {
      return localSufficiency(brief, args.draftText);
    }

    const goal = brief?.answers.goal || "no goal stated in the brief";
    const audience = brief?.answers.audience || "a general reader";
    const system = renderNamed("sufficiency-judge-system");
    const user = renderNamed("sufficiency-judge-user", {
      goal,
      audience,
      draftText: args.draftText,
    });

    try {
      const start = Date.now();
      const temperature = 0.2;
      const maxTokens = NO_OUTPUT_CEILING;
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature,
          maxOutputTokens: maxTokens,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_judge_sufficiency",
            metadata: {
              feature: "rubric-judge",
              persona: "sufficiency",
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      const visibleText = stripReasoningTags(text);
      await captureServerAiGeneration({
        feature: "rubric-judge",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona: {
            id: "sufficiency",
            name: "Sufficiency Judge",
            role: "Developmental editor",
            description:
              "Judges whether the draft develops enough on-topic material to earn its goal.",
            focus:
              "Sufficiency of development relative to the stated thesis/goal",
          },
          brief,
          draftText: args.draftText,
          instruction: "feedback",
        },
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "rubric_judge_sufficiency",
        evalSignals: { twyne_expected_format: "json_score_rationale" },
      });
      const parsed = parseJudgeOutput(visibleText);
      if (parsed) {
        await flushArize();
        return { ...parsed, provider: provider.label };
      }
    } catch (err) {
      console.error("[twyne:agents] sufficiency judge call failed:", err);
    }
    await flushArize();
    return localSufficiency(brief, args.draftText);
  },
});

/* ── Target fit: the relevance gate ─────────────────────────────── */

/**
 * The offline fallback for {@link judgeTargetFit}. Keyword overlap between the
 * goal and the draft is a crude proxy for relevance, so this deliberately
 * refuses to be confident: it returns a mid-scale score rather than a verdict,
 * because wrongly calling an on-target draft irrelevant is far more damaging
 * than failing to catch an off-target one.
 */
function localTargetFit(
  brief: ProjectBrief | null,
  draftText: string,
): { score: number; rationale: string; provider: "local" } {
  if (!brief?.answers.goal?.trim() && !brief?.answers.audience?.trim()) {
    return {
      score: 10,
      rationale:
        "No audience or goal filed in the dossier, so there is nothing to measure relevance against. Fill in the brief and this criterion starts doing real work.",
      provider: "local",
    };
  }
  const { score } = scoreSufficiency(draftText, brief?.answers.goal ?? null);
  // Pull toward the middle: the heuristic is not trustworthy enough to gate on.
  const damped = clampScore(Math.round(5 + (score - 5) * 0.5));
  return {
    score: damped,
    rationale: `Judged locally by keyword overlap with the stated goal, which cannot tell a genuinely on-topic argument from one that merely repeats the brief's vocabulary. Treat this as a weak signal; the hosted judge reads for real relevance.`,
    provider: "local",
  };
}

/**
 * A dedicated LLM judge for one question only: does this content serve THIS
 * audience, THIS goal, in THIS format — at all? It is deliberately blind to
 * craft. A beautifully written piece about the wrong subject scores 1 here.
 *
 * This is the gate that stops the static shape metrics (pacing, type-token
 * ratio, paragraph balance) from awarding high marks to fluent irrelevance:
 * the client caps every shape-derived criterion by this score and scales the
 * static weight in the combined grade by it.
 */
export const judgeTargetFit = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localTargetFit(brief, args.draftText);
    }
    const provider = await pickProvider(
      ctx,
      "rubric-judge-target-fit",
      "reasoning",
    );
    if (!provider) {
      return localTargetFit(brief, args.draftText);
    }

    const system = buildTargetFitJudgeSystemPrompt();
    const user = buildTargetFitJudgePrompt({
      ...targetFitCommission(brief),
      draftText: args.draftText,
      particulars: probeParticularsBlock(brief),
    });

    try {
      const start = Date.now();
      const temperature = 0.2;
      const maxTokens = NO_OUTPUT_CEILING;
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature,
          maxOutputTokens: maxTokens,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_judge_target_fit",
            metadata: {
              feature: "rubric-judge",
              persona: "target-fit",
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      const visibleText = stripReasoningTags(text);
      await captureServerAiGeneration({
        feature: "rubric-judge",
        provider: provider.label,
        model: provider.modelId,
        req: {
          persona: {
            id: "target-fit",
            name: "Target Fit Judge",
            role: "Commissioning editor",
            description:
              "Judges whether the draft serves the commissioned audience and goal at all.",
            focus: "Relevance to the stated audience, goal and format",
          },
          brief,
          draftText: args.draftText,
          instruction: "feedback",
        },
        output: visibleText,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "rubric_judge_target_fit",
        evalSignals: { twyne_expected_format: "json_score_rationale" },
      });
      const parsed = parseJudgeOutput(visibleText);
      if (parsed) {
        await flushArize();
        return { ...parsed, provider: provider.label };
      }
    } catch (err) {
      console.error("[twyne:agents] target-fit judge call failed:", err);
    }
    await flushArize();
    return localTargetFit(brief, args.draftText);
  },
});

/* ── Writer-defined rubric criteria ─────────────────────────────── */

/**
 * Judge the draft against a criterion the writer wrote themselves.
 *
 * Generic by design: the writer's words go in as the standard, and the model
 * is told to judge that and nothing else. That is what lets someone grading a
 * second-person travel piece add "does it stay in second person" and get a
 * real score, without Twyne having to anticipate the criterion.
 */
export const judgeCustomCriterion = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
    label: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");
    await consumeRateLimit(ctx, {
      action: "agent:feedback",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentFeedback,
    });

    const brief = (args.brief ?? null) as ProjectBrief | null;
    const label = args.label.trim().slice(0, 120);
    if (!label) {
      throw applicationError("validation_failed", {
        message: "A custom criterion needs a name.",
      });
    }
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return {
        score: 5,
        rationale: `The draft is too short to judge against "${label}" yet.`,
        provider: "local" as const,
      };
    }
    const provider = await pickProvider(
      ctx,
      "rubric-judge-custom",
      "reasoning",
    );
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const system = buildCustomCriterionSystemPrompt();
    const user = buildCustomCriterionPrompt({
      ...targetFitCommission(brief),
      label,
      description: args.description,
      draftText: args.draftText,
    });

    try {
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature: 0.2,
          maxOutputTokens: NO_OUTPUT_CEILING,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_judge_custom",
            metadata: {
              feature: "rubric-judge",
              persona: "custom",
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      const parsed = parseJudgeOutput(stripReasoningTags(text));
      await flushArize();
      if (parsed) return { ...parsed, provider: provider.label };
      throw applicationError("malformed_response");
    } catch (err) {
      if (err instanceof Error && err.name === "ConvexError") throw err;
      throw reportedApplicationError(
        "agents.rubric-judge-custom",
        "provider_unavailable",
        err,
        { recovery: "retry" },
        { provider: provider.label, model: provider.modelId },
      );
    }
  },
});

/**
 * Propose criteria fitted to this particular piece. The writer accepts them
 * into their rubric or ignores them — nothing here is applied automatically,
 * which is what keeps the score comparable between passes.
 */
export const suggestRubricCriteria = action({
  args: {
    brief: briefValidator,
    draftText: v.optional(v.string()),
    existingLabels: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");
    await consumeRateLimit(ctx, {
      action: "agent:feedback",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentFeedback,
    });

    const brief = (args.brief ?? null) as ProjectBrief | null;
    const provider = await pickProvider(
      ctx,
      "rubric-suggest-criteria",
      "reasoning",
    );
    if (!provider) {
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    }

    const { audience, goal, format, successSignal } =
      targetFitCommission(brief);
    const tone = brief?.answers.tone?.trim() || "unspecified";
    const constraints = brief?.answers.constraints?.trim() || "none stated";

    const system = `You design editorial rubrics. Given what a piece is trying to be, you propose the few standards that would actually discriminate between a good version of THAT piece and a mediocre one.

Good criteria are specific to the form and the commission: a reported feature needs different standards from a technical memo, a eulogy, or a comic monologue. Bad criteria are the generic ones every rubric already has — "clarity", "grammar", "structure", "engaging" — and you never propose those.

Each criterion must be judgeable from the draft alone by reading it once.`;

    const user = `THE PIECE
- Format: ${format}
- Audience: ${audience}
- Goal: ${goal}
- Tone: ${tone}
- Constraints: ${constraints}
- Success signal: ${successSignal}

ALREADY IN THE RUBRIC (do not propose these again, or near-duplicates of them):
${args.existingLabels.map((l) => `- ${l}`).join("\n") || "- (nothing yet)"}
${
  args.draftText?.trim()
    ? `\nAN EXCERPT OF THE DRAFT, for a sense of what the writer is actually doing:\n${args.draftText.trim().slice(0, 2500)}\n`
    : ""
}
TASK: Propose 3 to 5 criteria specific to this piece. For each, give a short name (2-5 words) and one sentence stating what a strong version looks like.

Respond as JSON, and only JSON, in this exact shape:
{"criteria": [{"label": "<2-5 words>", "description": "<one sentence>"}]}`;

    try {
      const { text } = await trackedGenerateText(
        newHostedUsageCapture(
          ctx,
          identity.tokenIdentifier,
          provider,
          "rubric-judge",
        ),
        1,
        {
          model: provider.model,
          system,
          prompt: user,
          temperature: 0.5,
          maxOutputTokens: NO_OUTPUT_CEILING,
          experimental_telemetry: {
            isEnabled: tracingEnabled,
            functionId: "rubric_suggest_criteria",
            metadata: {
              feature: "rubric-judge",
              provider: provider.label,
              model: provider.modelId,
            },
          },
        },
      );
      await flushArize();
      const parsed = parseSuggestedCriteria(stripReasoningTags(text));
      if (parsed.length > 0)
        return { criteria: parsed, provider: provider.label };
      throw applicationError("malformed_response");
    } catch (err) {
      if (err instanceof Error && err.name === "ConvexError") throw err;
      throw reportedApplicationError(
        "agents.rubric-suggest-criteria",
        "provider_unavailable",
        err,
        { recovery: "retry" },
        { provider: provider.label, model: provider.modelId },
      );
    }
  },
});

/** Parse the criteria-suggestion contract, tolerating fences and stray prose. */
function parseSuggestedCriteria(
  text: string,
): Array<{ label: string; description: string }> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const candidates = [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0] ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as {
        criteria?: Array<{ label?: unknown; description?: unknown }>;
      };
      const list = Array.isArray(parsed.criteria) ? parsed.criteria : [];
      const out = list
        .map((c) => ({
          label:
            typeof c.label === "string" ? c.label.trim().slice(0, 120) : "",
          description:
            typeof c.description === "string"
              ? c.description.trim().slice(0, 400)
              : "",
        }))
        .filter((c) => c.label);
      if (out.length > 0) return out.slice(0, 5);
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/**
 * Run all five judges in parallel, then a single overall-summary call
 * that takes the judges' rationales and produces a one-paragraph
 * editorial note. Used by the multi-judge rubric panel.
 */
export const judgeRoom = action({
  args: {
    personas: v.array(personaValidator),
    brief: briefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const provider =
      countWords(args.draftText) >= MIN_RUBRIC_WORDS
        ? await pickProvider(ctx, "rubric-judge-room", "reasoning")
        : null;
    const canHost =
      countWords(args.draftText) >= MIN_RUBRIC_WORDS && !!provider;
    if (!canHost) {
      return args.personas.map((p) => {
        const persona = p as AgentPersona;
        return {
          ...localJudge(persona, brief, args.draftText),
          personaId: persona.id,
        };
      });
    }

    const judgeTasks = args.personas.map((p) =>
      (async () => {
        const persona = p as AgentPersona;
        if (!provider) {
          return {
            ...localJudge(persona, brief, args.draftText),
            personaId: persona.id,
          };
        }
        try {
          const system = buildSystemPrompt(persona);
          const user =
            buildUserPrompt({
              persona,
              brief,
              draftText: args.draftText,
              instruction: "feedback",
            }) +
            `

JUDGE TASK: Give the draft an integer score from 1 to 10. 5 is "doing the work but with clear issues." 7 is "in good shape." 9 is "publishable as-is." Be honest.

Do not reward confident-sounding bullshit. Penalize generic filler, repeated paragraphs, unsupported universal claims, vibes without evidence, fake specificity, and any passage that sounds polished while dodging the stated audience/goal.

Respond with JSON only: {"score": <int>, "rationale": "<one sentence in your voice>"}`;
          const start = Date.now();
          const temperature = 0.2;
          const maxTokens = NO_OUTPUT_CEILING;
          const { text } = await trackedGenerateText(
            newHostedUsageCapture(
              ctx,
              identity.tokenIdentifier,
              provider,
              "rubric-judge",
            ),
            1,
            {
              model: provider.model,
              system,
              prompt: user,
              temperature,
              maxOutputTokens: maxTokens,
              experimental_telemetry: {
                isEnabled: tracingEnabled,
                functionId: "rubric_judge_room",
                metadata: {
                  feature: "rubric-judge",
                  persona: persona.id,
                  provider: provider.label,
                  model: provider.modelId,
                },
              },
            },
          );
          const visibleText = stripReasoningTags(text);
          await captureServerAiGeneration({
            feature: "rubric-judge",
            provider: provider.label,
            model: provider.modelId,
            req: {
              persona,
              brief,
              draftText: args.draftText,
              instruction: "feedback",
            },
            output: visibleText,
            latencyMs: Date.now() - start,
            temperature,
            maxTokens,
            spanName: "rubric_judge_room",
            evalSignals: { twyne_expected_format: "json_score_rationale" },
          });
          const parsed = parseJudgeOutput(visibleText);
          if (parsed) {
            await flushArize();
            return { ...parsed, personaId: persona.id };
          }
        } catch (err) {
          console.error(`[twyne:agents] ${persona.id} judge call failed:`, err);
        }
        await flushArize();
        return {
          ...localJudge(persona, brief, args.draftText),
          personaId: persona.id,
        };
      })(),
    );

    return await Promise.all(judgeTasks);
  },
});

/* ── Helpers ────────────────────────────────────────────────────── */

async function runHostedAgent(
  ctx: ActionCtx,
  req: AgentRequest,
  observability?: ServerAiObservabilityContext,
  streamId?: string,
): Promise<AgentResponse> {
  const feature =
    req.userMessage || req.priorMessages?.length
      ? "persona-reply"
      : "persona-feedback";
  const provider = await pickProvider(ctx, feature, "balanced");
  if (!provider) {
    throw applicationError("provider_unavailable", {
      recovery: "open_settings",
    });
  }
  try {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject || identity?.tokenIdentifier;
    if (!identity) throw applicationError("authentication_required");
    return await runLlm(
      ctx,
      identity.tokenIdentifier,
      provider,
      req,
      feature,
      NO_OUTPUT_CEILING,
      { ...observability, distinctId: identity?.tokenIdentifier },
      streamId && userId
        ? { ctx, userId, streamId, personaId: req.persona.id }
        : undefined,
    );
  } catch (err) {
    throw reportedApplicationError(
      `agents.${feature}`,
      "provider_unavailable",
      err,
      { recovery: "retry" },
      {
        provider: provider.label,
        model: provider.modelId,
      },
    );
  }
}

function localJudge(
  persona: AgentPersona,
  brief: ProjectBrief | null,
  draftText: string,
): { score: number; rationale: string; provider: "local" } {
  const wc = draftText.split(/\s+/).filter(Boolean).length;
  const hasBrief = !!brief;
  const hasBody = wc > 80;
  let base = 3;
  if (hasBrief) base += 1;
  if (hasBody) base += 1;
  if (wc > 350) base += 1;
  if (wc > 800) base += 1;

  // Persona-shaped adjustments — each persona reads different things.
  const id = persona.id;
  let bias = 0;
  let rationale =
    "The draft is partial; the work to come is the interesting part.";
  if (id === "devil") {
    bias = wc < 200 ? -1 : 0;
    rationale =
      wc < 200
        ? "The argument is still under construction; the load-bearing claim is not yet visible."
        : "The argument moves, but the strongest counter-objection is still unstated.";
  } else if (id === "angel") {
    bias = hasBody ? 1 : 0;
    rationale = hasBody
      ? "There is at least one paragraph doing real work; protect it."
      : "The opening gestures are honest; trust them, then add weight.";
  } else if (id === "scholar") {
    bias = -1; // be strict on evidence
    rationale = "Claims outrun evidence; the bibliography is thin.";
  } else if (id === "editor") {
    bias = wc > 200 ? 0 : -1;
    rationale =
      wc > 200
        ? "Sentences are present, but rhythm and concision need a pass."
        : "The draft is too short to evaluate the cut; write more first.";
  } else if (id === "reader") {
    bias = hasBrief ? 0 : -1;
    rationale = hasBrief
      ? "As the named audience, I would keep reading past the open."
      : "Without a clear audience, the opening is interesting but slippery.";
  }
  return { score: clampScore(base + bias), rationale, provider: "local" };
}

/* ── Internal: allow other Convex files to call the runner. ─────── */

export { runLlm, pickProvider };
