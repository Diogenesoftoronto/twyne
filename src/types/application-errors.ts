/**
 * Stable, serializable error vocabulary shared by application boundaries.
 *
 * Keep these values independent of framework or provider error classes so
 * clients can safely persist and render them across version boundaries.
 */
export const APP_ERROR_CODES = [
  "VALIDATION_FAILED",
  "AUTHENTICATION_REQUIRED",
  "AUTHENTICATION_FAILED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "PROVIDER_ERROR",
  "MALFORMED_RESPONSE",
  "INTERNAL_ERROR",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export type AppErrorSource =
  | "application"
  | "validation"
  | "convex"
  | "auth"
  | "fetch"
  | "provider"
  | "unknown";

export type AppErrorRecoveryAction =
  | "fix-input"
  | "sign-in"
  | "retry"
  | "retry-later"
  | "check-connection"
  | "check-configuration"
  | "choose-provider"
  | "download-required"
  | "contact-support"
  | "none";

export interface AppErrorRecovery {
  action: AppErrorRecoveryAction;
  canRetry: boolean;
  retryAfterMs?: number;
}

export type SafeErrorMetadataValue =
  | string
  | number
  | boolean
  | null
  | SafeErrorMetadataValue[]
  | { [key: string]: SafeErrorMetadataValue };

export interface AppError {
  code: AppErrorCode;
  message: string;
  referenceId: string;
  source: AppErrorSource;
  recovery: AppErrorRecovery;
  status?: number;
  metadata?: Record<string, SafeErrorMetadataValue>;
}

export type ApplicationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export interface AppErrorOptions {
  source?: AppErrorSource;
  referenceId?: string;
  status?: number;
  recovery?: Partial<AppErrorRecovery>;
  metadata?: Record<string, unknown>;
  validationKey?: string;
}
