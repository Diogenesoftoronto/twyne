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
import { generateText, stepCountIs, type LanguageModel } from "ai";
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
  DossierProbe,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../src/types";
import { normalizeProbe } from "../src/utils/dossier-probes";
import { stripReasoningTags } from "../src/utils/reasoning-tags";
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

/* ── Provider selection ─────────────────────────────────────────── */

interface ProviderConfig {
  model: LanguageModel;
  label: "rivet" | "anthropic" | "openai" | "portkey";
  /** Default model id used by this provider. */
  modelId: string;
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

async function runLlm(
  provider: ProviderConfig,
  req: AgentRequest,
  feature:
    | "persona-feedback"
    | "persona-reply"
    | "persona-analysis" = "persona-feedback",
  maxTokens = 380,
): Promise<AgentResponse> {
  const system = buildSystemPrompt(req.persona);
  const user = buildUserPrompt(req);
  const fallbackType: FeedbackType = defaultTypeForPersona(req.persona);
  const temperature = provider.label === "openai" ? 0.6 : 0.4;
  const start = Date.now();
  const { tools, getAnchor } = buildQuoteTools(req.draftText);

  try {
    const { text } = await generateText({
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
    });
    let visibleText = stripReasoningTags(text);
    // Reasoning models can wrap the whole reply in <think>; regenerate once
    // so the note is never blank, then fall back to the raw text.
    if (!visibleText) {
      const retry = await generateText({
        model: provider.model,
        system,
        prompt: `${user}\n\nRespond with your note as plain visible text. Do not place your whole answer inside <think> tags.`,
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
      visibleText = stripReasoningTags(retry.text) || retry.text.trim();
    }
    await captureServerAiGeneration({
      feature,
      provider: provider.label,
      model: provider.modelId,
      req,
      output: visibleText,
      latencyMs: Date.now() - start,
      temperature,
      maxTokens,
      spanName: feature,
    });

    const cleaned = visibleText.trim();
    await flushArize();
    return {
      text: cleaned || "(no response)",
      type: classifyType(cleaned, fallbackType),
      provider: provider.label,
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
  provider: ProviderConfig,
  system: string,
  user: string,
  maxTokens: number,
  feature: string,
): Promise<string> {
  const gen = async (prompt: string, suffix?: string) =>
    generateText({
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
  if (!visible) {
    const retry = await gen(
      `${user}\n\nRespond with plain visible text. Do not place your whole answer inside <think> tags.`,
      "retry",
    );
    visible = stripReasoningTags(retry.text) || retry.text.trim();
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
  voice: v.optional(v.string()),
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
  answer: v.optional(
    v.union(v.string(), v.array(v.string()), v.number()),
  ),
  relatesTo: v.optional(v.string()),
});

const briefValidator = v.union(
  v.null(),
  v.object({
    answers: projectInterviewAnswersValidator,
    attachments: v.array(attachmentValidator),
    probes: v.optional(v.array(probeValidator)),
    completedAt: v.number(),
    updatedAt: v.number(),
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
): string {
  return [
    "You are a kind, incisive editorial interviewer helping a writer build a project dossier.",
    "Ask one question at a time. Keep it short. You are building a writer's room: identify the piece, reader, goal, tone, constraints, success signal, and what kind of advisors/editors the writer wants around it.",
    'After every ordinary question, append `DOSSIER:` followed by JSON { "brief": { workingTitle, format, audience, goal, tone, constraints, successSignal }, "confidence": { field: "high" | "medium" | "low" } }. Only include fields you can reasonably infer.',
    "",
    "SOMETIMES A QUESTION IS BETTER ASKED AS A CONTROL THAN AS PROSE. When the writer's last answer was vague, hedged, or covered two possibilities at once, and a typed question would pin it down in one tap, append `PROBE:` followed by JSON for exactly one of:",
    '  { "kind": "choice", "prompt": "<question>", "options": ["<2-6 options>"], "relatesTo": "<brief field>" }',
    '  { "kind": "multi", "prompt": "<question>", "options": ["<2-6 options>"], "relatesTo": "<brief field>" }',
    '  { "kind": "blanks", "prompt": "<instruction>", "template": "<a sentence with ___ where the writer fills in>", "relatesTo": "<brief field>" }',
    '  { "kind": "scale", "prompt": "<question>", "min": 1, "max": 5, "minLabel": "<what 1 means>", "maxLabel": "<what 5 means>", "relatesTo": "<brief field>" }',
    "Rules for probes: at most one per turn, and only when it genuinely narrows something. Never ask a probe whose answer you already have. Options must be concrete and mutually distinct — not 'clear / unclear'. `relatesTo` must be one of workingTitle, format, audience, goal, tone, constraints, successSignal. Still write your question text as normal prose above the tag; the probe is how they answer it, not a replacement for asking.",
    "",
    "When the dossier is complete enough for review, respond only with `SYNTHESIZE:` followed by the same JSON shape as DOSSIER. Put requested advisors/editors into constraints or goal until the product has a dedicated advisor schema.",
    mode === "refine" && currentBrief
      ? `Existing dossier: ${JSON.stringify(currentBrief.answers)} — refine it, don't restart.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
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
    const maxTokens = 420;
    try {
      const { text } = await generateText({
        model: provider.model,
        system: interviewSystemPrompt(
          args.mode,
          (args.currentBrief ?? null) as ProjectBrief | null,
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
      });
      await flushArize();
      return parseInterviewTurnResult(
        text,
        provider.label,
        provider.modelId,
        args.messages as InterviewMessage[],
      );
    } catch (error) {
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
    return runHostedAgent(ctx, req);
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
        instruction: "rewrite-suggestion",
      }) +
      `\n\nREWRITE TASK: Rewrite the PASSAGE below in your voice, preserving its meaning but doing the work better. ${sizeRule}\n` +
      `Respond as JSON only, no prose: {"replacement": "<rewritten passage as plain text>", "rationale": "<one sentence, in your voice>"}\n\n` +
      `PASSAGE:\n"${args.original}"`;

    try {
      const start = Date.now();
      const temperature = 0.4;
      const maxTokens = 320;
      const { text } = await generateText({
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
      });
      const visibleText = stripReasoningTags(text);
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
    anchors: v.optional(v.record(v.string(), v.string())),
    /** Passages written since the room last read — the background pass. */
    newMaterial: v.optional(v.string()),
    /** Prose digest of how the draft has been moving. */
    trajectory: v.optional(v.string()),
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
        anchor,
        instruction: "feedback",
        newMaterial: args.newMaterial,
        trajectory: args.trajectory,
      };
      try {
        // A background pass reads only the new material, so it needs far
        // fewer tokens than a full convene — and should cost less too.
        return await runLlm(
          provider,
          req,
          "persona-feedback",
          args.newMaterial ? 220 : 380,
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
          instruction: "analyze",
        };
        try {
          const r = await runLlm(provider, req, "persona-analysis", 1600);
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
        provider,
        buildSynthesisSystemPrompt(),
        buildSynthesisPrompt(memoInput, brief),
        1400,
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
        1400,
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
    const user =
      buildUserPrompt({
        persona,
        brief,
        draftText: args.draftText,
        instruction: "feedback",
      }) +
      `

JUDGE TASK: As ${persona.name}, give the draft a single integer score from 1 to 10. A score of 5 means "the draft is doing the work for the stated audience and goal but has clear, fixable issues." A score of 7 means "the draft is in good shape and the issues are minor." A score of 9 means "publishable as-is." Be honest; most first drafts are in the 3-5 range.

Do not reward confident-sounding bullshit. Penalize generic filler, repeated paragraphs, unsupported universal claims, vibes without evidence, fake specificity, and any passage that sounds polished while dodging the stated audience/goal.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence, your voice>"}`;

    try {
      const start = Date.now();
      const temperature = 0.2;
      const maxTokens = 220;
      const { text } = await generateText({
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
      });
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
      const maxTokens = 200;
      const { text } = await generateText({
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
      });
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
      const maxTokens = 200;
      const { text } = await generateText({
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
      });
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
    const system = `You are a rigorous developmental editor. You judge exactly one thing: whether a draft develops ENOUGH on-topic material — evidence, examples, reasoning, scenes, argumentation — to actually earn its stated thesis or goal. A draft can be clean, well-organized prose and still fail this if it asserts its point without building the case, drifts off-topic, or stops short of the goal. Do not reward confident assertion in place of development.`;
    const user = `GOAL: ${goal}
AUDIENCE: ${audience}

DRAFT:
${args.draftText}

JUDGE TASK: Give an integer score from 1 to 10 for whether the draft develops enough on-topic material to justify reaching its stated goal. 1 means mostly assertion, filler, or off-topic drift; 10 means the development fully earns the goal. Most first drafts land 3-6.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence>"}`;

    try {
      const start = Date.now();
      const temperature = 0.2;
      const maxTokens = 200;
      const { text } = await generateText({
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
      });
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
      const maxTokens = 200;
      const { text } = await generateText({
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
      });
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
      const { text } = await generateText({
        model: provider.model,
        system,
        prompt: user,
        temperature: 0.2,
        maxOutputTokens: 220,
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
      });
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
      const { text } = await generateText({
        model: provider.model,
        system,
        prompt: user,
        temperature: 0.5,
        maxOutputTokens: 600,
        experimental_telemetry: {
          isEnabled: tracingEnabled,
          functionId: "rubric_suggest_criteria",
          metadata: {
            feature: "rubric-judge",
            provider: provider.label,
            model: provider.modelId,
          },
        },
      });
      await flushArize();
      const parsed = parseSuggestedCriteria(stripReasoningTags(text));
      if (parsed.length > 0) return { criteria: parsed, provider: provider.label };
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
          label: typeof c.label === "string" ? c.label.trim().slice(0, 120) : "",
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
          const maxTokens = 200;
          const { text } = await generateText({
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
          });
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
    return await runLlm(provider, req, feature);
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
