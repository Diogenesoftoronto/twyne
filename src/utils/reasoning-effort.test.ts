import { describe, expect, test } from "bun:test";
import {
  reasoningProviderOptions,
  supportsReasoningEffort,
} from "./reasoning-effort";
import type { AiProviderConfig } from "../types";

function provider(over: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: "p1",
    name: "Test",
    type: "openai",
    apiKey: "k",
    defaultModel: "gpt-5",
    ...over,
  } as AiProviderConfig;
}

describe("reasoningProviderOptions", () => {
  test("says nothing when the model has no level set", () => {
    expect(reasoningProviderOptions(provider(), "gpt-5")).toBeUndefined();
  });

  test("says nothing for a model other than the one dialled", () => {
    const config = provider({
      modelReasoning: { "gpt-5": { type: "effort", value: "high" } },
    });
    // The safety property: a feature that overrides the model must not
    // inherit a thinking parameter the other model would reject.
    expect(reasoningProviderOptions(config, "gpt-4o")).toBeUndefined();
  });

  test("says nothing when no model is resolved", () => {
    const config = provider({
      modelReasoning: { "gpt-5": { type: "effort", value: "high" } },
    });
    expect(reasoningProviderOptions(config, undefined)).toBeUndefined();
  });

  test("maps OpenAI levels onto reasoningEffort", () => {
    const config = provider({
      modelReasoning: { "gpt-5": { type: "effort", value: "high" } },
    });
    expect(reasoningProviderOptions(config, "gpt-5")).toEqual({
      openai: { reasoningEffort: "high" },
    });
  });

  test("maps an OpenAI toggle off to none", () => {
    const config = provider({
      modelReasoning: { "gpt-5": { type: "toggle", value: false } },
    });
    expect(reasoningProviderOptions(config, "gpt-5")).toEqual({
      openai: { reasoningEffort: "none" },
    });
  });

  test("routes every OpenAI-shaped gateway through the openai key", () => {
    // They are all built with createOpenAI, which reports itself as "openai".
    for (const type of [
      "openai-compatible",
      "deepseek",
      "openrouter",
      "ollama",
      "zai",
      "minimax",
      "litert",
    ] as const) {
      const config = provider({
        type,
        modelReasoning: { m: { type: "effort", value: "low" } },
      });
      expect(reasoningProviderOptions(config, "m")).toEqual({
        openai: { reasoningEffort: "low" },
      });
    }
  });

  test("uses Anthropic adaptive thinking with the selected effort", () => {
    const config = provider({
      type: "anthropic",
      modelReasoning: {
        "claude-x": { type: "effort", value: "low" },
      },
    });
    expect(reasoningProviderOptions(config, "claude-x")).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "low" },
    });
  });

  test("disables Anthropic thinking for a false toggle", () => {
    const config = provider({
      type: "anthropic",
      modelReasoning: { m: { type: "toggle", value: false } },
    });
    expect(reasoningProviderOptions(config, "m")).toEqual({
      anthropic: { thinking: { type: "disabled" } },
    });
  });

  test("maps Google effort and token budgets", () => {
    expect(
      reasoningProviderOptions(
        provider({
          type: "google",
          modelReasoning: { m: { type: "effort", value: "medium" } },
        }),
        "m",
      ),
    ).toEqual({ google: { thinkingConfig: { thinkingLevel: "medium" } } });
    expect(
      reasoningProviderOptions(
        provider({
          type: "google",
          modelReasoning: { m: { type: "budget_tokens", value: 2048 } },
        }),
        "m",
      ),
    ).toEqual({ google: { thinkingConfig: { thinkingBudget: 2048 } } });
  });

  test("says nothing for a provider family with no dial", () => {
    const config = provider({
      type: "elevenlabs" as AiProviderConfig["type"],
      modelReasoning: { m: { type: "effort", value: "high" } },
    });
    expect(reasoningProviderOptions(config, "m")).toBeUndefined();
  });
});

describe("supportsReasoningEffort", () => {
  test("accepts the language families and rejects voice-only ones", () => {
    expect(supportsReasoningEffort("openai")).toBe(true);
    expect(supportsReasoningEffort("anthropic")).toBe(true);
    expect(supportsReasoningEffort("google")).toBe(true);
    expect(
      supportsReasoningEffort("elevenlabs" as AiProviderConfig["type"]),
    ).toBe(false);
  });
});
