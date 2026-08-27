import {
  createWritingActivityKey,
  type UsageEvent,
  type UsageRange,
  type WritingActivityDetail,
} from "../../utils/usage-domain";
import {
  buildUsageSummary,
  buildWritingHeatmap,
  type DailyUsagePoint,
  type FeatureBreakdownEntry,
  type FolioBreakdownEntry,
  type FolioUsageMetadata,
  type LegacyWritingDay,
  type ProviderBreakdownEntry,
  type UsageMetrics,
  type UsageSummary,
  type WritingHeatmapDay,
} from "../../utils/usage-summary";

const TOKEN_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
] as const;

export type ServerUsageMetrics = Omit<UsageMetrics, "tokens"> & {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  inputTokensReported: number;
  outputTokensReported: number;
  cacheReadTokensReported: number;
  cacheWriteTokensReported: number;
  reasoningTokensReported: number;
  totalTokensReported: number;
  inputTokensMissing: number;
  outputTokensMissing: number;
  cacheReadTokensMissing: number;
  cacheWriteTokensMissing: number;
  reasoningTokensMissing: number;
  totalTokensMissing: number;
  reportedTotalDiscrepancies: number;
};

export interface ServerDailyUsage extends ServerUsageMetrics {
  day: string;
}

export interface ServerBreakdownRow extends ServerUsageMetrics {
  key: string;
}

export interface ServerWritingActivity {
  days: LegacyWritingDay[];
  details: Array<Omit<WritingActivityDetail, "activityKey">>;
  detailsTruncated: boolean;
  legacyDayTotalsPresent: boolean;
}

export function combinedDataIsPartial(flags: readonly boolean[]): boolean {
  return flags.some(Boolean);
}

function safe(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : 0;
}

export function metricsFromServer(
  value: Partial<ServerUsageMetrics>,
): UsageMetrics {
  const coverage = Object.fromEntries(
    TOKEN_KEYS.map((key) => [
      key,
      {
        reportedEvents: safe(
          value[`${key}Reported` as keyof ServerUsageMetrics],
        ),
        missingEvents: safe(value[`${key}Missing` as keyof ServerUsageMetrics]),
      },
    ]),
  ) as UsageMetrics["tokens"]["coverage"];
  return {
    generations: safe(value.generations),
    completedGenerations: safe(value.completedGenerations),
    failedGenerations: safe(value.failedGenerations),
    logicalActions: safe(value.logicalActions),
    completedActions: safe(value.completedActions),
    failedActions: safe(value.failedActions),
    actualCostMicrousd: safe(value.actualCostMicrousd),
    estimatedCostMicrousd: safe(value.estimatedCostMicrousd),
    localGenerations: safe(value.localGenerations),
    unknownCostGenerations: safe(value.unknownCostGenerations),
    creditMicrounits: safe(value.creditMicrounits),
    tokens: {
      inputTokens: safe(value.inputTokens),
      outputTokens: safe(value.outputTokens),
      cacheReadTokens: safe(value.cacheReadTokens),
      cacheWriteTokens: safe(value.cacheWriteTokens),
      reasoningTokens: safe(value.reasoningTokens),
      totalTokens: safe(value.totalTokens),
      coverage,
      reportedTotalDiscrepancies: safe(value.reportedTotalDiscrepancies),
    },
  };
}

