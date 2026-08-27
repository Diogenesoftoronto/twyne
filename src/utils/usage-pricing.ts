import {
  MILLION_TOKENS,
  USAGE_LIMITS,
  type PricingRateSnapshot,
  type TokenUsage,
  type UsageCostKind,
  type UsageSource,
} from "./usage-domain";

export const USAGE_PRICING_CATALOG_VERSION = "2026-08-26" as const;
export const USAGE_PRICING_SOURCE = "official-provider-docs" as const;

export interface PricingCatalogEntry extends PricingRateSnapshot {
  provider: string;
  model: string;
  aliases?: readonly string[];
}

export interface PricingCatalog {
  version: string;
  source: string;
  entries: readonly PricingCatalogEntry[];
}

/**
 * Small launch catalog, pinned from official first-party price pages on the
 * version date. A missing model or unsupported reported dimension is unknown,
 * never a zero-dollar estimate.
 *
 * Sources:
 * - https://developers.openai.com/api/docs/models/gpt-5.5
 * - https://platform.claude.com/docs/en/models/sonnet-4-6/overview
 * - https://ai.google.dev/gemini-api/docs/gemini-3
 */
export const PINNED_USAGE_PRICING_CATALOG: PricingCatalog = Object.freeze({
  version: USAGE_PRICING_CATALOG_VERSION,
  source: USAGE_PRICING_SOURCE,
  entries: Object.freeze([
    Object.freeze({
      provider: "openai",
      model: "gpt-5.5",
      aliases: Object.freeze(["gpt-5.5-2026-04-23"]),
      source: "https://developers.openai.com/api/docs/models/gpt-5.5",
      version: USAGE_PRICING_CATALOG_VERSION,
      currency: "USD" as const,
      inputMicrousdPerMillion: 5_000_000,
      cacheReadMicrousdPerMillion: 500_000,
      outputMicrousdPerMillion: 30_000_000,
    }),
    Object.freeze({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      source: "https://platform.claude.com/docs/en/models/sonnet-4-6/overview",
      version: USAGE_PRICING_CATALOG_VERSION,
      currency: "USD" as const,
      inputMicrousdPerMillion: 3_000_000,
      cacheReadMicrousdPerMillion: 300_000,
      // Anthropic has distinct 5-minute and 1-hour cache-write prices. The
      // canonical usage shape cannot distinguish them, so writes stay unknown.
      outputMicrousdPerMillion: 15_000_000,
    }),
    Object.freeze({
      provider: "google",
      model: "gemini-3.1-pro-preview",
      source: "https://ai.google.dev/gemini-api/docs/gemini-3",
      version: USAGE_PRICING_CATALOG_VERSION,
      currency: "USD" as const,
      inputMicrousdPerMillion: 2_000_000,
      outputMicrousdPerMillion: 12_000_000,
      longContextThresholdTokens: 200_000,
      longInputMicrousdPerMillion: 4_000_000,
      longOutputMicrousdPerMillion: 18_000_000,
    }),
  ]),
});

export type UnknownPricingReason =
  | "unknown_model"
  | "missing_usage"
  | "invalid_usage"
  | "unsupported_cache_read"
  | "unsupported_cache_write"
  | "unsafe_cost";

export type UsagePricingResult =
  | {
      kind: "estimated";
      costMicrousd: number;
      pricingVersion: string;
      pricing: PricingRateSnapshot;
    }
  | { kind: "local" }
  | { kind: "unknown"; reason: UnknownPricingReason };

export interface ResolvedUsageCost {
  kind: UsageCostKind;
  costMicrousd?: number;
  pricingVersion?: string;
  pricing?: PricingRateSnapshot;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function resolvePricingEntry(
  provider: string,
  model: string,
  catalog: PricingCatalog = PINNED_USAGE_PRICING_CATALOG,
): PricingCatalogEntry | null {
  const providerKey = normalizeKey(provider);
  const modelKey = normalizeKey(model);
  const providerEntries = catalog.entries.filter(
    (entry) => normalizeKey(entry.provider) === providerKey,
  );
  const exact = providerEntries.find(
    (entry) => normalizeKey(entry.model) === modelKey,
  );
  if (exact) return exact;
  return (
    providerEntries.find((entry) =>
      entry.aliases?.some((alias) => normalizeKey(alias) === modelKey),
    ) ?? null
  );
}

function validTokenCount(value: number | undefined): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= USAGE_LIMITS.tokenCount)
  );
}

function hasReportedUsage(usage: TokenUsage): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.reasoningTokens,
    usage.totalTokens,
  ].some((value) => value !== undefined);
}

function hasPricedDimensions(usage: TokenUsage): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.reasoningTokens,
  ].some((value) => value !== undefined);
}

