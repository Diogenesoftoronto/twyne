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

import { action } from "./_generated/server";
import { v } from "convex/values";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  buildSystemPrompt,
  buildUserPrompt,
  generateLocalFeedback,
  buildSynthesisSystemPrompt,
  buildSynthesisPrompt,
  buildRubricReviewSystemPrompt,
  buildRubricReviewPrompt,
  type AgentPersona,
  type AgentRequest,
  type AgentResponse,
  type FeedbackType,
  type MemoForSynthesis,
} from "./agentPrompts";
import { buildQuoteTools } from "./agentTools";
import type { ProjectBrief, ProjectInterviewAnswers } from "../src/types";
import { stripReasoningTags } from "../src/utils/reasoning-tags";
import { captureServerAiGeneration } from "./posthog";
import {
  countWords,
  MIN_EDITOR_WORDS,
  MIN_MARKUP_WORDS,
  MIN_RUBRIC_WORDS,
} from "../src/utils/draft-thresholds";
import { userIsPro } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";

/* ── Provider selection ─────────────────────────────────────────── */

interface ProviderConfig {
  model: LanguageModel;
  label: "rivet" | "anthropic" | "openai" | "bifrost";
  /** Default model id used by this provider. */
  modelId: string;
}

function pickProvider(): ProviderConfig | null {
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

  const bifrostUrl = process.env.BIFROST_BASE_URL;
  if (bifrostUrl) {
    const modelId =
      process.env.BIFROST_DEFAULT_MODEL ?? "neuralwatt/qwen3.5-397b-fast";
    const bifrostKey = process.env.BIFROST_API_KEY;
    const bifrost = createOpenAI({
      baseURL: bifrostUrl.replace(/\/$/, ""),
      apiKey: "bifrost-dummy",
      headers: bifrostKey ? { "x-bifrost-api-key": bifrostKey } : undefined,
    });
    return {
      model: bifrost.chat(modelId),
      label: "bifrost",
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
): Promise<string> {
  const gen = async (prompt: string) =>
    generateText({
      model: provider.model,
      system,
      prompt,
      temperature: 0.4,
      maxOutputTokens: maxTokens,
    });
  const { text } = await gen(user);
  let visible = stripReasoningTags(text);
  if (!visible) {
    const retry = await gen(
      `${user}\n\nRespond with plain visible text. Do not place your whole answer inside <think> tags.`,
    );
    visible = stripReasoningTags(retry.text) || retry.text.trim();
  }
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

const briefValidator = v.union(v.null(), v.any());

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

function interviewSystemPrompt(
  mode: "first-run" | "refine",
  currentBrief: ProjectBrief | null,
): string {
  return [
    "You are a kind, incisive editorial interviewer helping a writer build a project dossier.",
    "Ask one question at a time. Keep it short. You are building a writer's room: identify the piece, reader, goal, tone, constraints, success signal, and what kind of advisors/editors the writer wants around it.",
    'After every ordinary question, append `DOSSIER:` followed by JSON { "brief": { workingTitle, format, audience, goal, tone, constraints, successSignal }, "confidence": { field: "high" | "medium" | "low" } }. Only include fields you can reasonably infer.',
    "When the dossier is complete enough for review, respond only with `SYNTHESIZE:` followed by the same JSON shape. Put requested advisors/editors into constraints or goal until the product has a dedicated advisor schema.",
    mode === "refine" && currentBrief
      ? `Existing dossier: ${JSON.stringify(currentBrief.answers)} — refine it, don't restart.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractTaggedJson(
  text: string,
  tag: "DOSSIER" | "SYNTHESIZE",
): { value: unknown; start: number; end: number } | null {
  const marker = new RegExp(`${tag}:`, "i").exec(text);
  if (!marker) return null;
  const open = text.indexOf("{", marker.index + marker[0].length);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return {
            value: JSON.parse(text.slice(open, i + 1)),
            start: marker.index,
            end: i + 1,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
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

function stripTaggedJson(
  text: string,
  segment: { start: number; end: number },
) {
  return `${text.slice(0, segment.start)}${text.slice(segment.end)}`.trim();
}

function parseInterviewTurnResult(
  text: string,
  provider: string,
  model: string,
  messages: InterviewMessage[],
): InterviewTurnResult {
  const visibleText = stripReasoningTags(text);
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
      // Fall through to question parsing.
    }
  }

  const dossierSegment = extractTaggedJson(visibleText, "DOSSIER");
  const draft = dossierSegment
    ? normalizeInterviewDossierDraft(dossierSegment.value)
    : null;
  const reply =
    (dossierSegment
      ? stripTaggedJson(visibleText, dossierSegment)
      : visibleText
    ).trim() ||
    (lastUser ? "Tell me more." : "What is the working title of this piece?");

  return {
    kind: "question",
    text: reply,
    draft: draft ?? undefined,
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
  handler: async (_ctx, args): Promise<InterviewTurnResult> => {
    const provider = pickProvider();
    if (!provider) {
      return {
        kind: "question",
        text: "Tell me a little more about the piece, the reader, and what success looks like.",
        provider: "local",
        model: "local",
      };
    }

    const transcript = (args.messages as InterviewMessage[])
      .map((m) => `${m.author === "writer" ? "Writer" : "You"}: ${m.text}`)
      .join("\n");
    const temperature = provider.label === "openai" ? 0.6 : 0.4;
    const maxTokens = 420;
    const { text } = await generateText({
      model: provider.model,
      system: interviewSystemPrompt(
        args.mode,
        (args.currentBrief ?? null) as ProjectBrief | null,
      ),
      prompt: transcript,
      temperature,
      maxOutputTokens: maxTokens,
    });
    return parseInterviewTurnResult(
      text,
      provider.label,
      provider.modelId,
      args.messages as InterviewMessage[],
    );
  },
});

/**
 * Run a single persona agent. Returns the agent's note and metadata.
 * Falls back to the local generator if no provider is configured or the
 * remote call fails — the room never breaks entirely.
 *
 * Security: the hosted LLM (the part that spends provider keys) is gated on
 * a signed-in Pro subscriber. Anonymous and free callers get the local
 * generator so the endpoint can't be used to consume keys without an account.
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
    if (!identity) throw new Error("Not signed in");

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
      return generateLocalFeedback(req);
    }
    const canHost =
      !!pickProvider() && (await userIsPro(ctx, identity.tokenIdentifier));
    return runWithFallback(req, canHost);
  },
});

/* ── Suggested rewrites (editors propose edits) ─────────────────────── */

export interface RewriteResult {
  replacement: string;
  rationale: string;
  provider: "rivet" | "anthropic" | "openai" | "bifrost" | "local";
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

/** Deterministic last-resort rewrite — tightens filler so the loop always works. */
function localRewrite(
  persona: AgentPersona,
  original: string,
): { replacement: string; rationale: string } {
  const replacement = original
    .replace(/\b(very|really|just|quite|simply|actually|basically)\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const changed = replacement !== original.trim();
  return {
    replacement: changed ? replacement : original.trim(),
    rationale: changed
      ? `${persona.name}: tightened the line — fewer hedges, same claim.`
      : `${persona.name}: the line is already lean; consider sharpening the verb.`,
  };
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
    if (!identity) throw new Error("Not signed in");

    // Rate limit: the markup pass fans this out once per target span, so
    // we allow a higher budget than the single-shot feedback path.
    await consumeRateLimit(ctx, {
      action: "agent:rewrite",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentRewrite,
    });

    const persona = args.persona as AgentPersona;
    if (countWords(args.draftText) < MIN_MARKUP_WORDS) {
      return { ...localRewrite(persona, args.original), provider: "local" };
    }
    const provider = pickProvider();
    if (!provider || !(await userIsPro(ctx, identity.tokenIdentifier)))
      return { ...localRewrite(persona, args.original), provider: "local" };

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
      if (parsed) return { ...parsed, provider: provider.label };
    } catch (err) {
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
      /* fall through to local */
    }
    return { ...localRewrite(persona, args.original), provider: "local" };
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    // Rate limit: convene fans out to one LLM call per persona, making it
    // one of the most expensive endpoints.
    await consumeRateLimit(ctx, {
      action: "agent:room",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentRoom,
    });
    const provider = pickProvider();
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const short = countWords(args.draftText) < MIN_EDITOR_WORDS;
    // Hosted LLM (key-consuming) only for Pro subscribers; otherwise every
    // persona falls back to the local generator, but the room still runs.
    const canHost =
      !short && !!provider && (await userIsPro(ctx, identity.tokenIdentifier));
    if (short) {
      return args.personas.map((pRaw) => {
        const persona = pRaw as AgentPersona;
        return {
          personaId: persona.id,
          ...generateLocalFeedback({
            persona,
            brief,
            draftText: args.draftText,
            anchor: args.anchors?.[persona.id],
            instruction: "feedback",
          }),
        };
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
      };
      try {
        if (canHost) {
          return await runLlm(provider!, req);
        }
      } catch (err) {
        console.error(
          `[twyne:agents] ${persona.id} LLM call failed, falling back to local:`,
          err,
        );
      }
      return generateLocalFeedback(req);
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
 * document, then the room synthesises them. Pro-gated and rate-limited like
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
    if (!identity) throw new Error("Not signed in");
    await consumeRateLimit(ctx, {
      action: "agent:room",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.agentRoom,
    });
    const provider = pickProvider();
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const canHost =
      !!provider &&
      countWords(args.draftText) >= MIN_EDITOR_WORDS &&
      (await userIsPro(ctx, identity.tokenIdentifier));

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
          if (canHost) {
            const r = await runLlm(provider!, req, "persona-analysis", 1600);
            return { personaId: persona.id, ...r };
          }
        } catch (err) {
          console.error(
            `[twyne:agents] ${persona.id} analysis failed, falling back to local:`,
            err,
          );
        }
        return { personaId: persona.id, ...generateLocalFeedback(req) };
      }),
    );

    let synthesis = "";
    let synthesisProvider = "local";
    if (canHost && provider) {
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
        );
        synthesisProvider = provider.label;
      } catch (err) {
        console.error("[twyne:agents] room synthesis failed:", err);
      }
    }

    return { memos, synthesis, synthesisProvider };
  },
});

/**
 * The full-page narrative review for the rubric. Given the already-computed
 * judge scores and static-feature notes, write the prose that explains the
 * grade. Pro-gated; returns an empty review when hosting is unavailable.
 */
export const reviewRubric = action({
  args: {
    brief: briefValidator,
    draftText: v.string(),
    combined: v.number(),
    grade: v.string(),
    judgeMean: v.number(),
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
    const provider = pickProvider();
    if (!provider || !(await userIsPro(ctx, identity.tokenIdentifier))) {
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
          staticTotal: args.staticTotal,
          judges: args.judges,
          staticFeedback: args.staticFeedback,
          brief,
          draftText: args.draftText,
        }),
        1400,
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
    const provider = pickProvider();
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localJudge(persona, brief, args.draftText);
    }

    if (!provider || !(await userIsPro(ctx, identity.tokenIdentifier))) {
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
      if (parsed) return { ...parsed, provider: provider.label };
    } catch (err) {
      console.error(`[twyne:agents] ${persona.id} judge call failed:`, err);
    }
    return localJudge(persona, brief, args.draftText);
  },
});

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
    const canHost =
      countWords(args.draftText) >= MIN_RUBRIC_WORDS &&
      !!pickProvider() &&
      (await userIsPro(ctx, identity.tokenIdentifier));
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
        const provider = pickProvider();
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
            return { ...parsed, personaId: persona.id };
          }
        } catch (err) {
          console.error(`[twyne:agents] ${persona.id} judge call failed:`, err);
        }
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

async function runWithFallback(
  req: AgentRequest,
  canUseHosted: boolean,
): Promise<AgentResponse> {
  const provider = pickProvider();
  if (provider && canUseHosted) {
    try {
      return await runLlm(
        provider,
        req,
        req.userMessage || req.priorMessages?.length
          ? "persona-reply"
          : "persona-feedback",
      );
    } catch (err) {
      console.error(
        `[twyne:agents] LLM call failed for ${req.persona.id}, falling back to local:`,
        err,
      );
    }
  }
  return generateLocalFeedback(req);
}

function parseJudgeOutput(
  text: string,
): { score: number; rationale: string } | null {
  // The model sometimes wraps JSON in ```json ... ```. Strip fences.
  const stripped = stripReasoningTags(text)
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  // Try strict JSON, then a looser "score: N" parse.
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
