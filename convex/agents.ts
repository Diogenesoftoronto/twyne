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
import { generateText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  buildSystemPrompt,
  buildUserPrompt,
  generateLocalFeedback,
  toAgentPersona,
  type AgentPersona,
  type AgentRequest,
  type AgentResponse,
  type FeedbackType,
} from "./agentPrompts";
import type { Persona, ProjectBrief } from "../src/types";
import { captureServerAiGeneration } from "./posthog";
import {
  countWords,
  MIN_EDITOR_WORDS,
  MIN_MARKUP_WORDS,
  MIN_RUBRIC_WORDS,
} from "../src/utils/draft-thresholds";

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
    const modelId = process.env.RIVET_MODEL ?? "anthropic/claude-sonnet-4-5";
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
    const modelId = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    return {
      model: anthropic(modelId),
      label: "anthropic",
      modelId,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const modelId = process.env.OPENAI_MODEL ?? "gpt-4o";
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
  feature: "persona-feedback" | "persona-reply" = "persona-feedback",
): Promise<AgentResponse> {
  const system = buildSystemPrompt(req.persona);
  const user = buildUserPrompt(req);
  const fallbackType: FeedbackType = defaultTypeForPersona(req.persona);
  const temperature = provider.label === "openai" ? 0.6 : 0.4;
  const maxTokens = 380;
  const start = Date.now();

  try {
    const { text } = await generateText({
      model: provider.model,
      system,
      prompt: user,
      temperature,
      maxOutputTokens: maxTokens,
    });
    await captureServerAiGeneration({
      feature,
      provider: provider.label,
      model: provider.modelId,
      req,
      output: text,
      latencyMs: Date.now() - start,
      temperature,
      maxTokens,
      spanName: feature,
    });

    const cleaned = text.trim();
    return {
      text: cleaned || "(no response)",
      type: classifyType(cleaned, fallbackType),
      provider: provider.label,
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
  color: v.optional(v.string()),
  icon: v.optional(v.string()),
});

const briefValidator = v.union(v.null(), v.any());

/**
 * Run a single persona agent. Returns the agent's note and metadata.
 * Falls back to the local generator if no provider is configured or the
 * remote call fails — the room never breaks entirely.
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
  handler: async (_ctx, args): Promise<AgentResponse> => {
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
    return runWithFallback(req);
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
  handler: async (_ctx, args): Promise<RewriteResult> => {
    const persona = args.persona as AgentPersona;
    if (countWords(args.draftText) < MIN_MARKUP_WORDS) {
      return { ...localRewrite(persona, args.original), provider: "local" };
    }
    const provider = pickProvider();
    if (!provider)
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
        output: text,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "persona_rewrite",
        evalSignals: {
          twyne_expected_format: "json_rewrite",
          twyne_rewrite_level: args.level,
        },
      });
      const parsed = parseRewriteOutput(text);
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
  handler: async (_ctx, args) => {
    const provider = pickProvider();
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_EDITOR_WORDS) {
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
        if (provider) {
          return await runLlm(provider, req);
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
  handler: async (_ctx, args) => {
    const persona = args.persona as AgentPersona;
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const provider = pickProvider();
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      return localJudge(persona, brief, args.draftText);
    }

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
      });
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
        output: text,
        latencyMs: Date.now() - start,
        temperature,
        maxTokens,
        spanName: "rubric_judge",
        evalSignals: { twyne_expected_format: "json_score_rationale" },
      });
      const parsed = parseJudgeOutput(text);
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
  handler: async (_ctx, args) => {
    const brief = (args.brief ?? null) as ProjectBrief | null;
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
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
            output: text,
            latencyMs: Date.now() - start,
            temperature,
            maxTokens,
            spanName: "rubric_judge_room",
            evalSignals: { twyne_expected_format: "json_score_rationale" },
          });
          const parsed = parseJudgeOutput(text);
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

async function runWithFallback(req: AgentRequest): Promise<AgentResponse> {
  const provider = pickProvider();
  if (provider) {
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
  const stripped = text
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
