import type {
  TokenDimensionTotals,
  UsageMetrics,
} from "../../utils/usage-summary";

/** Shared fixtures for Desk stories — small, deterministic, independent. */

export function storyTokens(): TokenDimensionTotals {
  const coverage = { reportedEvents: 138, missingEvents: 0 };
  return {
    inputTokens: 1_204_318,
    outputTokens: 96_442,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 1_300_760,
    coverage: {
      inputTokens: coverage,
      outputTokens: coverage,
      cacheReadTokens: { reportedEvents: 0, missingEvents: 0 },
      cacheWriteTokens: { reportedEvents: 0, missingEvents: 0 },
      reasoningTokens: { reportedEvents: 0, missingEvents: 0 },
      totalTokens: coverage,
    },
    reportedTotalDiscrepancies: 0,
  };
}

export function storyMetrics(overrides?: Partial<UsageMetrics>): UsageMetrics {
  return {
    generations: 142,
    completedGenerations: 138,
    failedGenerations: 4,
    logicalActions: 96,
    completedActions: 94,
    failedActions: 2,
    actualCostMicrousd: 184_200,
    estimatedCostMicrousd: 201_500,
    localGenerations: 12,
    unknownCostGenerations: 1,
    creditMicrounits: 0,
    tokens: storyTokens(),
    ...overrides,
  };
}
