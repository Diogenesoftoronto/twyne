import {
  assertEditorialActionEvidence,
  assertUsageEvent,
  assertWritingActivityDetail,
  isUtcDay,
  timestampInRange,
  utcDayFromTimestamp,
  utcDayStart,
  type EditorialActionEvidence,
  type TokenUsage,
  type UsageEvent,
  type UsageRange,
  type WritingActivityDetail,
} from "./usage-domain";

export interface TokenDimensionCoverage {
  reportedEvents: number;
  missingEvents: number;
}

export interface TokenDimensionTotals extends Required<TokenUsage> {
  coverage: {
    inputTokens: TokenDimensionCoverage;
    outputTokens: TokenDimensionCoverage;
    cacheReadTokens: TokenDimensionCoverage;
    cacheWriteTokens: TokenDimensionCoverage;
    reasoningTokens: TokenDimensionCoverage;
    totalTokens: TokenDimensionCoverage;
  };
  reportedTotalDiscrepancies: number;
}

export interface UsageMetrics {
  generations: number;
  completedGenerations: number;
  failedGenerations: number;
  logicalActions: number;
  completedActions: number;
  failedActions: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
  localGenerations: number;
  unknownCostGenerations: number;
  creditMicrounits: number;
  tokens: TokenDimensionTotals;
}

export interface DailyUsagePoint extends UsageMetrics {
  day: string;
  writingCount: number;
}

export interface WritingHeatmapFolio {
  folioId: string;
  count: number;
  firstOccurredAt: number;
  lastOccurredAt: number;
}

export interface WritingHeatmapDay {
  day: string;
  count: number;
  detailedCount: number;
  legacyCount: number;
  detailComplete: boolean;
  folios: WritingHeatmapFolio[];
}

export interface LegacyWritingDay {
  day: string;
  count: number;
}

export interface FeatureBreakdownEntry extends UsageMetrics {
  feature: string;
}

export interface ModelBreakdownEntry extends UsageMetrics {
  model: string;
}

export interface ProviderBreakdownEntry extends UsageMetrics {
  provider: string;
  models: ModelBreakdownEntry[];
}

export interface FolioBreakdownEntry extends UsageMetrics {
  /** Null is the explicit no-folio bucket. */
  folioId: string | null;
}

export interface EvidencePattern<T> {
  status: "available" | "insufficient";
  evidenceCount: number;
  minimum: number;
  range: UsageRange;
  value?: T;
  ties?: string[];
}

export interface WriterPatterns {
  currentStreak: EvidencePattern<number>;
  longestStreak: EvidencePattern<number>;
  mostActiveWeekday: EvidencePattern<string[]>;
  mostConsultedEditor: EvidencePattern<string[]>;
  mostUsedTool: EvidencePattern<string[]>;
  mostRevisedFolio: EvidencePattern<string[]>;
  deepestRoomSession: EvidencePattern<string[]>;
  distinctEditors: EvidencePattern<number>;
  featureShare: EvidencePattern<
    Array<{ feature: string; actions: number; share: number }>
  >;
  averageKnownCostPerActiveFolio: EvidencePattern<{
    averageMicrousd: number;
    knownCostMicrousd: number;
    folioCount: number;
  }>;
}

export interface FolioUsageMetadata {
  folioId: string;
  currentWords: number;
  updatedAt: number;
}

export interface RecentWorkEntry {
  folioId: string;
  lastActiveAt: number;
  currentWords: number;
  activeDays: number;
  editorialActions: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
}

export interface UsageSummary {
  range: UsageRange;
  overall: UsageMetrics;
  daily: DailyUsagePoint[];
  writingHeatmap: WritingHeatmapDay[];
  features: FeatureBreakdownEntry[];
  providers: ProviderBreakdownEntry[];
  folios: FolioBreakdownEntry[];
  patterns: WriterPatterns;
  recentWork: RecentWorkEntry[];
}

export interface ReconciliationResult {
  ok: boolean;
  issues: string[];
}

const TOKEN_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
] as const;

