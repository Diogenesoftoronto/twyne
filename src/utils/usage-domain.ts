/**
 * Content-free usage contracts shared by the browser ledger, Convex, and My
 * Desk derivations. These records deliberately describe provider attempts and
 * writing activity without carrying manuscript or generated text.
 */

export const USAGE_EVENT_VERSION = 1 as const;
export const MICRO_USD_PER_USD = 1_000_000;
export const MILLION_TOKENS = 1_000_000;

export const USAGE_LIMITS = {
  eventKey: 1_024,
  feature: 128,
  provider: 128,
  model: 256,
  opaqueId: 512,
  traceId: 512,
  pricingLabel: 256,
  tokenCount: 1_000_000_000_000,
  attempt: 1_000_000,
  activityCount: 1_000_000_000,
  timestamp: 8_640_000_000_000_000,
} as const;

/**
 * Launch vocabulary shared by browser and hosted ledgers. Keep this list
 * finite: feature ids are user-visible breakdown keys and therefore cannot be
 * accepted as attacker-controlled cardinality. `other` is the explicit
 * forward-compatibility bucket for trusted capture code; public write
 * validators still reject arbitrary strings.
 */
export const USAGE_AI_FEATURES = [
  "persona-feedback",
  "persona-reply",
  "persona-rewrite",
  "persona-analysis",
  "room-synthesis",
  "rubric-judge",
  "rubric-review",
  "voice-narration",
  "voice-transcription",
  "comment-reply",
  "citation-format",
  "source-summarize",
  "source-detect-missing",
  "research-web-search",
  "research-extract",
  "interview-turn",
  "dossier-check",
  "other",
] as const;

const USAGE_AI_FEATURE_SET: ReadonlySet<string> = new Set(USAGE_AI_FEATURES);

export type UsageSource = "hosted" | "byok" | "local";
export type UsageAuthority = "server" | "provider" | "client_reported";
export type UsageOutcome = "completed" | "failed";
export type UsageCostKind = "actual" | "estimated" | "local" | "unknown";
export type UsageRangePreset = "7d" | "30d" | "90d" | "all";

export type AiFeature = (typeof USAGE_AI_FEATURES)[number];

export function isUsageAiFeature(value: unknown): value is AiFeature {
  return typeof value === "string" && USAGE_AI_FEATURE_SET.has(value);
}

/** Trusted capture fallback for a feature introduced before this catalog. */
export function normalizeUsageAiFeature(value: unknown): AiFeature {
  return isUsageAiFeature(value) ? value : "other";
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface PricingRateSnapshot {
  source: string;
  version: string;
  currency: "USD";
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
  cacheReadMicrousdPerMillion?: number;
  cacheWriteMicrousdPerMillion?: number;
  reasoningMicrousdPerMillion?: number;
  longContextThresholdTokens?: number;
  longInputMicrousdPerMillion?: number;
  longOutputMicrousdPerMillion?: number;
}

export interface UsageEvent extends TokenUsage {
  eventKey: string;
  occurredAt: number;
  /** UTC calendar day, formatted YYYY-MM-DD. */
  day: string;
  source: UsageSource;
  authority: UsageAuthority;
  feature: AiFeature;
  provider: string;
  model: string;
  folioId?: string;
  editorialActionId?: string;
  traceId: string;
  attempt: number;
  outcome: UsageOutcome;
  costMicrousd?: number;
  costKind: UsageCostKind;
  pricingVersion?: string;
  pricing?: PricingRateSnapshot;
  creditMicrounits?: number;
}

export interface WritingActivityDetail {
  /** Stable UTC-day + opaque-folio key. */
  activityKey: string;
  day: string;
  folioId: string;
  count: number;
  firstOccurredAt: number;
  lastOccurredAt: number;
  synchronizedAccountId?: string;
}

/** Content-free evidence that cannot be reconstructed from generation rows. */
export interface EditorialActionEvidence {
  actionId: string;
  occurredAt: number;
  feature: AiFeature;
  outcome: UsageOutcome;
  folioId?: string;
  editorId?: string;
  sessionId?: string;
  /** Number of editorial turns represented by this logical action. */
  turnCount?: number;
  /** Explicit metadata flag; never inferred from manuscript content. */
  revision?: boolean;
}

export interface UsageRange {
  preset: UsageRangePreset;
  /** Inclusive epoch-millisecond boundary. Null means lifetime. */
  from: number | null;
  /** Exclusive epoch-millisecond boundary. */
  to: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

const USAGE_EVENT_KEYS = new Set([
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
  "pricing",
  "creditMicrounits",
]);

const PRICING_KEYS = new Set([
  "source",
  "version",
  "currency",
  "inputMicrousdPerMillion",
  "outputMicrousdPerMillion",
  "cacheReadMicrousdPerMillion",
  "cacheWriteMicrousdPerMillion",
  "reasoningMicrousdPerMillion",
  "longContextThresholdTokens",
  "longInputMicrousdPerMillion",
  "longOutputMicrousdPerMillion",
]);

const ACTIVITY_KEYS = new Set([
  "activityKey",
  "day",
  "folioId",
  "count",
  "firstOccurredAt",
  "lastOccurredAt",
  "synchronizedAccountId",
]);

const ACTION_KEYS = new Set([
  "actionId",
  "occurredAt",
  "feature",
  "outcome",
  "folioId",
  "editorId",
  "sessionId",
  "turnCount",
  "revision",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "field is not allowed" });
    }
  }
}

