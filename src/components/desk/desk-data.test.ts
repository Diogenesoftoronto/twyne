import { describe, expect, test } from "bun:test";
import {
  createUsageEventKey,
  createUsageRange,
  createWritingActivityKey,
  type UsageEvent,
} from "../../utils/usage-domain";
import {
  combinedDataIsPartial,
  combineDeskUsage,
  metricsFromServer,
  type ServerBreakdownRow,
  type ServerUsageMetrics,
} from "./desk-data";

const ZERO: ServerUsageMetrics = {
  generations: 0,
  completedGenerations: 0,
  failedGenerations: 0,
  logicalActions: 0,
  completedActions: 0,
  failedActions: 0,
  actualCostMicrousd: 0,
  estimatedCostMicrousd: 0,
  localGenerations: 0,
  unknownCostGenerations: 0,
  creditMicrounits: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  inputTokensReported: 0,
  outputTokensReported: 0,
  cacheReadTokensReported: 0,
  cacheWriteTokensReported: 0,
  reasoningTokensReported: 0,
  totalTokensReported: 0,
  inputTokensMissing: 0,
  outputTokensMissing: 0,
  cacheReadTokensMissing: 0,
  cacheWriteTokensMissing: 0,
  reasoningTokensMissing: 0,
  totalTokensMissing: 0,
  reportedTotalDiscrepancies: 0,
};

function pendingEvent(): UsageEvent {
  const base = {
    occurredAt: Date.parse("2026-08-25T12:00:00.000Z"),
    day: "2026-08-25",
    source: "byok" as const,
    authority: "client_reported" as const,
    feature: "persona-feedback" as const,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    folioId: "folio-local",
    traceId: "trace-local",
    attempt: 1,
    outcome: "completed" as const,
    costKind: "estimated" as const,
    costMicrousd: 250,
    pricingVersion: "test-v1",
    pricing: {
      source: "test-catalog",
      version: "test-v1",
      currency: "USD" as const,
      inputMicrousdPerMillion: 1_000,
      outputMicrousdPerMillion: 2_000,
    },
  };
  return { ...base, eventKey: createUsageEventKey(base) };
}

function row(key: string, generations: number): ServerBreakdownRow {
  return {
    ...ZERO,
    key,
    generations,
    completedGenerations: generations,
    logicalActions: generations,
    completedActions: generations,
  };
}

describe("combined My Desk aggregates", () => {
  test("rebases to server totals then adds pending browser rows once", () => {
    const pending = pendingEvent();
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    const activityAt = Date.parse("2026-08-25T13:00:00.000Z");
    const result = combineDeskUsage({
      range: createUsageRange("30d", now),
      now,
      remoteOverall: {
        ...ZERO,
        generations: 3,
        completedGenerations: 3,
        logicalActions: 2,
        completedActions: 2,
        actualCostMicrousd: 900,
      },
      remoteDaily: [
        {
          ...ZERO,
          day: "2026-08-25",
          generations: 3,
          completedGenerations: 3,
          logicalActions: 2,
          completedActions: 2,
          actualCostMicrousd: 900,
        },
      ],
      remoteBreakdowns: {
        feature: [row("persona-feedback", 3)],
        provider_model: [row("anthropic:claude-sonnet-4-6", 3)],
        folio: [row("folio-local", 3)],
      },
      remoteWriting: {
        days: [{ day: "2026-08-25", count: 2 }],
        details: [
          {
            day: "2026-08-25",
            folioId: "folio-local",
            count: 2,
            firstOccurredAt: activityAt - 1_000,
            lastOccurredAt: activityAt,
          },
        ],
        detailsTruncated: false,
        legacyDayTotalsPresent: false,
      },
      recentServerEvents: [],
      pendingEvents: [pending],
      localActivities: [
        {
          activityKey: createWritingActivityKey("2026-08-25", "folio-local"),
          day: "2026-08-25",
          folioId: "folio-local",
          count: 2,
          firstOccurredAt: activityAt - 1_000,
          lastOccurredAt: activityAt,
        },
      ],
      folios: [{ folioId: "folio-local", currentWords: 400, updatedAt: now }],
    });
    expect(result.overall.generations).toBe(4);
    expect(result.overall.actualCostMicrousd).toBe(900);
    expect(result.overall.estimatedCostMicrousd).toBe(250);
    expect(result.daily[0].generations).toBe(4);
    expect(result.features[0].generations).toBe(4);
    expect(result.providers[0].models[0].generations).toBe(4);
    expect(result.writingHeatmap[0].count).toBe(2);
  });

  test("preserves token reporting coverage from flat server aggregates", () => {
    const metrics = metricsFromServer({
      ...ZERO,
      inputTokens: 80,
      inputTokensReported: 2,
      inputTokensMissing: 1,
    });
    expect(metrics.tokens.inputTokens).toBe(80);
    expect(metrics.tokens.coverage.inputTokens).toEqual({
      reportedEvents: 2,
      missingEvents: 1,
    });
  });

  test("does not add a synchronized browser row unless it is pending", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    const result = combineDeskUsage({
      range: createUsageRange("30d", now),
      now,
      remoteOverall: {
        ...ZERO,
        generations: 1,
        completedGenerations: 1,
      },
      remoteDaily: [],
      remoteBreakdowns: { feature: [], provider_model: [], folio: [] },
      remoteWriting: {
        days: [],
        details: [],
        detailsTruncated: false,
        legacyDayTotalsPresent: false,
      },
      recentServerEvents: [],
      pendingEvents: [],
      localActivities: [],
      folios: [],
    });
    expect(result.overall.generations).toBe(1);
  });

  test("propagates any bounded-source truncation into partial state", () => {
    expect(combinedDataIsPartial([false, false, true, false])).toBe(true);
    expect(combinedDataIsPartial([false, false])).toBe(false);
  });
});