function emptyCoverage(): TokenDimensionCoverage {
  return { reportedEvents: 0, missingEvents: 0 };
}

function emptyTokens(): TokenDimensionTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    coverage: {
      inputTokens: emptyCoverage(),
      outputTokens: emptyCoverage(),
      cacheReadTokens: emptyCoverage(),
      cacheWriteTokens: emptyCoverage(),
      reasoningTokens: emptyCoverage(),
      totalTokens: emptyCoverage(),
    },
    reportedTotalDiscrepancies: 0,
  };
}

function emptyMetrics(): UsageMetrics {
  return {
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
    tokens: emptyTokens(),
  };
}

function eventActionId(event: UsageEvent): string {
  return event.editorialActionId ?? `generation:${event.eventKey}`;
}

function uniqueEvents(
  events: readonly UsageEvent[],
  range: UsageRange,
): UsageEvent[] {
  const byKey = new Map<string, UsageEvent>();
  for (const event of events) {
    assertUsageEvent(event);
    if (!timestampInRange(event.occurredAt, range)) continue;
    const prior = byKey.get(event.eventKey);
    if (!prior || event.occurredAt < prior.occurredAt)
      byKey.set(event.eventKey, event);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.occurredAt - right.occurredAt ||
      left.eventKey.localeCompare(right.eventKey),
  );
}

function deriveActions(
  events: readonly UsageEvent[],
): EditorialActionEvidence[] {
  const grouped = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = eventActionId(event);
    const rows = grouped.get(key) ?? [];
    rows.push(event);
    grouped.set(key, rows);
  }
  return [...grouped.entries()].map(([actionId, rows]) => {
    const ordered = [...rows].sort(
      (left, right) =>
        left.occurredAt - right.occurredAt ||
        left.eventKey.localeCompare(right.eventKey),
    );
    const first = ordered[0];
    return {
      actionId,
      occurredAt: first.occurredAt,
      feature: first.feature,
      outcome: rows.some((row) => row.outcome === "completed")
        ? "completed"
        : "failed",
      folioId: first.folioId,
    };
  });
}

function normalizeActions(
  events: readonly UsageEvent[],
  supplied: readonly EditorialActionEvidence[] | undefined,
  range: UsageRange,
): EditorialActionEvidence[] {
  const source = supplied ?? deriveActions(events);
  const byId = new Map<string, EditorialActionEvidence>();
  for (const action of source) {
    assertEditorialActionEvidence(action);
    if (!timestampInRange(action.occurredAt, range)) continue;
    const prior = byId.get(action.actionId);
    if (!prior || action.occurredAt < prior.occurredAt)
      byId.set(action.actionId, action);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.occurredAt - right.occurredAt ||
      left.actionId.localeCompare(right.actionId),
  );
}

function addEventsToMetrics(
  metrics: UsageMetrics,
  events: readonly UsageEvent[],
): void {
  const actionOutcomes = new Map<string, "completed" | "failed">();
  for (const event of events) {
    metrics.generations += 1;
    if (event.outcome === "completed") metrics.completedGenerations += 1;
    else metrics.failedGenerations += 1;
    const actionId = eventActionId(event);
    if (event.outcome === "completed" || !actionOutcomes.has(actionId)) {
      actionOutcomes.set(actionId, event.outcome);
    }
    if (event.costKind === "actual")
      metrics.actualCostMicrousd += event.costMicrousd ?? 0;
    else if (event.costKind === "estimated")
      metrics.estimatedCostMicrousd += event.costMicrousd ?? 0;
    else if (event.costKind === "local") metrics.localGenerations += 1;
    else metrics.unknownCostGenerations += 1;
    metrics.creditMicrounits += event.creditMicrounits ?? 0;
    for (const key of TOKEN_KEYS) {
      const value = event[key];
      const coverage = metrics.tokens.coverage[key];
      if (value === undefined) coverage.missingEvents += 1;
      else {
        coverage.reportedEvents += 1;
        metrics.tokens[key] += value;
      }
    }
    if (
      event.totalTokens !== undefined &&
      event.inputTokens !== undefined &&
      event.outputTokens !== undefined &&
      event.totalTokens !== event.inputTokens + event.outputTokens
    ) {
      metrics.tokens.reportedTotalDiscrepancies += 1;
    }
  }
  metrics.logicalActions = actionOutcomes.size;
  for (const outcome of actionOutcomes.values()) {
    if (outcome === "completed") metrics.completedActions += 1;
    else metrics.failedActions += 1;
  }
}

