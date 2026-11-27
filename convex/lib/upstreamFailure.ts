import type { ConvexError, Value } from "convex/values";
import {
  reportedApplicationError,
  type ApplicationErrorCode,
  type ApplicationErrorData,
} from "./applicationErrors";
import { reportError } from "./errors";

/**
 * What a failed upstream call can safely tell us: its HTTP status and the
 * machine code in its error body (`integration_not_approved`,
 * `session_revoked`, …). The body's prose is never read back, because
 * providers echo queries, prompts and credentials in it.
 */
export interface UpstreamFailure {
  status: number;
  code?: string;
}

const MACHINE_CODE = /^[a-z][a-z0-9_.:-]{0,63}$/;

function machineCode(value: unknown): string | undefined {
  return typeof value === "string" && MACHINE_CODE.test(value)
    ? value
    : undefined;
}

/** Status and machine code of a failed response; consumes its body. */
export async function upstreamFailureOf(
  res: Response,
): Promise<UpstreamFailure> {
  let code: string | undefined;
  try {
    const body = (await res.json()) as Record<string, unknown> | null;
    const error = body?.error;
    code =
      machineCode(body?.code) ??
      (error && typeof error === "object"
        ? (machineCode((error as Record<string, unknown>).code) ??
          machineCode((error as Record<string, unknown>).type))
        : machineCode(error));
  } catch {
    await res.body?.cancel().catch(() => {});
  }
  return { status: res.status, code };
}

/** A thrown fetch (DNS, reset, abort) as an upstream failure. */
export function networkFailure(error: unknown): UpstreamFailure {
  const name = error instanceof Error ? error.name : "";
  return {
    status: 0,
    code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
  };
}

interface FailureCopy {
  code: ApplicationErrorCode;
  title: string;
  message: string;
  retryable: boolean;
  recovery?: ApplicationErrorData["recovery"];
}

/**
 * Writer-facing words for a failure at `service`. Each says what happened,
 * whether anything was lost, and what will fix it.
 */
export function describeUpstreamFailure(
  service: string,
  failure: UpstreamFailure,
): FailureCopy {
  const { status, code } = failure;
  const answered = status ? ` (${service} answered ${status}${code ? `, ${code}` : ""})` : "";
  if (
    status === 401 ||
    code === "session_revoked" ||
    code === "invalid_token" ||
    code === "token_expired"
  )
    return {
      code: "authentication_required",
      title: "Your Not Organic sign-in has ended",
      message: `Sign in again and research picks up where it stopped. Nothing in your draft was lost${answered}.`,
      retryable: false,
      recovery: "sign_in",
    };
  if (
    status === 402 ||
    code === "insufficient_credit" ||
    code === "insufficient_funds" ||
    code === "budget_exceeded"
  )
    return {
      code: "configuration_required",
      title: "Out of research credit",
      message: `Your Not Organic wallet can't cover another search. Add credit and research resumes on its own${answered}.`,
      retryable: false,
      recovery: "add_credit",
    };
  if (code === "integration_not_approved")
    return {
      code: "configuration_required",
      title: "This address isn't approved for Twyne",
      message: `Not Organic only signs in to Twyne from approved addresses. Use twyne.love, or ask for this address to be approved${answered}.`,
      retryable: false,
      recovery: "contact_support",
    };
  if (status === 403)
    return {
      code: "permission_denied",
      title: `${service} refused the request`,
      message: `Your account isn't allowed to use this yet${answered}.`,
      retryable: false,
      recovery: "contact_support",
    };
  if (status === 429)
    return {
      code: "rate_limited",
      title: "Research is pausing for a moment",
      message: `Too many searches went out at once. It tries again on its own shortly${answered}.`,
      retryable: true,
      recovery: "retry",
    };
  if (code === "timeout" || status === 408 || status === 504)
    return {
      code: "timeout",
      title: `${service} took too long`,
      message: `No answer arrived in time. Research retries on its own${answered}.`,
      retryable: true,
      recovery: "retry",
    };
  if (code === "network")
    return {
      code: "offline",
      title: `Twyne couldn't reach ${service}`,
      message: "The connection failed before an answer came back. Research retries on its own.",
      retryable: true,
      recovery: "retry",
    };
  return {
    code: "provider_unavailable",
    title: `${service} is having trouble`,
    message: `It couldn't answer right now. Research retries on its own${answered}.`,
    retryable: true,
    recovery: "retry",
  };
}

/**
 * Log a failed upstream call under a reference id and return the error to
 * throw. The writer sees the same reference id, so a support message or a
 * screenshot leads straight to the Convex log line:
 *
 *   [twyne:research.search] { referenceId, stage, provider, upstreamStatus, upstreamCode }
 */
export function upstreamApplicationError(
  feature: string,
  details: {
    service: string;
    provider: string;
    stage: string;
    failure: UpstreamFailure;
  },
): ConvexError<Value> {
  const { failure, provider, stage, service } = details;
  const { code, ...copy } = describeUpstreamFailure(service, failure);
  const upstream = {
    stage,
    provider,
    upstreamStatus: failure.status,
    ...(failure.code ? { upstreamCode: failure.code } : {}),
  };
  return reportedApplicationError(
    feature,
    code,
    new Error(`${stage} failed with ${failure.status} ${failure.code ?? ""}`.trim()),
    { ...copy, ...upstream, operation: feature },
    upstream,
  );
}

/** Log a failure the caller recovers from (a page read falling back to its snippet). */
export function reportRecoveredUpstreamFailure(
  feature: string,
  details: { provider: string; stage: string; failure: UpstreamFailure },
): void {
  reportError({
    feature,
    error: new Error(`${details.stage} failed; recovered`),
    context: {
      stage: details.stage,
      provider: details.provider,
      upstreamStatus: details.failure.status,
      ...(details.failure.code ? { upstreamCode: details.failure.code } : {}),
    },
  });
}
