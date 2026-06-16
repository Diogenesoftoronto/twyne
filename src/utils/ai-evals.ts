import { capturePostHogEvent } from "./posthog-context";
import { getRuntimeFeatures } from "./feature-flags";

interface AiEvalCapture {
  feature: string;
  provider: string;
  model: string;
  system?: string;
  prompt: string;
  output?: string;
  latencyMs: number;
  temperature?: number;
  maxTokens?: number;
  traceId?: string;
  spanName?: string;
  error?: unknown;
  evalSignals?: Record<string, unknown>;
}

const MAX_TEXT_CHARS = 6000;

function clampText(text: string | undefined): string | undefined {
  if (!text) return text;
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated]`;
}

function traceId(feature: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${feature}:${crypto.randomUUID()}`;
  }
  return `${feature}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function countWords(text: string | undefined): number {
  return text?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}

export async function captureAiGeneration({
  feature,
  provider,
  model,
  system,
  prompt,
  output,
  latencyMs,
  temperature,
  maxTokens,
  traceId: explicitTraceId,
  spanName,
  error,
  evalSignals,
}: AiEvalCapture): Promise<void> {
  await capturePostHogEvent(
    "$ai_generation",
    buildAiGenerationProperties({
      feature,
      provider,
      model,
      system,
      prompt,
      output,
      latencyMs,
      temperature,
      maxTokens,
      traceId: explicitTraceId,
      spanName,
      error,
      evalSignals,
    }),
  );
}

export function buildAiGenerationProperties({
  feature,
  provider,
  model,
  system,
  prompt,
  output,
  latencyMs,
  temperature,
  maxTokens,
  traceId: explicitTraceId,
  spanName,
  error,
  evalSignals,
}: AiEvalCapture): Record<string, unknown> {
  const features = getRuntimeFeatures();
  return {
    $ai_trace_id: explicitTraceId ?? traceId(feature),
    $ai_span_id: traceId(`${feature}:generation`),
    $ai_span_name: spanName ?? feature,
    $ai_model: model,
    $ai_provider: provider,
    $ai_input: [
      ...(system ? [{ role: "system", content: clampText(system) }] : []),
      { role: "user", content: clampText(prompt) },
    ],
    $ai_output_choices: output
      ? [{ role: "assistant", content: clampText(output) }]
      : [],
    $ai_latency: latencyMs / 1000,
    $ai_temperature: temperature,
    $ai_max_tokens: maxTokens,
    $ai_is_error: !!error,
    $ai_error:
      error instanceof Error
        ? { message: error.message, name: error.name }
        : error
          ? String(error)
          : undefined,
    twyne_feature: feature,
    twyne_runtime_pricing_flag: features.pricing,
    twyne_runtime_local_ai_flag: features.localAi,
    twyne_output_words: countWords(output),
    twyne_prompt_words: countWords(prompt) + countWords(system),
    ...evalSignals,
  };
}