function metricsFor(events: readonly UsageEvent[]): UsageMetrics {
  const metrics = emptyMetrics();
  addEventsToMetrics(metrics, events);
  return metrics;
}

function assignActionTotals(
  metrics: UsageMetrics,
  actions: readonly EditorialActionEvidence[],
): void {
  metrics.logicalActions = actions.length;
  metrics.completedActions = actions.filter(
    (action) => action.outcome === "completed",
  ).length;
  metrics.failedActions = actions.length - metrics.completedActions;
}

function metricSort<T>(
  rows: T[],
  metrics: (row: T) => UsageMetrics,
  label: (row: T) => string,
): T[] {
  return rows.sort(
    (left, right) =>
      metrics(right).generations - metrics(left).generations ||
      label(left).localeCompare(label(right)),
  );
}

function groupedEvents(
  events: readonly UsageEvent[],
  keyFor: (event: UsageEvent) => string,
): Map<string, UsageEvent[]> {
  const groups = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = keyFor(event);
    const rows = groups.get(key) ?? [];
    rows.push(event);
    groups.set(key, rows);
  }
  return groups;
}

export function buildWritingHeatmap(
  activities: readonly WritingActivityDetail[],
  legacyDays: readonly LegacyWritingDay[],
  range: UsageRange,
): WritingHeatmapDay[] {
  const detailByDay = new Map<string, Map<string, WritingHeatmapFolio>>();
  for (const activity of activities) {
    assertWritingActivityDetail(activity);
    const timestamp = utcDayStart(activity.day);
    if (!timestampInRange(timestamp, range)) continue;
    const byFolio =
      detailByDay.get(activity.day) ?? new Map<string, WritingHeatmapFolio>();
    const prior = byFolio.get(activity.folioId);
    byFolio.set(activity.folioId, {
      folioId: activity.folioId,
      count: (prior?.count ?? 0) + activity.count,
      firstOccurredAt: Math.min(
        prior?.firstOccurredAt ?? activity.firstOccurredAt,
        activity.firstOccurredAt,
      ),
      lastOccurredAt: Math.max(
        prior?.lastOccurredAt ?? activity.lastOccurredAt,
        activity.lastOccurredAt,
      ),
    });
    detailByDay.set(activity.day, byFolio);
  }
  const legacyByDay = new Map<string, number>();
  for (const legacy of legacyDays) {
    if (
      !isUtcDay(legacy.day) ||
      !Number.isSafeInteger(legacy.count) ||
      legacy.count < 0
    )
      continue;
    if (!timestampInRange(utcDayStart(legacy.day), range)) continue;
    legacyByDay.set(
      legacy.day,
      Math.max(legacyByDay.get(legacy.day) ?? 0, legacy.count),
    );
  }
  const days = new Set([...detailByDay.keys(), ...legacyByDay.keys()]);
  return [...days].sort().map((day) => {
    const folios = [...(detailByDay.get(day)?.values() ?? [])].sort(
      (left, right) =>
        right.count - left.count || left.folioId.localeCompare(right.folioId),
    );
    const detailedCount = folios.reduce(
      (total, folio) => total + folio.count,
      0,
    );
    const legacyCount = legacyByDay.get(day) ?? 0;
    return {
      day,
      count: Math.max(detailedCount, legacyCount),
      detailedCount,
      legacyCount,
      detailComplete: legacyCount === 0 || detailedCount >= legacyCount,
      folios,
    };
  });
}