function requireBoundedString(
  value: unknown,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    issues.push({
      path,
      message: `must be a non-empty string of at most ${maximum} characters`,
    });
    return false;
  }
  return true;
}

function optionalBoundedString(
  value: unknown,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
): value is string | undefined {
  return (
    value === undefined || requireBoundedString(value, path, maximum, issues)
  );
}

function requireSafeInteger(
  value: unknown,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
  minimum = 0,
): value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    issues.push({
      path,
      message: `must be a safe integer from ${minimum} to ${maximum}`,
    });
    return false;
  }
  return true;
}

function optionalSafeInteger(
  value: unknown,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
): value is number | undefined {
  return (
    value === undefined || requireSafeInteger(value, path, maximum, issues)
  );
}

export function isUtcDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

export function utcDayFromTimestamp(timestamp: number): string {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > USAGE_LIMITS.timestamp
  ) {
    throw new RangeError("timestamp must be a non-negative safe UTC timestamp");
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function utcDayStart(day: string): number {
  if (!isUtcDay(day))
    throw new RangeError("day must be a real UTC YYYY-MM-DD day");
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function nextUtcDay(day: string): string {
  return utcDayFromTimestamp(utcDayStart(day) + 86_400_000);
}

export function createUsageRange(
  preset: UsageRangePreset,
  now: number,
): UsageRange {
  const today = utcDayFromTimestamp(now);
  const todayStart = utcDayStart(today);
  const to = todayStart + 86_400_000;
  if (preset === "all") return { preset, from: null, to };
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return {
    preset,
    from: Math.max(0, todayStart - (days - 1) * 86_400_000),
    to,
  };
}

export function validateUsageRange(range: UsageRange): boolean {
  return (
    (range.preset === "all" ||
      range.preset === "7d" ||
      range.preset === "30d" ||
      range.preset === "90d") &&
    (range.from === null ||
      (Number.isSafeInteger(range.from) &&
        range.from >= 0 &&
        range.from < range.to)) &&
    Number.isSafeInteger(range.to) &&
    range.to > 0 &&
    range.to <= USAGE_LIMITS.timestamp
  );
}

export function timestampInRange(
  timestamp: number,
  range: UsageRange,
): boolean {
  if (!validateUsageRange(range)) throw new RangeError("invalid usage range");
  return (
    timestamp < range.to && (range.from === null || timestamp >= range.from)
  );
}

function validatePricingSnapshot(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is PricingRateSnapshot {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a pricing snapshot object" });
    return false;
  }
  rejectUnknownKeys(value, PRICING_KEYS, path, issues);
  requireBoundedString(
    value.source,
    `${path}.source`,
    USAGE_LIMITS.pricingLabel,
    issues,
  );
  requireBoundedString(
    value.version,
    `${path}.version`,
    USAGE_LIMITS.pricingLabel,
    issues,
  );
  if (value.currency !== "USD") {
    issues.push({ path: `${path}.currency`, message: "must be USD" });
  }
  requireSafeInteger(
    value.inputMicrousdPerMillion,
    `${path}.inputMicrousdPerMillion`,
    Number.MAX_SAFE_INTEGER,
    issues,
  );
  requireSafeInteger(
    value.outputMicrousdPerMillion,
    `${path}.outputMicrousdPerMillion`,
    Number.MAX_SAFE_INTEGER,
    issues,
  );
  for (const key of [
    "cacheReadMicrousdPerMillion",
    "cacheWriteMicrousdPerMillion",
    "reasoningMicrousdPerMillion",
    "longContextThresholdTokens",
    "longInputMicrousdPerMillion",
    "longOutputMicrousdPerMillion",
  ] as const) {
    optionalSafeInteger(
      value[key],
      `${path}.${key}`,
      Number.MAX_SAFE_INTEGER,
      issues,
    );
  }
  return issues.length === 0;
}

export function parseUsageEvent(value: unknown): ValidationResult<UsageEvent> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "event", message: "must be an object" }],
    };
  }
  rejectUnknownKeys(value, USAGE_EVENT_KEYS, "event", issues);
  requireBoundedString(
    value.eventKey,
    "event.eventKey",
    USAGE_LIMITS.eventKey,
    issues,
  );
  const occurredAtValid = requireSafeInteger(
    value.occurredAt,
    "event.occurredAt",
    USAGE_LIMITS.timestamp,
    issues,
  );
  const dayValid = isUtcDay(value.day);
  if (!dayValid) {
    issues.push({
      path: "event.day",
      message: "must be a real UTC YYYY-MM-DD day",
    });
  } else if (
    occurredAtValid &&
    utcDayFromTimestamp(value.occurredAt as number) !== value.day
  ) {
    issues.push({ path: "event.day", message: "must match occurredAt in UTC" });
  }
  if (
    value.source !== "hosted" &&
    value.source !== "byok" &&
    value.source !== "local"
  ) {
    issues.push({ path: "event.source", message: "has an unsupported source" });
  }
  if (
    value.authority !== "server" &&
    value.authority !== "provider" &&
    value.authority !== "client_reported"
  ) {
    issues.push({
      path: "event.authority",
      message: "has an unsupported authority",
    });
  }
  if (!isUsageAiFeature(value.feature)) {
    issues.push({
      path: "event.feature",
      message: "must be a supported usage feature",
    });
  }
  requireBoundedString(
    value.provider,
    "event.provider",
    USAGE_LIMITS.provider,
    issues,
  );
  requireBoundedString(value.model, "event.model", USAGE_LIMITS.model, issues);
  optionalBoundedString(
    value.folioId,
    "event.folioId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  optionalBoundedString(
    value.editorialActionId,
    "event.editorialActionId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  requireBoundedString(
    value.traceId,
    "event.traceId",
    USAGE_LIMITS.traceId,
    issues,
  );
  requireSafeInteger(
    value.attempt,
    "event.attempt",
    USAGE_LIMITS.attempt,
    issues,
    1,
  );
  if (value.outcome !== "completed" && value.outcome !== "failed") {
    issues.push({
      path: "event.outcome",
      message: "must be completed or failed",
    });
  }
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "totalTokens",
  ] as const) {
    optionalSafeInteger(
      value[key],
      `event.${key}`,
      USAGE_LIMITS.tokenCount,
      issues,
    );
  }
  optionalSafeInteger(
    value.costMicrousd,
    "event.costMicrousd",
    Number.MAX_SAFE_INTEGER,
    issues,
  );
  optionalSafeInteger(
    value.creditMicrounits,
    "event.creditMicrounits",
    Number.MAX_SAFE_INTEGER,
    issues,
  );
  if (
    value.costKind !== "actual" &&
    value.costKind !== "estimated" &&
    value.costKind !== "local" &&
    value.costKind !== "unknown"
  ) {
    issues.push({
      path: "event.costKind",
      message: "has an unsupported cost kind",
    });
  }
  optionalBoundedString(
    value.pricingVersion,
    "event.pricingVersion",
    USAGE_LIMITS.pricingLabel,
    issues,
  );
  if (value.pricing !== undefined) {
    validatePricingSnapshot(value.pricing, "event.pricing", issues);
  }
  if (value.source === "local" && value.costKind !== "local") {
    issues.push({
      path: "event.costKind",
      message: "local source must use local cost kind",
    });
  }
  if (value.costKind === "local" && value.costMicrousd !== undefined) {
    issues.push({
      path: "event.costMicrousd",
      message: "local cost is not a provider charge",
    });
  }
  if (
    (value.costKind === "actual" || value.costKind === "estimated") &&
    value.costMicrousd === undefined
  ) {
    issues.push({
      path: "event.costMicrousd",
      message: "is required for known cost",
    });
  }
  if (value.costKind === "unknown" && value.costMicrousd !== undefined) {
    issues.push({
      path: "event.costMicrousd",
      message: "unknown cost must not become zero",
    });
  }
  if (value.costKind === "estimated" && !value.pricingVersion) {
    issues.push({
      path: "event.pricingVersion",
      message: "is required for estimated cost",
    });
  }
  if (value.costKind === "estimated" && value.pricing === undefined) {
    issues.push({
      path: "event.pricing",
      message: "is required for estimated cost",
    });
  }
  if (
    isPlainRecord(value.pricing) &&
    typeof value.pricingVersion === "string" &&
    value.pricing.version !== value.pricingVersion
  ) {
    issues.push({
      path: "event.pricingVersion",
      message: "must match pricing.version",
    });
  }
  if (
    value.authority === "client_reported" &&
    (value.costKind === "actual" || value.creditMicrounits !== undefined)
  ) {
    issues.push({
      path: "event.authority",
      message:
        "client-reported events cannot claim actual cost or credit debits",
    });
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as UsageEvent }
    : { ok: false, issues };
}

