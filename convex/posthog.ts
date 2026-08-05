import type { AiFeature } from "../src/types";
import {
  createAiTraceId,
  deterministicEvalProperties,
  serializeAiContent,
  type AiContentMode,
  type AiUsage,
} from "../src/utils/ai-deterministic-evals";
import type { AgentRequest } from "./agentPrompts";

export interface ServerAiObservabilityContext {
  distinctId?: string;
  anonymousId?: string;
  sessionId?: string;
  folioId?: string;
  editorialActionId?: string;
  traceId?: string;
}

export interface CaptureServerAiGenerationArgs {
  feature: AiFeature;
  provider: string;
  model: string;
  req?: AgentRequest;
  generationInput?: string;
  personaId?: string;
  output?: string;
  latencyMs: number;
  temperature?: number;
  maxTokens?: number;
  spanName?: string;
  error?: unknown;
  usage?: AiUsage;
  observability?: ServerAiObservabilityContext;
  evalSignals?: Record<string, unknown>;
}

function projectKey(): string | undefined {
  return process.env.POSTHOG_PROJECT_API_KEY ?? process.env.PUBLIC_POSTHOG_KEY;
}

function host(): string {
  return process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
}

function captureEnabled(): boolean {
  return process.env.POSTHOG_CAPTURE !== "false";
}

function contentMode(): AiContentMode {
  return process.env.POSTHOG_AI_CONTENT_MODE === "full" ? "full" : "redacted";
}

function errorValue(error: unknown): unknown {
  if (!error) return undefined;
  if (error instanceof Error) {
    return { message: error.message.slice(0, 400), name: error.name };
  }
  return String(error).slice(0, 400);
}

export async function captureServerAiGeneration({
  feature,
  provider,
  model,
  req,
  generationInput,
  output,
  latencyMs,
  temperature,
  maxTokens,
  spanName,
  error,
  usage,
  observability,
  personaId,
  evalSignals,
}: CaptureServerAiGenerationArgs): Promise<string> {
  const resolvedTraceId =
    observability?.traceId ?? createAiTraceId(String(feature));
  const apiKey = projectKey();
  if (!apiKey || !captureEnabled()) return resolvedTraceId;

  try {
    const mode = contentMode();
    const input =
      inputForGeneration(req, generationInput) ??
      JSON.stringify({
        persona: req?.persona.id,
        instruction: req?.instruction ?? "feedback",
        hasBrief: !!req?.brief,
        draftText: req?.draftText,
        anchor: req?.anchor,
        userMessage: req?.userMessage,
      });
    await fetch(`${host().replace(/\/$/, "")}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "$ai_generation",
        properties: {
          distinct_id: observability?.distinctId ?? `convex:${feature}`,
          $ai_trace_id: resolvedTraceId,
          $ai_session_id: observability?.sessionId,
          $ai_span_id: createAiTraceId(`${feature}:server-generation`),
          $ai_span_name: spanName ?? feature,
          $ai_model: model,
          $ai_provider: provider,
          $ai_input: [
            {
              role: "user",
              content: serializeAiContent(input, mode),
            },
          ],
          $ai_output_choices: output
            ? [{ role: "assistant", content: serializeAiContent(output, mode) }]
            : [],
          $ai_input_tokens: usage?.inputTokens,
          $ai_output_tokens: usage?.outputTokens,
          $ai_latency: latencyMs / 1000,
          $ai_temperature: temperature,
          $ai_max_tokens: maxTokens,
          $ai_is_error: !!error,
          $ai_error: errorValue(error),
          twyne_feature: feature,
          twyne_persona_id: personaId ?? req?.persona.id,
          twyne_instruction: req?.instruction ?? "feedback",
          twyne_server_runtime: "convex",
          twyne_anonymous_id: observability?.anonymousId,
          twyne_session_id: observability?.sessionId,
          twyne_folio_id: observability?.folioId,
          twyne_editorial_action_id: observability?.editorialActionId,
          twyne_content_mode: mode,
          twyne_input_chars: input.length,
          twyne_output_chars: output?.length ?? 0,
          ...deterministicEvalProperties(output, evalSignals),
          ...evalSignals,
        },
      }),
    });
  } catch (err) {
    console.warn("[twyne:posthog] failed to capture AI generation:", err);
  }
  return resolvedTraceId;
}

function inputForGeneration(
  req: AgentRequest | undefined,
  input: string | undefined,
): string | undefined {
  if (input !== undefined) return input;
  if (!req) return undefined;
  return JSON.stringify({
    persona: req.persona.id,
    instruction: req.instruction ?? "feedback",
    hasBrief: !!req.brief,
    draftText: req.draftText,
    anchor: req.anchor,
    userMessage: req.userMessage,
  });
}
