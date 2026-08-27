import {
  USAGE_EVENT_VERSION,
  USAGE_LIMITS,
  assertUsageEvent,
  type PricingRateSnapshot,
  type UsageAuthority,
  type UsageCostKind,
  type UsageEvent,
  type UsageOutcome,
  type UsageSource,
} from "./usage-domain";

export const USAGE_EXPORT_VERSION = 1 as const;

export interface ExportedUsageEvent {
  eventKey: string;
  occurredAt: number;
  day: string;
  source: UsageSource;
  authority: UsageAuthority;
  feature: string;
  provider: string;
  model: string;
  folioId?: string;
  editorialActionId?: string;
  traceId: string;
  attempt: number;
  outcome: UsageOutcome;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costMicrousd?: number;
  costKind: UsageCostKind;
  pricingVersion?: string;
  pricing?: PricingRateSnapshot;
  creditMicrounits?: number;
}

export interface UsageExportEnvelope {
  exportVersion: typeof USAGE_EXPORT_VERSION;
  usageEventVersion: typeof USAGE_EVENT_VERSION;
  exportedAt: number;
  contentIncluded: false;
  events: ExportedUsageEvent[];
}

export const USAGE_CSV_COLUMNS = [
  "eventKey",
  "occurredAt",
  "day",
  "source",
  "authority",
  "feature",
  "provider",
  "model",
  "folioId",
  "editorialActionId",
  "traceId",
  "attempt",
  "outcome",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
  "costMicrousd",
  "costKind",
  "pricingVersion",
  "pricingSource",
  "pricingInputMicrousdPerMillion",
  "pricingOutputMicrousdPerMillion",
  "pricingCacheReadMicrousdPerMillion",
  "pricingCacheWriteMicrousdPerMillion",
  "pricingReasoningMicrousdPerMillion",
  "creditMicrounits",
] as const;

/** Explicit reconstruction keeps future or widened input fields out of export. */
export function projectUsageEvent(event: UsageEvent): ExportedUsageEvent {
  assertUsageEvent(event);
  return {
    eventKey: event.eventKey,
    occurredAt: event.occurredAt,
    day: event.day,
    source: event.source,
    authority: event.authority,
    feature: event.feature,
    provider: event.provider,
    model: event.model,
    folioId: event.folioId,
    editorialActionId: event.editorialActionId,
    traceId: event.traceId,
    attempt: event.attempt,
    outcome: event.outcome,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    reasoningTokens: event.reasoningTokens,
    totalTokens: event.totalTokens,
    costMicrousd: event.costMicrousd,
    costKind: event.costKind,
    pricingVersion: event.pricingVersion,
    pricing: event.pricing
      ? {
          source: event.pricing.source,
          version: event.pricing.version,
          currency: "USD",
          inputMicrousdPerMillion: event.pricing.inputMicrousdPerMillion,
          outputMicrousdPerMillion: event.pricing.outputMicrousdPerMillion,
          cacheReadMicrousdPerMillion:
            event.pricing.cacheReadMicrousdPerMillion,
          cacheWriteMicrousdPerMillion:
            event.pricing.cacheWriteMicrousdPerMillion,
          reasoningMicrousdPerMillion:
            event.pricing.reasoningMicrousdPerMillion,
          longContextThresholdTokens: event.pricing.longContextThresholdTokens,
          longInputMicrousdPerMillion:
            event.pricing.longInputMicrousdPerMillion,
          longOutputMicrousdPerMillion:
            event.pricing.longOutputMicrousdPerMillion,
        }
      : undefined,
    creditMicrounits: event.creditMicrounits,
  };
}

export function buildUsageExport(
  events: readonly UsageEvent[],
  exportedAt: number,
): UsageExportEnvelope {
  if (
    !Number.isSafeInteger(exportedAt) ||
    exportedAt < 0 ||
    exportedAt > USAGE_LIMITS.timestamp
  ) {
    throw new RangeError("exportedAt must be a non-negative safe timestamp");
  }
  return {
    exportVersion: USAGE_EXPORT_VERSION,
    usageEventVersion: USAGE_EVENT_VERSION,
    exportedAt,
    contentIncluded: false,
    events: events
      .map(projectUsageEvent)
      .sort(
        (left, right) =>
          left.occurredAt - right.occurredAt ||
          left.eventKey.localeCompare(right.eventKey),
      ),
  };
}

export function serializeUsageExportJson(
  events: readonly UsageEvent[],
  exportedAt: number,
): string {
  return `${JSON.stringify(buildUsageExport(events, exportedAt), null, 2)}\n`;
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = neutralizeSpreadsheetFormula(String(value));
  return `"${text.replaceAll('"', '""')}"`;
}

function eventCsvRow(event: ExportedUsageEvent): string[] {
  return [
    event.eventKey,
    new Date(event.occurredAt).toISOString(),
    event.day,
    event.source,
    event.authority,
    event.feature,
    event.provider,
    event.model,
    event.folioId,
    event.editorialActionId,
    event.traceId,
    event.attempt,
    event.outcome,
    event.inputTokens,
    event.outputTokens,
    event.cacheReadTokens,
    event.cacheWriteTokens,
    event.reasoningTokens,
    event.totalTokens,
    event.costMicrousd,
    event.costKind,
    event.pricingVersion,
    event.pricing?.source,
    event.pricing?.inputMicrousdPerMillion,
    event.pricing?.outputMicrousdPerMillion,
    event.pricing?.cacheReadMicrousdPerMillion,
    event.pricing?.cacheWriteMicrousdPerMillion,
    event.pricing?.reasoningMicrousdPerMillion,
    event.creditMicrounits,
  ].map(csvCell);
}

export function serializeUsageExportCsv(events: readonly UsageEvent[]): string {
  const projected = events
    .map(projectUsageEvent)
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt ||
        left.eventKey.localeCompare(right.eventKey),
    );
  return [
    USAGE_CSV_COLUMNS.map(csvCell).join(","),
    ...projected.map((event) => eventCsvRow(event).join(",")),
  ]
    .join("\r\n")
    .concat("\r\n");
}