function buildDaily(
  events: readonly UsageEvent[],
  actions: readonly EditorialActionEvidence[],
  heatmap: readonly WritingHeatmapDay[],
): DailyUsagePoint[] {
  const eventsByDay = groupedEvents(events, (event) => event.day);
  const actionsByDay = new Map<string, EditorialActionEvidence[]>();
  for (const action of actions) {
    const day = utcDayFromTimestamp(action.occurredAt);
    const rows = actionsByDay.get(day) ?? [];
    rows.push(action);
    actionsByDay.set(day, rows);
  }
  const writingByDay = new Map(heatmap.map((day) => [day.day, day.count]));
  const days = new Set([
    ...eventsByDay.keys(),
    ...actionsByDay.keys(),
    ...writingByDay.keys(),
  ]);
  return [...days].sort().map((day) => {
    const metrics = metricsFor(eventsByDay.get(day) ?? []);
    assignActionTotals(metrics, actionsByDay.get(day) ?? []);
    return { day, writingCount: writingByDay.get(day) ?? 0, ...metrics };
  });
}

function buildFeatures(
  events: readonly UsageEvent[],
  actions: readonly EditorialActionEvidence[],
): FeatureBreakdownEntry[] {
  const actionsByFeature = new Map<string, EditorialActionEvidence[]>();
  for (const action of actions) {
    const rows = actionsByFeature.get(action.feature) ?? [];
    rows.push(action);
    actionsByFeature.set(action.feature, rows);
  }
  const groups = groupedEvents(events, (event) => event.feature);
  const keys = new Set([...groups.keys(), ...actionsByFeature.keys()]);
  return metricSort(
    [...keys].map((feature) => {
      const metrics = metricsFor(groups.get(feature) ?? []);
      assignActionTotals(metrics, actionsByFeature.get(feature) ?? []);
      return { feature, ...metrics };
    }),
    (row) => row,
    (row) => row.feature,
  );
}

function buildProviders(
  events: readonly UsageEvent[],
): ProviderBreakdownEntry[] {
  const providerGroups = groupedEvents(events, (event) => event.provider);
  return metricSort(
    [...providerGroups.entries()].map(([provider, providerEvents]) => {
      const modelGroups = groupedEvents(providerEvents, (event) => event.model);
      const models = metricSort(
        [...modelGroups.entries()].map(([model, modelEvents]) => ({
          model,
          ...metricsFor(modelEvents),
        })),
        (row) => row,
        (row) => row.model,
      );
      return { provider, models, ...metricsFor(providerEvents) };
    }),
    (row) => row,
    (row) => row.provider,
  );
}

function buildFolios(
  events: readonly UsageEvent[],
  actions: readonly EditorialActionEvidence[],
): FolioBreakdownEntry[] {
  const noFolio = "\u0000no-folio";
  const groups = groupedEvents(events, (event) => event.folioId ?? noFolio);
  const actionsByFolio = new Map<string, EditorialActionEvidence[]>();
  for (const action of actions) {
    const key = action.folioId ?? noFolio;
    const rows = actionsByFolio.get(key) ?? [];
    rows.push(action);
    actionsByFolio.set(key, rows);
  }
  const keys = new Set([...groups.keys(), ...actionsByFolio.keys()]);
  return metricSort(
    [...keys].map((folioId) => {
      const metrics = metricsFor(groups.get(folioId) ?? []);
      assignActionTotals(metrics, actionsByFolio.get(folioId) ?? []);
      return { folioId: folioId === noFolio ? null : folioId, ...metrics };
    }),
    (row) => row,
    (row) => row.folioId ?? "",
  );
}

function insufficient<T>(
  evidenceCount: number,
  minimum: number,
  range: UsageRange,
): EvidencePattern<T> {
  return { status: "insufficient", evidenceCount, minimum, range };
}

function available<T>(
  value: T,
  evidenceCount: number,
  minimum: number,
  range: UsageRange,
  ties?: string[],
): EvidencePattern<T> {
  return { status: "available", evidenceCount, minimum, range, value, ties };
}

