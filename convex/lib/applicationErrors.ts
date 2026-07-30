import { ConvexError, type Value } from "convex/values";
import { reportError } from "./errors";

export type ApplicationErrorCode =
  | "authentication_required"
  | "permission_denied"
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "offline"
  | "timeout"
  | "configuration_required"
  | "provider_unavailable"
  | "malformed_response"
  | "internal";

export interface ApplicationErrorData {
  code: ApplicationErrorCode;
  title: string;
  message: string;
  retryable: boolean;
  referenceId?: string;
  recovery?: "retry" | "sign_in" | "open_settings" | "use_form" | "reload";
}

const EXPECTED: Record<
  ApplicationErrorCode,
  Omit<ApplicationErrorData, "code" | "referenceId">
> = {
  authentication_required: {
    title: "Sign in required",
    message: "Sign in and try that action again.",
    retryable: false,
    recovery: "sign_in",
  },
  permission_denied: {
    title: "Access not available",
    message: "Your account does not have permission to do that.",
    retryable: false,
  },
  validation_failed: {
    title: "Check the details",
    message: "Some of the information needs attention before you can continue.",
    retryable: false,
  },
  not_found: {
    title: "No longer available",
    message: "The requested item could not be found.",
    retryable: false,
  },
  conflict: {
    title: "Something changed",
    message: "Refresh the latest information before trying again.",
    retryable: true,
    recovery: "reload",
  },
  rate_limited: {
    title: "The room needs a moment",
    message: "Too many requests arrived at once. Wait briefly, then try again.",
    retryable: true,
    recovery: "retry",
  },
  offline: {
    title: "Connection interrupted",
    message: "Twyne could not reach the service. Your local work is still safe.",
    retryable: true,
    recovery: "retry",
  },
  timeout: {
    title: "The request took too long",
    message: "The service did not answer in time. Try again when you are ready.",
    retryable: true,
    recovery: "retry",
  },
  configuration_required: {
    title: "Set up a provider",
    message: "Choose an AI provider and model in Settings before using this feature.",
    retryable: false,
    recovery: "open_settings",
  },
  provider_unavailable: {
    title: "The room could not answer",
    message: "The AI service is unavailable right now. Your work has been kept.",
    retryable: true,
    recovery: "retry",
  },
  malformed_response: {
    title: "The response could not be read",
    message: "The AI service returned an incomplete response. Try the request again.",
    retryable: true,
    recovery: "retry",
  },
  internal: {
    title: "Twyne could not complete that",
    message: "An unexpected problem interrupted the request. Your work has been kept.",
    retryable: true,
    recovery: "retry",
  },
};

export function applicationError(
  code: ApplicationErrorCode,
  overrides: Partial<Omit<ApplicationErrorData, "code">> = {},
): ConvexError<Value> {
  return new ConvexError({
    code,
    ...EXPECTED[code],
    ...overrides,
  } satisfies Record<string, Value>);
}

export function unexpectedApplicationError(
  feature: string,
  error: unknown,
  context?: Record<string, unknown>,
): ConvexError<Value> {
  return reportedApplicationError(feature, "internal", error, {}, context);
}

export function reportedApplicationError(
  feature: string,
  code: ApplicationErrorCode,
  error: unknown,
  overrides: Partial<Omit<ApplicationErrorData, "code" | "referenceId">> = {},
  context?: Record<string, unknown>,
): ConvexError<Value> {
  const referenceId = crypto.randomUUID();
  reportError({
    feature,
    error,
    context: { ...context, referenceId },
  });
  return applicationError(code, { ...overrides, referenceId });
}