export function isUsageEvent(value: unknown): value is UsageEvent {
  return parseUsageEvent(value).ok;
}

export function assertUsageEvent(value: unknown): asserts value is UsageEvent {
  const result = parseUsageEvent(value);
  if (!result.ok) {
    throw new TypeError(
      `Invalid usage event: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
  }
}

export function parseWritingActivityDetail(
  value: unknown,
): ValidationResult<WritingActivityDetail> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "activity", message: "must be an object" }],
    };
  }
  rejectUnknownKeys(value, ACTIVITY_KEYS, "activity", issues);
  requireBoundedString(
    value.activityKey,
    "activity.activityKey",
    USAGE_LIMITS.eventKey,
    issues,
  );
  const dayValid = isUtcDay(value.day);
  if (!dayValid) {
    issues.push({
      path: "activity.day",
      message: "must be a real UTC YYYY-MM-DD day",
    });
  }
  const folioValid = requireBoundedString(
    value.folioId,
    "activity.folioId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  if (
    dayValid &&
    folioValid &&
    typeof value.activityKey === "string" &&
    value.activityKey !==
      createWritingActivityKey(value.day as string, value.folioId as string)
  ) {
    issues.push({
      path: "activity.activityKey",
      message: "must match the UTC day and folioId",
    });
  }
  requireSafeInteger(
    value.count,
    "activity.count",
    USAGE_LIMITS.activityCount,
    issues,
    1,
  );
  const firstValid = requireSafeInteger(
    value.firstOccurredAt,
    "activity.firstOccurredAt",
    USAGE_LIMITS.timestamp,
    issues,
  );
  const lastValid = requireSafeInteger(
    value.lastOccurredAt,
    "activity.lastOccurredAt",
    USAGE_LIMITS.timestamp,
    issues,
  );
  optionalBoundedString(
    value.synchronizedAccountId,
    "activity.synchronizedAccountId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  if (
    firstValid &&
    lastValid &&
    (value.firstOccurredAt as number) > (value.lastOccurredAt as number)
  ) {
    issues.push({
      path: "activity.lastOccurredAt",
      message: "must not precede firstOccurredAt",
    });
  }
  if (
    isUtcDay(value.day) &&
    firstValid &&
    utcDayFromTimestamp(value.firstOccurredAt as number) !== value.day
  ) {
    issues.push({
      path: "activity.firstOccurredAt",
      message: "must fall on activity day",
    });
  }
  if (
    isUtcDay(value.day) &&
    lastValid &&
    utcDayFromTimestamp(value.lastOccurredAt as number) !== value.day
  ) {
    issues.push({
      path: "activity.lastOccurredAt",
      message: "must fall on activity day",
    });
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as WritingActivityDetail }
    : { ok: false, issues };
}

export function isWritingActivityDetail(
  value: unknown,
): value is WritingActivityDetail {
  return parseWritingActivityDetail(value).ok;
}

export function assertWritingActivityDetail(
  value: unknown,
): asserts value is WritingActivityDetail {
  const result = parseWritingActivityDetail(value);
  if (!result.ok) {
    throw new TypeError(
      `Invalid writing activity: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
  }
}

export function parseEditorialActionEvidence(
  value: unknown,
): ValidationResult<EditorialActionEvidence> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "action", message: "must be an object" }],
    };
  }
  rejectUnknownKeys(value, ACTION_KEYS, "action", issues);
  requireBoundedString(
    value.actionId,
    "action.actionId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  requireSafeInteger(
    value.occurredAt,
    "action.occurredAt",
    USAGE_LIMITS.timestamp,
    issues,
  );
  if (!isUsageAiFeature(value.feature)) {
    issues.push({
      path: "action.feature",
      message: "must be a supported usage feature",
    });
  }
  if (value.outcome !== "completed" && value.outcome !== "failed") {
    issues.push({
      path: "action.outcome",
      message: "must be completed or failed",
    });
  }
  optionalBoundedString(
    value.folioId,
    "action.folioId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  optionalBoundedString(
    value.editorId,
    "action.editorId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  optionalBoundedString(
    value.sessionId,
    "action.sessionId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  if (value.turnCount !== undefined) {
    requireSafeInteger(
      value.turnCount,
      "action.turnCount",
      USAGE_LIMITS.activityCount,
      issues,
      1,
    );
  }
  if (value.revision !== undefined && typeof value.revision !== "boolean") {
    issues.push({ path: "action.revision", message: "must be boolean" });
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as EditorialActionEvidence }
    : { ok: false, issues };
}