function leaders(counts: Map<string, number>): string[] {
  const maximum = Math.max(0, ...counts.values());
  return [...counts.entries()]
    .filter(([, count]) => count === maximum)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

function streakLengths(activeDays: readonly string[]): number[] {
  if (activeDays.length === 0) return [];
  const sorted = [...new Set(activeDays)].sort();
  const lengths: number[] = [];
  let current = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap =
      (utcDayStart(sorted[index]) - utcDayStart(sorted[index - 1])) /
      86_400_000;
    if (gap === 1) current += 1;
    else {
      lengths.push(current);
      current = 1;
    }
  }
  lengths.push(current);
  return lengths;
}

function currentStreak(activeDays: readonly string[], now: number): number {
  const days = [...new Set(activeDays)].sort();
  if (days.length === 0) return 0;
  const todayStart = utcDayStart(utcDayFromTimestamp(now));
  const lastStart = utcDayStart(days[days.length - 1]);
  const distance = (todayStart - lastStart) / 86_400_000;
  if (distance !== 0 && distance !== 1) return 0;
  let length = 1;
  for (let index = days.length - 1; index > 0; index -= 1) {
    if (utcDayStart(days[index]) - utcDayStart(days[index - 1]) !== 86_400_000)
      break;
    length += 1;
  }
  return length;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function deriveWriterPatterns(input: {
  events: readonly UsageEvent[];
  activities: readonly WritingHeatmapDay[];
  actions: readonly EditorialActionEvidence[];
  range: UsageRange;
  now: number;
}): WriterPatterns {
  const activeDays = input.activities
    .filter((day) => day.count > 0)
    .map((day) => day.day);
  const streaks = streakLengths(activeDays);
  const current = currentStreak(activeDays, input.now);
  const longest = Math.max(0, ...streaks);

  const weekdayCounts = new Map<string, number>();
  for (const day of activeDays) {
    const weekday = WEEKDAYS[new Date(utcDayStart(day)).getUTCDay()];
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
  }
  const editorActions = input.actions.filter((action) => action.editorId);
  const editorCounts = new Map<string, number>();
  for (const action of editorActions) {
    editorCounts.set(
      action.editorId!,
      (editorCounts.get(action.editorId!) ?? 0) + 1,
    );
  }
  const featureCounts = new Map<string, number>();
  for (const action of input.actions) {
    featureCounts.set(
      action.feature,
      (featureCounts.get(action.feature) ?? 0) + 1,
    );
  }
  const revisionActions = input.actions.filter(
    (action) => action.revision && action.folioId,
  );
  const revisionCounts = new Map<string, number>();
  for (const action of revisionActions) {
    revisionCounts.set(
      action.folioId!,
      (revisionCounts.get(action.folioId!) ?? 0) + 1,
    );
  }
  const sessionActions = input.actions.filter((action) => action.sessionId);
  const sessionTurns = new Map<string, number>();
  for (const action of sessionActions) {
    sessionTurns.set(
      action.sessionId!,
      (sessionTurns.get(action.sessionId!) ?? 0) + (action.turnCount ?? 1),
    );
  }
  const knownCostByFolio = new Map<string, number>();
  for (const event of input.events) {
    if (
      !event.folioId ||
      (event.costKind !== "actual" && event.costKind !== "estimated")
    )
      continue;
    knownCostByFolio.set(
      event.folioId,
      (knownCostByFolio.get(event.folioId) ?? 0) + (event.costMicrousd ?? 0),
    );
  }
  const knownCostTotal = [...knownCostByFolio.values()].reduce(
    (sum, cost) => sum + cost,
    0,
  );
  const featureTotal = [...featureCounts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const featureShare = [...featureCounts.entries()]
    .map(([feature, actions]) => ({
      feature,
      actions,
      share: featureTotal === 0 ? 0 : actions / featureTotal,
    }))
    .sort(
      (left, right) =>
        right.actions - left.actions ||
        left.feature.localeCompare(right.feature),
    );

  return {
    currentStreak:
      activeDays.length >= 1
        ? available(current, activeDays.length, 1, input.range)
        : insufficient(activeDays.length, 1, input.range),
    longestStreak:
      activeDays.length >= 2
        ? available(longest, activeDays.length, 2, input.range)
        : insufficient(activeDays.length, 2, input.range),
    mostActiveWeekday:
      activeDays.length >= 5
        ? available(
            leaders(weekdayCounts),
            activeDays.length,
            5,
            input.range,
            leaders(weekdayCounts),
          )
        : insufficient(activeDays.length, 5, input.range),
    mostConsultedEditor:
      editorActions.length >= 5
        ? available(
            leaders(editorCounts),
            editorActions.length,
            5,
            input.range,
            leaders(editorCounts),
          )
        : insufficient(editorActions.length, 5, input.range),
    mostUsedTool:
      input.actions.length >= 5
        ? available(
            leaders(featureCounts),
            input.actions.length,
            5,
            input.range,
            leaders(featureCounts),
          )
        : insufficient(input.actions.length, 5, input.range),
    mostRevisedFolio:
      revisionCounts.size >= 2
        ? available(
            leaders(revisionCounts),
            revisionCounts.size,
            2,
            input.range,
            leaders(revisionCounts),
          )
        : insufficient(revisionCounts.size, 2, input.range),
    deepestRoomSession:
      sessionTurns.size >= 2
        ? available(
            leaders(sessionTurns),
            sessionTurns.size,
            2,
            input.range,
            leaders(sessionTurns),
          )
        : insufficient(sessionTurns.size, 2, input.range),
    distinctEditors:
      editorCounts.size >= 1
        ? available(editorCounts.size, editorCounts.size, 1, input.range)
        : insufficient(0, 1, input.range),
    featureShare:
      featureTotal >= 5
        ? available(featureShare, featureTotal, 5, input.range)
        : insufficient(featureTotal, 5, input.range),
    averageKnownCostPerActiveFolio:
      knownCostByFolio.size >= 2
        ? available(
            {
              averageMicrousd: Math.round(
                knownCostTotal / knownCostByFolio.size,
              ),
              knownCostMicrousd: knownCostTotal,
              folioCount: knownCostByFolio.size,
            },
            knownCostByFolio.size,
            2,
            input.range,
          )
        : insufficient(knownCostByFolio.size, 2, input.range),
  };
}

function buildRecentWork(
  events: readonly UsageEvent[],
  actions: readonly EditorialActionEvidence[],
  activities: readonly WritingActivityDetail[],
  folios: readonly FolioUsageMetadata[],
  range: UsageRange,
): RecentWorkEntry[] {
  return folios
    .map((folio) => {
      const folioEvents = events.filter(
        (event) => event.folioId === folio.folioId,
      );
      const folioActions = actions.filter(
        (action) => action.folioId === folio.folioId,
      );
      const folioActivity = activities.filter(
        (activity) =>
          activity.folioId === folio.folioId &&
          timestampInRange(utcDayStart(activity.day), range),
      );
      return {
        folioId: folio.folioId,
        lastActiveAt: Math.max(
          folio.updatedAt,
          ...folioActivity.map((activity) => activity.lastOccurredAt),
          ...folioEvents.map((event) => event.occurredAt),
          ...folioActions.map((action) => action.occurredAt),
        ),
        currentWords: folio.currentWords,
        activeDays: new Set(folioActivity.map((activity) => activity.day)).size,
        editorialActions: folioActions.length,
        actualCostMicrousd: folioEvents.reduce(
          (sum, event) =>
            sum + (event.costKind === "actual" ? (event.costMicrousd ?? 0) : 0),
          0,
        ),
        estimatedCostMicrousd: folioEvents.reduce(
          (sum, event) =>
            sum +
            (event.costKind === "estimated" ? (event.costMicrousd ?? 0) : 0),
          0,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.lastActiveAt - left.lastActiveAt ||
        left.folioId.localeCompare(right.folioId),
    );
}

export function buildUsageSummary(input: {
  events: readonly UsageEvent[];
  activities: readonly WritingActivityDetail[];
  range: UsageRange;
  now: number;
  actions?: readonly EditorialActionEvidence[];
  legacyWritingDays?: readonly LegacyWritingDay[];
  folios?: readonly FolioUsageMetadata[];
}): UsageSummary {
  const events = uniqueEvents(input.events, input.range);
  const actions = normalizeActions(events, input.actions, input.range);
  const heatmap = buildWritingHeatmap(
    input.activities,
    input.legacyWritingDays ?? [],
    input.range,
  );
  const overall = metricsFor(events);
  assignActionTotals(overall, actions);
  return {
    range: input.range,
    overall,
    daily: buildDaily(events, actions, heatmap),
    writingHeatmap: heatmap,
    features: buildFeatures(events, actions),
    providers: buildProviders(events),
    folios: buildFolios(events, actions),
    patterns: deriveWriterPatterns({
      events,
      activities: heatmap,
      actions,
      range: input.range,
      now: input.now,
    }),
    recentWork: buildRecentWork(
      events,
      actions,
      input.activities,
      input.folios ?? [],
      input.range,
    ),
  };
}

function sumMetrics(rows: readonly UsageMetrics[]): UsageMetrics {
  const sum = emptyMetrics();
  for (const row of rows) {
    sum.generations += row.generations;
    sum.completedGenerations += row.completedGenerations;
    sum.failedGenerations += row.failedGenerations;
    sum.logicalActions += row.logicalActions;
    sum.completedActions += row.completedActions;
    sum.failedActions += row.failedActions;
    sum.actualCostMicrousd += row.actualCostMicrousd;
    sum.estimatedCostMicrousd += row.estimatedCostMicrousd;
    sum.localGenerations += row.localGenerations;
    sum.unknownCostGenerations += row.unknownCostGenerations;
    sum.creditMicrounits += row.creditMicrounits;
    for (const key of TOKEN_KEYS) sum.tokens[key] += row.tokens[key];
  }
  return sum;
}

function compareAdditive(
  expected: UsageMetrics,
  actual: UsageMetrics,
  view: string,
  issues: string[],
): void {
  for (const key of [
    "generations",
    "completedGenerations",
    "failedGenerations",
    "actualCostMicrousd",
    "estimatedCostMicrousd",
    "localGenerations",
    "unknownCostGenerations",
    "creditMicrounits",
  ] as const) {
    if (expected[key] !== actual[key])
      issues.push(`${view}.${key} does not reconcile`);
  }
  for (const key of TOKEN_KEYS) {
    if (expected.tokens[key] !== actual.tokens[key]) {
      issues.push(`${view}.tokens.${key} does not reconcile`);
    }
  }
}

function compareActions(
  expected: UsageMetrics,
  actual: UsageMetrics,
  view: string,
  issues: string[],
): void {
  for (const key of [
    "logicalActions",
    "completedActions",
    "failedActions",
  ] as const) {
    if (expected[key] !== actual[key])
      issues.push(`${view}.${key} does not reconcile`);
  }
}

/** Verify every additive graph is another view of the same selected events. */
export function reconcileUsageSummary(
  summary: UsageSummary,
): ReconciliationResult {
  const issues: string[] = [];
  const daily = sumMetrics(summary.daily);
  const features = sumMetrics(summary.features);
  const folios = sumMetrics(summary.folios);
  compareAdditive(summary.overall, daily, "daily", issues);
  compareActions(summary.overall, daily, "daily", issues);
  compareAdditive(summary.overall, features, "features", issues);
  compareActions(summary.overall, features, "features", issues);
  compareAdditive(
    summary.overall,
    sumMetrics(summary.providers),
    "providers",
    issues,
  );
  compareAdditive(summary.overall, folios, "folios", issues);
  compareActions(summary.overall, folios, "folios", issues);
  const writingTotal = summary.writingHeatmap.reduce(
    (sum, day) => sum + day.count,
    0,
  );
  const dailyWritingTotal = summary.daily.reduce(
    (sum, day) => sum + day.writingCount,
    0,
  );
  if (writingTotal !== dailyWritingTotal)
    issues.push("daily.writingCount does not reconcile");
  return { ok: issues.length === 0, issues };
}