export function addMetrics(
  left: UsageMetrics,
  right: UsageMetrics,
): UsageMetrics {
  return {
    generations: left.generations + right.generations,
    completedGenerations:
      left.completedGenerations + right.completedGenerations,
    failedGenerations: left.failedGenerations + right.failedGenerations,
    logicalActions: left.logicalActions + right.logicalActions,
    completedActions: left.completedActions + right.completedActions,
    failedActions: left.failedActions + right.failedActions,
    actualCostMicrousd: left.actualCostMicrousd + right.actualCostMicrousd,
    estimatedCostMicrousd:
      left.estimatedCostMicrousd + right.estimatedCostMicrousd,
    localGenerations: left.localGenerations + right.localGenerations,
    unknownCostGenerations:
      left.unknownCostGenerations + right.unknownCostGenerations,
    creditMicrounits: left.creditMicrounits + right.creditMicrounits,
    tokens: {
      inputTokens: left.tokens.inputTokens + right.tokens.inputTokens,
      outputTokens: left.tokens.outputTokens + right.tokens.outputTokens,
      cacheReadTokens:
        left.tokens.cacheReadTokens + right.tokens.cacheReadTokens,
      cacheWriteTokens:
        left.tokens.cacheWriteTokens + right.tokens.cacheWriteTokens,
      reasoningTokens:
        left.tokens.reasoningTokens + right.tokens.reasoningTokens,
      totalTokens: left.tokens.totalTokens + right.tokens.totalTokens,
      coverage: Object.fromEntries(
        TOKEN_KEYS.map((key) => [
          key,
          {
            reportedEvents:
              left.tokens.coverage[key].reportedEvents +
              right.tokens.coverage[key].reportedEvents,
            missingEvents:
              left.tokens.coverage[key].missingEvents +
              right.tokens.coverage[key].missingEvents,
          },
        ]),
      ) as UsageMetrics["tokens"]["coverage"],
      reportedTotalDiscrepancies:
        left.tokens.reportedTotalDiscrepancies +
        right.tokens.reportedTotalDiscrepancies,
    },
  };
}

