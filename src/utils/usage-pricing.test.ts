import { describe, expect, test } from "bun:test";
import {
  PINNED_USAGE_PRICING_CATALOG,
  estimateUsageCost,
  resolvePricingEntry,
  resolveUsageCost,
} from "./usage-pricing";

describe("pinned usage pricing", () => {
  test("matches exact model ids before aliases", () => {
    expect(resolvePricingEntry("OpenAI", "gpt-5.5")?.model).toBe("gpt-5.5");
    expect(resolvePricingEntry("openai", "gpt-5.5-2026-04-23")?.model).toBe(
      "gpt-5.5",
    );
    expect(resolvePricingEntry("openai", "not-a-model")).toBeNull();
  });

  test("uses integer micro-USD arithmetic and half-up rounding", () => {
    const result = estimateUsageCost({
      source: "byok",
      provider: "openai",
      model: "gpt-5.5",
      usage: { inputTokens: 2, cacheReadTokens: 1, outputTokens: 0 },
    });
    expect(result).toMatchObject({
      kind: "estimated",
      // 1 uncached token at 5 micro-USD + 1 cached at 0.5, rounded half-up.
      costMicrousd: 6,
      pricingVersion: PINNED_USAGE_PRICING_CATALOG.version,
    });
  });

  test("does not double-charge reasoning tokens included in output", () => {
    const withoutReasoning = estimateUsageCost({
      source: "byok",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1, outputTokens: 10 },
    });
    const withReasoning = estimateUsageCost({
      source: "byok",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1, outputTokens: 10, reasoningTokens: 4 },
    });
    expect(withReasoning).toEqual(withoutReasoning);
  });

  test("applies Google's long-context rates to the whole request", () => {
    expect(
      estimateUsageCost({
        source: "byok",
        provider: "google",
        model: "gemini-3.1-pro-preview",
        usage: { inputTokens: 200_001, outputTokens: 1 },
      }),
    ).toMatchObject({
      kind: "estimated",
      costMicrousd: 800_022,
      pricing: {
        inputMicrousdPerMillion: 4_000_000,
        outputMicrousdPerMillion: 18_000_000,
      },
    });
  });

  test("returns unknown instead of zero for unknown or unsupported pricing", () => {
    expect(
      estimateUsageCost({
        source: "byok",
        provider: "other",
        model: "mystery",
        usage: { inputTokens: 100 },
      }),
    ).toEqual({ kind: "unknown", reason: "unknown_model" });
    expect(
      estimateUsageCost({
        source: "byok",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: { inputTokens: 100, cacheWriteTokens: 10 },
      }),
    ).toEqual({ kind: "unknown", reason: "unsupported_cache_write" });
  });

  test("rejects overlapping counters and missing dimensional usage", () => {
    expect(
      estimateUsageCost({
        source: "byok",
        provider: "openai",
        model: "gpt-5.5",
        usage: { inputTokens: 4, cacheReadTokens: 5 },
      }),
    ).toEqual({ kind: "unknown", reason: "invalid_usage" });
    expect(
      estimateUsageCost({
        source: "byok",
        provider: "openai",
        model: "gpt-5.5",
        usage: { totalTokens: 12 },
      }),
    ).toEqual({ kind: "unknown", reason: "missing_usage" });
  });

  test("marks local usage without inventing a provider charge", () => {
    expect(
      estimateUsageCost({
        source: "local",
        provider: "browser",
        model: "local-model",
        usage: {},
      }),
    ).toEqual({ kind: "local" });
    expect(
      resolveUsageCost({
        source: "local",
        estimate: { kind: "local" },
      }),
    ).toEqual({ kind: "local" });
  });

  test("uses actual then provider-reported then estimated priority", () => {
    const estimate = estimateUsageCost({
      source: "hosted",
      provider: "openai",
      model: "gpt-5.5",
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    expect(
      resolveUsageCost({
        source: "hosted",
        actualCostMicrousd: 90,
        providerReportedCostMicrousd: 80,
        estimate,
      }),
    ).toEqual({ kind: "actual", costMicrousd: 90 });
    expect(
      resolveUsageCost({
        source: "hosted",
        providerReportedCostMicrousd: 80,
        estimate,
      }),
    ).toEqual({ kind: "actual", costMicrousd: 80 });
    expect(resolveUsageCost({ source: "hosted", estimate })).toMatchObject({
      kind: "estimated",
    });
  });
});
