import {
  APP_ERROR_CODES,
  type AppError,
  type AppErrorCode,
  type AppErrorOptions,
  type AppErrorRecovery,
  type AppErrorSource,
  type ApplicationResult,
  type SafeErrorMetadataValue,
} from "../types/application-errors";

const APP_ERROR_CODE_SET = new Set<string>(APP_ERROR_CODES);
const APP_ERROR_SOURCE_SET = new Set<AppErrorSource>([
  "application",
  "validation",
  "convex",
  "auth",
  "fetch",
  "provider",
  "unknown",
]);
const RECOVERY_ACTION_SET = new Set<AppErrorRecovery["action"]>([
  "fix-input",
  "sign-in",
  "retry",
  "retry-later",
  "check-connection",
  "check-configuration",
  "choose-provider",
  "contact-support",
  "none",
]);
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 30;
const MAX_ARRAY_ITEMS = 20;
const MAX_SAFE_STRING_LENGTH = 240;

const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  VALIDATION_FAILED: "Check the highlighted information and try again.",
  AUTHENTICATION_REQUIRED: "Sign in to continue.",
  AUTHENTICATION_FAILED: "We could not verify your sign-in. Please try again.",
  PERMISSION_DENIED: "You do not have permission to do that.",
  NOT_FOUND: "The requested item could not be found.",
  CONFLICT: "This changed elsewhere. Refresh and try again.",
  RATE_LIMITED: "Too many requests. Please wait and try again.",
  TIMEOUT: "The request took too long. Please try again.",
  NETWORK_UNAVAILABLE:
    "We could not reach the service. Check your connection and try again.",
  CONFIGURATION_ERROR:
    "This feature is not configured correctly. Choose another option or contact support.",
  PROVIDER_ERROR:
    "The selected provider could not complete the request. Please try again.",
  MALFORMED_RESPONSE:
    "The service returned an invalid response. Please try again.",
  INTERNAL_ERROR:
    "Something went wrong. Please try again or contact support with the reference ID.",
};

/**
 * Only these explicitly reviewed validation messages may reach users. Raw
 * provider, Convex, auth, or schema-validator text is never passed through.
 */
const VALIDATION_MESSAGES: Record<string, string> = {
  required: "Complete all required fields and try again.",
  email_required: "Enter your email address.",
  email_invalid: "Enter a valid email address.",
  password_required: "Enter your password.",
  password_too_short: "Use a longer password.",
  handle_required: "Enter a handle.",
  handle_invalid:
    "Use a handle made from letters, numbers, periods, or hyphens.",
  invalid_format: "Use the requested format and try again.",
  invalid_value: "Check the highlighted value and try again.",
  too_short: "Enter a longer value.",
  too_long: "Enter a shorter value.",
  file_too_large: "Choose a smaller file and try again.",
  unsupported_file_type: "Choose a supported file type and try again.",
};

const CODE_ALIASES: Record<string, AppErrorCode> = {
  VALIDATION: "VALIDATION_FAILED",
  VALIDATION_ERROR: "VALIDATION_FAILED",
  INVALID_ARGUMENT: "VALIDATION_FAILED",
  BAD_REQUEST: "VALIDATION_FAILED",
  UNPROCESSABLE_ENTITY: "VALIDATION_FAILED",
  UNAUTHENTICATED: "AUTHENTICATION_REQUIRED",
  AUTH_REQUIRED: "AUTHENTICATION_REQUIRED",
  SESSION_EXPIRED: "AUTHENTICATION_REQUIRED",
  INVALID_SESSION: "AUTHENTICATION_REQUIRED",
  UNAUTHORIZED: "AUTHENTICATION_FAILED",
  INVALID_CREDENTIALS: "AUTHENTICATION_FAILED",
  INVALID_PASSWORD: "AUTHENTICATION_FAILED",
  FORBIDDEN: "PERMISSION_DENIED",
  ACCESS_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  ALREADY_EXISTS: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  RATE_LIMIT: "RATE_LIMITED",
  TOO_MANY_REQUESTS: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  REQUEST_TIMEOUT: "TIMEOUT",
  GATEWAY_TIMEOUT: "TIMEOUT",
  ABORT_ERR: "TIMEOUT",
  ABORT_ERROR: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_UNAVAILABLE",
  FETCH_FAILED: "NETWORK_UNAVAILABLE",
  SERVICE_UNAVAILABLE: "NETWORK_UNAVAILABLE",
  OFFLINE: "NETWORK_UNAVAILABLE",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  CONFIGURATION_REQUIRED: "CONFIGURATION_ERROR",
  NOT_CONFIGURED: "CONFIGURATION_ERROR",
  MISSING_API_KEY: "CONFIGURATION_ERROR",
  INVALID_API_KEY: "CONFIGURATION_ERROR",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_UNAVAILABLE: "PROVIDER_ERROR",
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
  PARSE_ERROR: "MALFORMED_RESPONSE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
  INTERNAL: "INTERNAL_ERROR",
};

