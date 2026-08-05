import { capturePostHogEvent } from "./posthog-context";
import { getRuntimeFeatures } from "./feature-flags";
import {
  createAiTraceId,
  deterministicEvalProperties,
  serializeAiContent,
  type AiContentMode,
  type AiUsage,
} from "./ai-deterministic-evals";

export interface AiEvalCapture {
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
  sessionId?: string;
  folioId?: string;
  editorialActionId?: string;
  spanName?: string;
  error?: unknown;
  usage?: AiUsage;
  contentMode?: AiContentMode;
  evalSignals?: Record<string, unknown>;
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
  sessionId,
  folioId,
  editorialActionId,
  spanName,
  error,
  usage,
  contentMode = "redacted",
  evalSignals,
}: AiEvalCapture): Promise<string> {
  const resolvedTraceId = explicitTraceId ?? createAiTraceId(feature);
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
      traceId: resolvedTraceId,
      sessionId,
      folioId,
      editorialActionId,
      spanName,
      error,
      usage,
      contentMode,
      evalSignals,
    }),
  );
  return resolvedTraceId;
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
  sessionId,
  folioId,
  editorialActionId,
  spanName,
  error,
  usage,
  contentMode = "redacted",
  evalSignals,
}: AiEvalCapture): Record<string, unknown> {
  const features = getRuntimeFeatures();
  const resolvedTraceId = explicitTraceId ?? createAiTraceId(feature);
  const inputTextLength = (system?.length ?? 0) + prompt.length;
  return {
    $ai_trace_id: resolvedTraceId,
    $ai_session_id: sessionId,
    $ai_span_id: createAiTraceId(`${feature}:generation`),
    $ai_span_name: spanName ?? feature,
    $ai_model: model,
    $ai_provider: provider,
    $ai_input: [
      ...(system
        ? [{ role: "system", content: serializeAiContent(system, contentMode) }]
        : []),
      { role: "user", content: serializeAiContent(prompt, contentMode) },
    ],
    $ai_output_choices: output
      ? [
          {
            role: "assistant",
            content: serializeAiContent(output, contentMode),
          },
        ]
      : [],
    $ai_input_tokens: usage?.inputTokens,
    $ai_output_tokens: usage?.outputTokens,
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
    twyne_content_mode: contentMode,
    twyne_input_chars: inputTextLength,
    twyne_output_chars: output?.length ?? 0,
    twyne_folio_id: folioId,
    twyne_editorial_action_id: editorialActionId,
    ...deterministicEvalProperties(output, evalSignals),
    ...evalSignals,
  };
}
