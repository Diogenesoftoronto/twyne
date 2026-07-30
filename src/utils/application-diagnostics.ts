import { normalizeApplicationError } from "./application-errors";
import { capturePostHogEvent } from "./posthog-context";

export function shouldLogRawDiagnostics(): boolean {
  return typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
}

/**
 * Preserve raw diagnostics during development, but never echo provider,
 * Convex, prompt, transcript, or draft details in a production console.
 */
export function reportApplicationDiagnostic(
  scope: string,
  thrown: unknown,
  metadata?: Record<string, unknown>,
): void {
  if (shouldLogRawDiagnostics()) {
    console.warn(scope, thrown);
    return;
  }
  const error = normalizeApplicationError(thrown, { metadata });
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
