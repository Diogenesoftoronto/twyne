import { afterEach, describe, expect, test } from "bun:test";
import { buildAiGenerationProperties } from "./ai-evals";
import { FALLBACK_FEATURES, setRuntimeFeatures } from "./feature-flags";

afterEach(() => {
  setRuntimeFeatures(FALLBACK_FEATURES);
});

describe("AI eval event payloads", () => {
  test("builds PostHog AI Observability generation properties", () => {
    setRuntimeFeatures({ pricing: true, localAi: true });

    const props = buildAiGenerationProperties({
      feature: "rubric-judge",
      provider: "litert",
      model: "gemma-4-e4b",
      system: "Judge the draft.",
      prompt: "Draft text",
      output: "Looks plausible.",
      latencyMs: 1250,
      temperature: 0.2,
      maxTokens: 220,
      traceId: "trace-1",
      spanName: "rubric_judge",
      evalSignals: {
        twyne_expected_format: "json_score_rationale",
      },
    });

    expect(props).toMatchObject({
      $ai_trace_id: "trace-1",
      $ai_span_name: "rubric_judge",
      $ai_model: "gemma-4-e4b",
      $ai_provider: "litert",
      $ai_latency: 1.25,
      $ai_temperature: 0.2,
      $ai_max_tokens: 220,
      $ai_is_error: false,
      twyne_feature: "rubric-judge",
      twyne_runtime_pricing_flag: true,
      twyne_runtime_local_ai_flag: true,
      twyne_expected_format: "json_score_rationale",
    });
    expect(props.$ai_input).toEqual([
      { role: "system", content: "Judge the draft." },
      { role: "user", content: "Draft text" },
    ]);
    expect(props.$ai_output_choices).toEqual([
      { role: "assistant", content: "Looks plausible." },
    ]);
  });

  test("marks failed generations for PostHog eval/error views", () => {
    const props = buildAiGenerationProperties({
      feature: "persona-feedback",
      provider: "openai",
      model: "gpt-4o",
      prompt: "Read this.",
      latencyMs: 50,
      error: new Error("provider timeout"),
    });

    expect(props.$ai_is_error).toBe(true);
    expect(props.$ai_error).toEqual({
      name: "Error",
      message: "provider timeout",
    });
    expect(props.$ai_output_choices).toEqual([]);
  });

  test("truncates long prompt and output fields", () => {
    const longText = "x".repeat(7000);
    const props = buildAiGenerationProperties({
      feature: "source-summarize",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      prompt: longText,
      output: longText,
      latencyMs: 1,
    });

    const input = props.$ai_input as Array<{ content: string }>;
    const choices = props.$ai_output_choices as Array<{ content: string }>;

    expect(input[0].content.length).toBeLessThan(longText.length);
    expect(input[0].content.endsWith("[truncated]")).toBe(true);
    expect(choices[0].content.endsWith("[truncated]")).toBe(true);
  });
});