function roundedMicrousd(
  components: ReadonlyArray<{ tokens: number; rate: number }>,
): number | null {
  let numerator = 0n;
  for (const component of components) {
    numerator += BigInt(component.tokens) * BigInt(component.rate);
  }
  const rounded =
    (numerator + BigInt(MILLION_TOKENS / 2)) / BigInt(MILLION_TOKENS);
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

function pricingSnapshot(
  entry: PricingCatalogEntry,
  inputRate: number,
  outputRate: number,
): PricingRateSnapshot {
  return {
    source: entry.source,
    version: entry.version,
    currency: "USD",
    inputMicrousdPerMillion: inputRate,
    outputMicrousdPerMillion: outputRate,
    cacheReadMicrousdPerMillion: entry.cacheReadMicrousdPerMillion,
    cacheWriteMicrousdPerMillion: entry.cacheWriteMicrousdPerMillion,
    reasoningMicrousdPerMillion: entry.reasoningMicrousdPerMillion,
    longContextThresholdTokens: entry.longContextThresholdTokens,
    longInputMicrousdPerMillion: entry.longInputMicrousdPerMillion,
    longOutputMicrousdPerMillion: entry.longOutputMicrousdPerMillion,
  };
}

/**
 * Estimate one provider attempt. Input totals are treated as including cached
 * input; reasoning totals are treated as included in output unless the catalog
 * supplies a distinct reasoning rate. This avoids double charging overlapping
 * provider counters.
 */
export function estimateUsageCost(input: {
  source: UsageSource;
  provider: string;
  model: string;
  usage: TokenUsage;
  catalog?: PricingCatalog;
}): UsagePricingResult {
  if (input.source === "local") return { kind: "local" };
  const values = [
    input.usage.inputTokens,
    input.usage.outputTokens,
    input.usage.cacheReadTokens,
    input.usage.cacheWriteTokens,
    input.usage.reasoningTokens,
    input.usage.totalTokens,
  ];
  if (!values.every(validTokenCount))
    return { kind: "unknown", reason: "invalid_usage" };
  if (!hasReportedUsage(input.usage))
    return { kind: "unknown", reason: "missing_usage" };
  if (!hasPricedDimensions(input.usage))
    return { kind: "unknown", reason: "missing_usage" };

  const entry = resolvePricingEntry(
    input.provider,
    input.model,
    input.catalog ?? PINNED_USAGE_PRICING_CATALOG,
  );
  if (!entry) return { kind: "unknown", reason: "unknown_model" };

  const cacheRead = input.usage.cacheReadTokens ?? 0;
  const cacheWrite = input.usage.cacheWriteTokens ?? 0;
  const inputTokens = input.usage.inputTokens ?? 0;
  const outputTokens = input.usage.outputTokens ?? 0;
  const reasoning = input.usage.reasoningTokens ?? 0;
  if (cacheRead + cacheWrite > inputTokens || reasoning > outputTokens) {
    return { kind: "unknown", reason: "invalid_usage" };
  }
  if (cacheRead > 0 && entry.cacheReadMicrousdPerMillion === undefined) {
    return { kind: "unknown", reason: "unsupported_cache_read" };
  }
  if (cacheWrite > 0 && entry.cacheWriteMicrousdPerMillion === undefined) {
    return { kind: "unknown", reason: "unsupported_cache_write" };
  }

  const longContext =
    entry.longContextThresholdTokens !== undefined &&
    inputTokens > entry.longContextThresholdTokens;
  const inputRate = longContext
    ? (entry.longInputMicrousdPerMillion ?? entry.inputMicrousdPerMillion)
    : entry.inputMicrousdPerMillion;
  const outputRate = longContext
    ? (entry.longOutputMicrousdPerMillion ?? entry.outputMicrousdPerMillion)
    : entry.outputMicrousdPerMillion;
  const billableInput = inputTokens - cacheRead - cacheWrite;
  const billableOutput =
    entry.reasoningMicrousdPerMillion === undefined
      ? outputTokens
      : outputTokens - reasoning;
  const components = [
    { tokens: billableInput, rate: inputRate },
    { tokens: billableOutput, rate: outputRate },
    ...(cacheRead > 0
      ? [{ tokens: cacheRead, rate: entry.cacheReadMicrousdPerMillion! }]
      : []),
    ...(cacheWrite > 0
      ? [{ tokens: cacheWrite, rate: entry.cacheWriteMicrousdPerMillion! }]
      : []),
    ...(reasoning > 0 && entry.reasoningMicrousdPerMillion !== undefined
      ? [{ tokens: reasoning, rate: entry.reasoningMicrousdPerMillion }]
      : []),
  ];
  const costMicrousd = roundedMicrousd(components);
  if (costMicrousd === null) return { kind: "unknown", reason: "unsafe_cost" };
  return {
    kind: "estimated",
    costMicrousd,
    pricingVersion: entry.version,
    pricing: pricingSnapshot(entry, inputRate, outputRate),
  };
}

function safeMoney(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

/** Trusted/provider charges outrank estimates; local never becomes $0. */
export function resolveUsageCost(input: {
  source: UsageSource;
  actualCostMicrousd?: number;
  providerReportedCostMicrousd?: number;
  estimate: UsagePricingResult;
}): ResolvedUsageCost {
  if (safeMoney(input.actualCostMicrousd)) {
    return { kind: "actual", costMicrousd: input.actualCostMicrousd };
  }
  if (safeMoney(input.providerReportedCostMicrousd)) {
    return { kind: "actual", costMicrousd: input.providerReportedCostMicrousd };
  }
  if (input.source === "local" || input.estimate.kind === "local") {
    return { kind: "local" };
  }
  if (input.estimate.kind === "estimated") {
    return {
      kind: "estimated",
      costMicrousd: input.estimate.costMicrousd,
      pricingVersion: input.estimate.pricingVersion,
      pricing: input.estimate.pricing,
    };
  }
  return { kind: "unknown" };
}
