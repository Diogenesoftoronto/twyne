import type { AiFeature } from "../src/types";
import type { AgentRequest } from "./agentPrompts";

interface CaptureServerAiGenerationArgs {
  feature: AiFeature;
  provider: string;
  model: string;
  req: AgentRequest;
  output?: string;
  latencyMs: number;
  temperature?: number;
  maxTokens?: number;
  spanName?: string;
  error?: unknown;
  evalSignals?: Record<string, unknown>;
}

const MAX_TEXT_CHARS = 6000;

function projectKey(): string | undefined {
  return process.env.POSTHOG_PROJECT_API_KEY ?? process.env.PUBLIC_POSTHOG_KEY;
}

function host(): string {
  return process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
}

function captureEnabled(): boolean {
  return process.env.POSTHOG_CAPTURE !== "false";
}

function clamp(text: string | undefined): string | undefined {
  if (!text) return text;
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated]`;
}

function id(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function errorValue(error: unknown): unknown {
  if (!error) return undefined;
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return String(error);
}

export async function captureServerAiGeneration({
  feature,
  provider,
  model,
  req,
  output,
  latencyMs,
  temperature,
  maxTokens,
  spanName,
  error,
  evalSignals,
}: CaptureServerAiGenerationArgs): Promise<void> {
  const apiKey = projectKey();
  if (!apiKey || !captureEnabled()) return;

  try {
    await fetch(`${host().replace(/\/$/, "")}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "$ai_generation",
        properties: {
          distinct_id: "convex-server",
          $ai_trace_id: id(feature),
          $ai_span_id: id(`${feature}:server-generation`),
          $ai_span_name: spanName ?? feature,
          $ai_model: model,
          $ai_provider: provider,
          $ai_input: [
            {
              role: "user",
              content: clamp(
                JSON.stringify({
                  persona: req.persona.id,
                  instruction: req.instruction ?? "feedback",
                  hasBrief: !!req.brief,
                  draftText: req.draftText,
                  anchor: req.anchor,
                  userMessage: req.userMessage,
                }),
              ),
            },
          ],
          $ai_output_choices: output
            ? [{ role: "assistant", content: clamp(output) }]
            : [],
          $ai_latency: latencyMs / 1000,
          $ai_temperature: temperature,
          $ai_max_tokens: maxTokens,
          $ai_is_error: !!error,
          $ai_error: errorValue(error),
          twyne_feature: feature,
          twyne_persona_id: req.persona.id,
          twyne_instruction: req.instruction ?? "feedback",
          twyne_server_runtime: "convex",
          ...evalSignals,
        },
      }),
    });
  } catch (err) {
    console.warn("[twyne:posthog] failed to capture AI generation:", err);
  }
}
