import type { AppError, AppErrorOptions } from "../types/application-errors";
import { normalizeApplicationError } from "./application-errors";
import { showApplicationErrorToast } from "./application-toast";
import { capturePostHogEvent } from "./posthog-context";

export interface ReportApplicationErrorOptions extends AppErrorOptions {
  title?: string;
  variant?: "error" | "warning";
  dedupeKey?: string;
}

export function shouldLogRawDiagnostics(): boolean {
  return typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
}

/**
 * Preserve raw diagnostics during development, but never echo provider,
 * Convex, prompt, transcript, or draft details in a production console.
 */
function captureApplicationDiagnostic(
  scope: string,
  thrown: unknown,
  error: AppError,
): void {
  if (shouldLogRawDiagnostics()) {
    console.warn(scope, thrown);
    return;
  }
  void capturePostHogEvent("$exception", {
    distinct_id: "twyne-browser",
    $exception_type: "ApplicationError",
    $exception_message: error.message,
    $exception_is_unhandled: false,
    $level: "error",
    twyne_error_code: error.code,
    twyne_error_reference_id: error.referenceId,
    twyne_error_source: error.source,
    twyne_error_scope: scope,
    ...error.metadata,
  });
}

export function reportApplicationDiagnostic(
  scope: string,
  thrown: unknown,
  metadata?: Record<string, unknown>,
): void {
  const error = normalizeApplicationError(thrown, { metadata });
  captureApplicationDiagnostic(scope, thrown, error);
}

export function reportApplicationError(
  scope: string,
  thrown: unknown,
  options: ReportApplicationErrorOptions = {},
): AppError {
  const { title, variant, dedupeKey, ...errorOptions } = options;
  const error = normalizeApplicationError(thrown, errorOptions);
  captureApplicationDiagnostic(scope, thrown, error);
  showApplicationErrorToast(error, { title, variant, dedupeKey });
  return error;
}