function mergeHeatmaps(
  server: WritingHeatmapDay[],
  local: WritingHeatmapDay[],
): WritingHeatmapDay[] {
  const byDay = new Map(server.map((day) => [day.day, structuredClone(day)]));
  for (const localDay of local) {
    const remoteDay = byDay.get(localDay.day);
    if (!remoteDay) {
      byDay.set(localDay.day, structuredClone(localDay));
      continue;
    }
    const folios = new Map(
      remoteDay.folios.map((folio) => [folio.folioId, folio]),
    );
    for (const localFolio of localDay.folios) {
      const remote = folios.get(localFolio.folioId);
      folios.set(
        localFolio.folioId,
        remote
          ? {
              ...remote,
              count: Math.max(remote.count, localFolio.count),
              firstOccurredAt: Math.min(
                remote.firstOccurredAt,
                localFolio.firstOccurredAt,
              ),
              lastOccurredAt: Math.max(
                remote.lastOccurredAt,
                localFolio.lastOccurredAt,
              ),
            }
          : localFolio,
      );
    }
    remoteDay.folios = [...folios.values()].sort(
      (a, b) => b.count - a.count || a.folioId.localeCompare(b.folioId),
    );
    remoteDay.detailedCount = remoteDay.folios.reduce(
      (sum, folio) => sum + folio.count,
      0,
    );
    remoteDay.legacyCount = Math.max(
      remoteDay.legacyCount,
      localDay.legacyCount,
    );
    remoteDay.count = Math.max(
      remoteDay.count,
      localDay.count,
      remoteDay.detailedCount,
    );
    remoteDay.detailComplete = remoteDay.detailedCount >= remoteDay.legacyCount;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function mergeDaily(
  server: ServerDailyUsage[],
  pending: DailyUsagePoint[],
  heatmap: WritingHeatmapDay[],
): DailyUsagePoint[] {
  const writing = new Map(heatmap.map((day) => [day.day, day.count]));
  const byDay = new Map(
    server.map((row) => [
      row.day,
      {
        day: row.day,
        writingCount: writing.get(row.day) ?? 0,
        ...metricsFromServer(row),
      },
    ]),
  );
  for (const row of pending) {
    const prior = byDay.get(row.day);
    byDay.set(
      row.day,
      prior
        ? {
            day: row.day,
            writingCount: writing.get(row.day) ?? 0,
            ...addMetrics(prior, row),
          }
        : { ...row, writingCount: writing.get(row.day) ?? row.writingCount },
    );
  }
  for (const [day, count] of writing) {
    const prior = byDay.get(day);
    if (prior) prior.writingCount = count;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function reduceRows(
  rows: readonly ServerBreakdownRow[],
): Map<string, UsageMetrics> {
  const result = new Map<string, UsageMetrics>();
  for (const row of rows) {
    const metrics = metricsFromServer(row);
    result.set(
      row.key,
      result.has(row.key) ? addMetrics(result.get(row.key)!, metrics) : metrics,
    );
  }
  return result;
}

function mergeFeatures(
  rows: readonly ServerBreakdownRow[],
  pending: readonly FeatureBreakdownEntry[],
): FeatureBreakdownEntry[] {
  const metrics = reduceRows(rows);
  for (const row of pending)
    metrics.set(
      row.feature,
      metrics.has(row.feature)
        ? addMetrics(metrics.get(row.feature)!, row)
        : row,
    );
  return [...metrics]
    .map(([feature, value]) => ({ feature, ...value }))
    .sort(
      (a, b) =>
        b.generations - a.generations || a.feature.localeCompare(b.feature),
    );
}

function mergeProviders(
  rows: readonly ServerBreakdownRow[],
  pending: readonly ProviderBreakdownEntry[],
): ProviderBreakdownEntry[] {
  const models = reduceRows(rows);
  for (const provider of pending)
    for (const model of provider.models) {
      const key = `${provider.provider}:${model.model}`;
      models.set(
        key,
        models.has(key) ? addMetrics(models.get(key)!, model) : model,
      );
    }
  const grouped = new Map<string, ProviderBreakdownEntry>();
  for (const [key, metrics] of models) {
    const separator = key.indexOf(":");
    const provider = separator < 0 ? "unknown" : key.slice(0, separator);
    const model = separator < 0 ? key : key.slice(separator + 1);
    const prior = grouped.get(provider);
    grouped.set(
      provider,
      prior
        ? {
            provider,
            models: [...prior.models, { model, ...metrics }],
            ...addMetrics(prior, metrics),
          }
        : { provider, models: [{ model, ...metrics }], ...metrics },
    );
  }
  return [...grouped.values()]
    .map((provider) => ({
      ...provider,
      models: provider.models.sort(
        (a, b) =>
          b.generations - a.generations || a.model.localeCompare(b.model),
      ),
    }))
    .sort(
      (a, b) =>
        b.generations - a.generations || a.provider.localeCompare(b.provider),
    );
}

function mergeFolios(
  rows: readonly ServerBreakdownRow[],
  pending: readonly FolioBreakdownEntry[],
): FolioBreakdownEntry[] {
  const metrics = reduceRows(rows);
  for (const row of pending) {
    const key = row.folioId ?? "__none__";
    metrics.set(
      key,
      metrics.has(key) ? addMetrics(metrics.get(key)!, row) : row,
    );
  }
  return [...metrics]
    .map(([key, value]) => ({
      folioId: key === "__none__" ? null : key,
      ...value,
    }))
    .sort(
      (a, b) =>
        b.generations - a.generations ||
        (a.folioId ?? "").localeCompare(b.folioId ?? ""),
    );
}

export function combineDeskUsage(input: {
  range: UsageRange;
  now: number;
  remoteOverall: ServerUsageMetrics;
  remoteDaily: ServerDailyUsage[];
  remoteBreakdowns: {
    feature: ServerBreakdownRow[];
    provider_model: ServerBreakdownRow[];
    folio: ServerBreakdownRow[];
  };
  remoteWriting: ServerWritingActivity;
  recentServerEvents: UsageEvent[];
  pendingEvents: UsageEvent[];
  localActivities: WritingActivityDetail[];
  folios: FolioUsageMetadata[];
}): UsageSummary {
  const recentEvidence = buildUsageSummary({
    events: [...input.recentServerEvents, ...input.pendingEvents],
    activities: input.localActivities,
    range: input.range,
    now: input.now,
    folios: input.folios,
  });
  const pending = buildUsageSummary({
    events: input.pendingEvents,
    activities: input.localActivities,
    range: input.range,
    now: input.now,
    folios: input.folios,
  });
  const remoteDetails = input.remoteWriting.details.map((detail) => ({
    ...detail,
    activityKey: createWritingActivityKey(detail.day, detail.folioId),
  }));
  const remoteHeatmap = buildWritingHeatmap(
    remoteDetails,
    input.remoteWriting.days,
    input.range,
  );
  const heatmap = mergeHeatmaps(remoteHeatmap, pending.writingHeatmap);
  return {
    ...recentEvidence,
    overall: addMetrics(
      metricsFromServer(input.remoteOverall),
      pending.overall,
    ),
    daily: mergeDaily(input.remoteDaily, pending.daily, heatmap),
    writingHeatmap: heatmap,
    features: mergeFeatures(input.remoteBreakdowns.feature, pending.features),
    providers: mergeProviders(
      input.remoteBreakdowns.provider_model,
      pending.providers,
    ),
    folios: mergeFolios(input.remoteBreakdowns.folio, pending.folios),
  };
}