export function assertEditorialActionEvidence(
  value: unknown,
): asserts value is EditorialActionEvidence {
  const result = parseEditorialActionEvidence(value);
  if (!result.ok) {
    throw new TypeError(
      `Invalid editorial action: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
  }
}

function encodedPart(value: string): string {
  return `${value.length}:${value}`;
}

export function createUsageEventKey(input: {
  providerRequestId?: string;
  traceId: string;
  attempt: number;
  provider: string;
  model: string;
}): string {
  const issues: ValidationIssue[] = [];
  optionalBoundedString(
    input.providerRequestId,
    "providerRequestId",
    USAGE_LIMITS.opaqueId,
    issues,
  );
  requireBoundedString(input.traceId, "traceId", USAGE_LIMITS.traceId, issues);
  requireSafeInteger(input.attempt, "attempt", USAGE_LIMITS.attempt, issues, 1);
  requireBoundedString(
    input.provider,
    "provider",
    USAGE_LIMITS.provider,
    issues,
  );
  requireBoundedString(input.model, "model", USAGE_LIMITS.model, issues);
  if (issues.length > 0) {
    throw new TypeError(
      issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
    );
  }
  if (input.providerRequestId) {
    return `usage:v1:request:${encodedPart(input.provider)}${encodedPart(input.providerRequestId)}`;
  }
  return `usage:v1:attempt:${encodedPart(input.traceId)}${encodedPart(String(input.attempt))}${encodedPart(input.provider)}${encodedPart(input.model)}`;
}

export function createWritingActivityKey(day: string, folioId: string): string {
  if (!isUtcDay(day))
    throw new RangeError("day must be a real UTC YYYY-MM-DD day");
  const issues: ValidationIssue[] = [];
  requireBoundedString(folioId, "folioId", USAGE_LIMITS.opaqueId, issues);
  if (issues.length > 0) throw new TypeError(issues[0].message);
  return `writing:v1:${encodedPart(day)}${encodedPart(folioId)}`;
}