const SENSITIVE_KEY_PATTERN =
  /(?:^|[_-])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:orization)?|bearer|credential|secret|password|passcode|cookie|session|jwt|private[_-]?key|client[_-]?secret|prompt|system[_-]?prompt|transcript|conversation|draft|manuscript|document|content|messages?|completion|input|output|request[_-]?(?:body|payload)|response[_-]?(?:body|payload)|provider[_-]?(?:body|response)|body|stack|stacktrace|cause|url|uri|endpoint|base[_-]?url|host|origin|webhook)(?:$|[_-])/i;

const SAFE_METADATA_KEY_PATTERN =
  /^(?:field|fields|feature|operation|method|provider|providerId|providerType|model|attempt|statusText|kind|type|resource|limit|retryAfterMs)$/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b(?:bearer|basic)\s+[^\s,;]+/gi,
  /\b(?:sk|pk|rk|sess|pat|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)\s*[:=]\s*["']?[^\s,"';}]+/gi,
  /\bhttps?:\/\/[^\s"'<>]+/gi,
  /\b(?:wss?|ftp):\/\/[^\s"'<>]+/gi,
];

const NETWORK_ERROR_PATTERNS = [
  /failed to fetch/i,
  /fetch failed/i,
  /network(?: request)? failed/i,
  /networkerror/i,
  /load failed/i,
  /connection (?:refused|reset|closed)/i,
  /\bECONN(?:REFUSED|RESET|ABORTED)\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /socket hang up/i,
  /offline/i,
];

const TIMEOUT_PATTERNS = [
  /timed?\s*out/i,
  /\btimeout\b/i,
  /deadline exceeded/i,
  /aborterror/i,
  /the operation was aborted/i,
];

const MALFORMED_PATTERNS = [
  /invalid json/i,
  /unexpected (?:token|end of json)/i,
  /json parse/i,
  /malformed response/i,
  /failed to parse/i,
  /schema mismatch/i,
  /invalid response/i,
];

const CONFIG_PATTERNS = [
  /not configured/i,
  /configuration/i,
  /missing (?:api )?key/i,
  /api key is missing/i,
  /environment variable/i,
  /base url.*required/i,
  /deployment address/i,
  /no provider/i,
];

const VALIDATION_KEY_PATTERNS: Array<[RegExp, string]> = [
  [
    /\bemail\b.*\b(required|missing)\b|\b(required|missing)\b.*\bemail\b/i,
    "email_required",
  ],
  [/\bemail\b.*\b(invalid|valid email|format)\b/i, "email_invalid"],
  [/\bpassword\b.*\b(required|missing)\b/i, "password_required"],
  [/\bpassword\b.*\b(short|characters?|length)\b/i, "password_too_short"],
  [/\bhandle\b.*\b(required|missing)\b/i, "handle_required"],
  [/\bhandle\b.*\b(invalid|letters|numbers|format)\b/i, "handle_invalid"],
  [/\bfile\b.*\btoo large\b|\bpayload too large\b/i, "file_too_large"],
  [
    /\b(file|media)\b.*\b(type|format).*\b(unsupported|invalid)\b/i,
    "unsupported_file_type",
  ],
  [/\b(required|missing|required field)\b/i, "required"],
  [/\btoo short\b|\bminimum length\b/i, "too_short"],
  [/\btoo long\b|\bmaximum length\b/i, "too_long"],
  [/\bformat\b/i, "invalid_format"],
];

function defaultRecovery(code: AppErrorCode): AppErrorRecovery {
  switch (code) {
    case "VALIDATION_FAILED":
      return { action: "fix-input", canRetry: true };
    case "AUTHENTICATION_REQUIRED":
    case "AUTHENTICATION_FAILED":
      return { action: "sign-in", canRetry: true };
    case "RATE_LIMITED":
      return { action: "retry-later", canRetry: true };
    case "TIMEOUT":
    case "PROVIDER_ERROR":
    case "MALFORMED_RESPONSE":
    case "INTERNAL_ERROR":
      return { action: "retry", canRetry: true };
    case "NETWORK_UNAVAILABLE":
      return { action: "check-connection", canRetry: true };
    case "CONFIGURATION_ERROR":
      return { action: "check-configuration", canRetry: false };
    case "PERMISSION_DENIED":
    case "NOT_FOUND":
    case "CONFLICT":
      return { action: "none", canRetry: false };
  }
}

function referenceId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `err_${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to a runtime-independent identifier.
  }
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function safeReferenceId(candidate: unknown): string {
  return typeof candidate === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(candidate)
    ? candidate
    : referenceId();
}

function normalizeStatus(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 100 && value <= 599 ? value : undefined;
}

function normalizeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    const seconds = Number(value);
    value = Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(Math.round(value), 24 * 60 * 60 * 1000);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringProperty(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberProperty(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function booleanProperty(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function normalizedTag(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || undefined;
}

function codeFromTag(value: unknown): AppErrorCode | undefined {
  const tag = normalizedTag(value);
  if (!tag) return undefined;
  if (APP_ERROR_CODE_SET.has(tag)) return tag as AppErrorCode;
  return CODE_ALIASES[tag];
}

function statusToCode(status: number, source: AppErrorSource): AppErrorCode {
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return "VALIDATION_FAILED";
  }
  if (status === 401) {
    return source === "auth"
      ? "AUTHENTICATION_FAILED"
      : "AUTHENTICATION_REQUIRED";
  }
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503) {
    return source === "provider" ? "PROVIDER_ERROR" : "NETWORK_UNAVAILABLE";
  }
  if (status >= 500) {
    return source === "provider" ? "PROVIDER_ERROR" : "INTERNAL_ERROR";
  }
  return source === "provider" ? "PROVIDER_ERROR" : "INTERNAL_ERROR";
}

function validationMessage(key: unknown, rawHint?: string): string {
  const normalizedKey = normalizedTag(key)?.toLowerCase();
  if (normalizedKey && VALIDATION_MESSAGES[normalizedKey]) {
    return VALIDATION_MESSAGES[normalizedKey];
  }
  if (rawHint) {
    for (const [pattern, mappedKey] of VALIDATION_KEY_PATTERNS) {
      if (pattern.test(rawHint)) return VALIDATION_MESSAGES[mappedKey];
    }
  }
  return DEFAULT_MESSAGES.VALIDATION_FAILED;
}

function redactedString(value: string): string {
  if (!value) return value;
  let redacted = value.replace(/\r?\n[\s\S]*/g, " [REDACTED]");
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  if (redacted.length > MAX_SAFE_STRING_LENGTH) {
    redacted = `${redacted.slice(0, MAX_SAFE_STRING_LENGTH)}…`;
  }
  return redacted;
}

function sanitizeMetadataValue(
  value: unknown,
  key: string,
  depth: number,
  seen: WeakSet<object>,
): SafeErrorMetadataValue | undefined {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (depth > 0 && !SAFE_METADATA_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") return redactedString(value);
  if (typeof value === "bigint") return value.toString();
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (depth >= MAX_METADATA_DEPTH) return "[REDACTED]";
  if (seen.has(value)) return "[REDACTED]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeMetadataValue(item, key, depth + 1, seen))
      .filter((item): item is SafeErrorMetadataValue => item !== undefined);
  }
  const output: Record<string, SafeErrorMetadataValue> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(
    0,
    MAX_METADATA_KEYS,
  )) {
    const sanitized = sanitizeMetadataValue(
      childValue,
      childKey,
      depth + 1,
      seen,
    );
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  return output;
}

/**
 * Sanitizes optional diagnostic metadata. Callers should still prefer small,
 * allowlisted context; this function is the final guard before serialization.
 */
export function sanitizeErrorMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, SafeErrorMetadataValue> | undefined {
  if (!metadata) return undefined;
  const sanitized = sanitizeMetadataValue(
    metadata,
    "metadata",
    0,
    new WeakSet(),
  );
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") {
    return undefined;
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function pickSafeMetadata(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SAFE_METADATA_KEY_PATTERN.test(key)) metadata[key] = value;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

export function createAppError(
  code: AppErrorCode,
  options: AppErrorOptions = {},
): AppError {
  const status = normalizeStatus(options.status);
  const baseRecovery = defaultRecovery(code);
  const retryAfterMs = normalizeRetryAfterMs(options.recovery?.retryAfterMs);
  const recovery: AppErrorRecovery = {
    action: options.recovery?.action ?? baseRecovery.action,
    canRetry: options.recovery?.canRetry ?? baseRecovery.canRetry,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
  const metadata = sanitizeErrorMetadata(options.metadata);
  return {
    code,
    message:
      code === "VALIDATION_FAILED"
        ? validationMessage(options.validationKey)
        : DEFAULT_MESSAGES[code],
    referenceId: safeReferenceId(options.referenceId),
    source: options.source ?? "application",
    recovery,
    ...(status === undefined ? {} : { status }),
    ...(metadata ? { metadata } : {}),
  };
}

export function successResult<T>(value: T): ApplicationResult<T> {
  return { ok: true, value };
}

export function failureResult<T = never>(
  error: unknown,
  options?: AppErrorOptions,
): ApplicationResult<T> {
  return { ok: false, error: normalizeApplicationError(error, options) };
}

export function isAppError(value: unknown): value is AppError {
  const record = toRecord(value);
  const recovery = toRecord(record?.recovery);
  return Boolean(
    record &&
      APP_ERROR_CODE_SET.has(String(record.code)) &&
      typeof record.message === "string" &&
      typeof record.referenceId === "string" &&
      APP_ERROR_SOURCE_SET.has(record.source as AppErrorSource) &&
      recovery &&
      RECOVERY_ACTION_SET.has(recovery.action as AppErrorRecovery["action"]) &&
      typeof recovery.canRetry === "boolean",
  );
}

function rebuildAppError(error: AppError, options: AppErrorOptions): AppError {
  return createAppError(error.code, {
    source: options.source ?? error.source,
    referenceId: options.referenceId ?? error.referenceId,
    status: options.status ?? error.status,
    recovery: { ...error.recovery, ...options.recovery },
    metadata: { ...error.metadata, ...options.metadata },
    validationKey: options.validationKey,
  });
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}

function isConvexErrorRecord(record: Record<string, unknown>): boolean {
  return (
    record.name === "ConvexError" ||
    (record as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] ===
      true ||
    ("data" in record && normalizedTag(record.name) === "CONVEX_ERROR")
  );
}

function isAuthRecord(record: Record<string, unknown>): boolean {
  const name = normalizedTag(record.name);
  return (
    name === "API_ERROR" ||
    name === "BETTER_AUTH_ERROR" ||
    (toRecord(record.body) !== undefined &&
      ("status" in record || "statusCode" in record))
  );
}

function isProviderRecord(record: Record<string, unknown>): boolean {
  const name = normalizedTag(record.name);
  return Boolean(
    record.provider ||
      record.providerId ||
      record.providerType ||
      name?.includes("PROVIDER") ||
      name?.includes("AI_") ||
      name?.includes("APICALL") ||
      "responseBody" in record ||
      "requestBody" in record,
  );
}

function normalizeResponse(
  response: Response,
  options: AppErrorOptions,
): AppError {
  const source = options.source ?? "fetch";
  const retryAfterMs = retryAfterFromHeaders(response.headers);
  return createAppError(statusToCode(response.status, source), {
    ...options,
    source,
    status: response.status,
    recovery: {
      ...options.recovery,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
    metadata: {
      method: options.metadata?.method,
      statusText: response.statusText,
      ...options.metadata,
    },
  });
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return normalizeRetryAfterMs(seconds * 1000);
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  return normalizeRetryAfterMs(Math.max(0, retryAt - Date.now()));
}

function normalizeConvex(
  record: Record<string, unknown>,
  options: AppErrorOptions,
): AppError {
  const data = toRecord(record.data);
  const rawMessage =
    stringProperty(data, "message", "error", "reason") ??
    stringProperty(record, "message");
  const status = normalizeStatus(
    numberProperty(data, "status", "statusCode") ??
      numberProperty(record, "status", "statusCode"),
  );
  const code =
    codeFromTag(data?.code) ??
    codeFromTag(data?.kind) ??
    codeFromTag(data?.type) ??
    (status ? statusToCode(status, "convex") : undefined) ??
    inferCodeFromMessage(rawMessage, "convex");
  const retryAfterMs = normalizeRetryAfterMs(
    numberProperty(data, "retryAfterMs", "retry_after_ms") ??
      numberProperty(record, "retryAfterMs", "retry_after_ms"),
  );
  const retryable = booleanProperty(data, "retryable", "canRetry");
  const recoveryAction = recoveryActionFrom(data?.recovery);
  return createAppError(code, {
    ...options,
    source: "convex",
    referenceId:
      options.referenceId ??
      stringProperty(data, "referenceId", "reference_id"),
    status: options.status ?? status,
    recovery: {
      ...options.recovery,
      ...(retryable === undefined ? {} : { canRetry: retryable }),
      ...(recoveryAction === undefined ? {} : { action: recoveryAction }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
    validationKey:
      options.validationKey ??
      stringProperty(data, "validationKey", "validation_key", "field") ??
      validationKeyFromMessage(rawMessage),
    metadata: {
      ...pickSafeMetadata(data),
      ...options.metadata,
    },
  });
}

function normalizeAuth(
  record: Record<string, unknown>,
  options: AppErrorOptions,
): AppError {
  const body = toRecord(record.body) ?? toRecord(record.error);
  const status = normalizeStatus(
    numberProperty(record, "statusCode", "status") ??
      numberProperty(body, "statusCode", "status"),
  );
  const rawMessage =
    stringProperty(body, "message", "error_description", "error") ??
    stringProperty(record, "message");
  const code =
    codeFromTag(body?.code) ??
    codeFromTag(record.code) ??
    (status ? statusToCode(status, "auth") : undefined) ??
    inferCodeFromMessage(rawMessage, "auth");
  return createAppError(code, {
    ...options,
    source: "auth",
    status: options.status ?? status,
    validationKey:
      options.validationKey ??
      stringProperty(body, "validationKey", "field") ??
      validationKeyFromMessage(rawMessage),
    metadata: {
      ...pickSafeMetadata(body),
      ...options.metadata,
    },
  });
}

function normalizeProvider(
  record: Record<string, unknown>,
  options: AppErrorOptions,
): AppError {
  const body =
    toRecord(record.data) ??
    toRecord(record.error) ??
    toRecord(record.response);
  const status = normalizeStatus(
    numberProperty(record, "statusCode", "status") ??
      numberProperty(body, "statusCode", "status"),
  );
  const rawMessage =
    stringProperty(body, "message", "error", "reason") ??
    stringProperty(record, "message");
  let code =
    codeFromTag(body?.code) ??
    codeFromTag(record.code) ??
    (status ? statusToCode(status, "provider") : undefined) ??
    inferCodeFromMessage(rawMessage, "provider");
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  ) {
    code = "CONFIGURATION_ERROR";
  }
  const retryAfterMs = normalizeRetryAfterMs(
    numberProperty(record, "retryAfterMs", "retry_after_ms") ??
      numberProperty(body, "retryAfterMs", "retry_after_ms"),
  );
  return createAppError(code, {
    ...options,
    source: "provider",
    status: options.status ?? status,
    recovery: {
      ...options.recovery,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
    validationKey:
      options.validationKey ?? validationKeyFromMessage(rawMessage),
    metadata: {
      ...pickSafeMetadata(record),
      ...pickSafeMetadata(body),
      ...options.metadata,
    },
  });
}

function recoveryActionFrom(
  value: unknown,
): AppErrorRecovery["action"] | undefined {
  switch (normalizedTag(value)) {
    case "RETRY":
    case "RELOAD":
      return "retry";
    case "RETRY_LATER":
      return "retry-later";
    case "SIGN_IN":
      return "sign-in";
    case "OPEN_SETTINGS":
      return "check-configuration";
    case "USE_FORM":
      return "fix-input";
    case "CHOOSE_PROVIDER":
      return "choose-provider";
    case "CONTACT_SUPPORT":
      return "contact-support";
    case "NONE":
      return "none";
    default:
      return undefined;
  }
}

function validationKeyFromMessage(
  message: string | undefined,
): string | undefined {
  if (!message) return undefined;
  for (const [pattern, key] of VALIDATION_KEY_PATTERNS) {
    if (pattern.test(message)) return key;
  }
  return undefined;
}

function inferCodeFromMessage(
  message: string | undefined,
  source: AppErrorSource,
): AppErrorCode {
  if (!message) {
    return source === "provider" ? "PROVIDER_ERROR" : "INTERNAL_ERROR";
  }
  if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "TIMEOUT";
  }
  if (NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return "NETWORK_UNAVAILABLE";
  }
  if (/rate.?limit|too many requests|quota exceeded/i.test(message)) {
    return "RATE_LIMITED";
  }
  if (CONFIG_PATTERNS.some((pattern) => pattern.test(message))) {
    return "CONFIGURATION_ERROR";
  }
  if (MALFORMED_PATTERNS.some((pattern) => pattern.test(message))) {
    return "MALFORMED_RESPONSE";
  }
  if (/not authenticated|sign.?in required|session expired/i.test(message)) {
    return "AUTHENTICATION_REQUIRED";
  }
  if (
    /invalid credentials|authentication failed|invalid login/i.test(message)
  ) {
    return "AUTHENTICATION_FAILED";
  }
  if (/forbidden|permission denied|access denied/i.test(message)) {
    return "PERMISSION_DENIED";
  }
  if (/not found/i.test(message)) return "NOT_FOUND";
  if (/conflict|already exists/i.test(message)) return "CONFLICT";
  if (validationKeyFromMessage(message)) return "VALIDATION_FAILED";
  return source === "provider" ? "PROVIDER_ERROR" : "INTERNAL_ERROR";
}

function normalizeError(error: Error, options: AppErrorOptions): AppError {
  const record = error as Error & Record<string, unknown>;
  if (isConvexErrorRecord(record)) return normalizeConvex(record, options);
  if (isProviderRecord(record) || options.source === "provider") {
    return normalizeProvider(record, options);
  }
  if (isAuthRecord(record)) return normalizeAuth(record, options);
  const source = options.source ?? "unknown";
  const status =
    options.status ??
    normalizeStatus(numberProperty(record, "status", "statusCode"));
  const retryAfterMs = normalizeRetryAfterMs(
    numberProperty(record, "retryAfterMs", "retry_after_ms"),
  );
  return createAppError(
    codeFromTag(record.code) ??
      (status ? statusToCode(status, source) : undefined) ??
      inferCodeFromMessage(error.message, source),
    {
      ...options,
      source,
      status,
      recovery: {
        ...options.recovery,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
      validationKey:
        options.validationKey ?? validationKeyFromMessage(error.message),
      metadata: {
        ...pickSafeMetadata(record),
        ...options.metadata,
      },
    },
  );
}

/**
 * Converts any thrown value into a safe, stable application error.
 *
 * This function deliberately never copies an arbitrary error message, cause,
 * stack, URL, request/response body, prompt, transcript, or draft.
 */
export function normalizeApplicationError(
  error: unknown,
  options: AppErrorOptions = {},
): AppError {
  try {
    if (isAppError(error)) return rebuildAppError(error, options);
    if (isResponse(error)) return normalizeResponse(error, options);
    if (error instanceof Error) return normalizeError(error, options);

    const record = toRecord(error);
    if (record) {
      if (isConvexErrorRecord(record)) return normalizeConvex(record, options);
      if (isProviderRecord(record) || options.source === "provider") {
        return normalizeProvider(record, options);
      }
      if (isAuthRecord(record)) return normalizeAuth(record, options);
      const rawMessage = stringProperty(record, "message", "error", "reason");
      const source = options.source ?? "unknown";
      const status =
        options.status ??
        normalizeStatus(numberProperty(record, "status", "statusCode"));
      const retryAfterMs = normalizeRetryAfterMs(
        numberProperty(record, "retryAfterMs", "retry_after_ms"),
      );
      return createAppError(
        codeFromTag(record.code) ??
          codeFromTag(record.type) ??
          codeFromTag(record.kind) ??
          (status ? statusToCode(status, source) : undefined) ??
          inferCodeFromMessage(rawMessage, source),
        {
          ...options,
          source,
          status,
          recovery: {
            ...options.recovery,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          },
          validationKey:
            options.validationKey ?? validationKeyFromMessage(rawMessage),
          metadata: {
            ...pickSafeMetadata(record),
            ...options.metadata,
          },
        },
      );
    }

    return createAppError(
      typeof error === "string"
        ? inferCodeFromMessage(error, options.source ?? "unknown")
        : "INTERNAL_ERROR",
      {
        ...options,
        source: options.source ?? "unknown",
        validationKey:
          options.validationKey ??
          (typeof error === "string"
            ? validationKeyFromMessage(error)
            : undefined),
      },
    );
  } catch {
    return createAppError("INTERNAL_ERROR", {
      referenceId: options.referenceId,
      source: "unknown",
    });
  }
}
