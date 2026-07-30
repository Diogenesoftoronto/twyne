/**
 * Runtime error reporting for Convex server code.
 *
 * PostHog handles client analytics; this module is the server-side mirror
 * for handlers where a silent failure is worst (webhooks, scheduled jobs,
 * the LSP relay). Errors are logged to console with a `twyne:` prefix and
 * also forwarded to PostHog as `$exception` events when a project API key
 * is configured — using the same endpoint as the AI eval capture so there's
 * one signal stream.
 *
 * Usage:
 *
 *   import { reportError } from "./lib/errors";
 *
 *   try {
 *     await ctx.runMutation(...);
 *   } catch (err) {
 *     reportError("creem.webhook", err, { ...context });
 *     return new Response("internal error", { status: 500 });
 *   }
 *
 * Never rethrows — the caller owns the response/throw decision.
 */

interface ReportArgs {
  /** Stable label like "creem.webhook" or "lixRelay.handleLspRequest". */
  feature: string;
  /** The error itself; non-Error values are stringified. */
  error: unknown;
  /** Optional context for the report (never include secrets). */
  context?: Record<string, unknown>;
}

const SAFE_CONTEXT_KEYS = new Set([
  "referenceId",
  "feature",
  "operation",
  "provider",
  "model",
  "mode",
  "status",
  "kind",
  "type",
  "action",
  "attempt",
  "retryAfterMs",
]);

function safeContext(
  context: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  if (!context) return output;
  for (const [key, value] of Object.entries(context)) {
    if (!SAFE_CONTEXT_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] =
        typeof value === "string" ? value.slice(0, 120) : value;
    }
  }
  return output;
}

export function reportError({ feature, error, context }: ReportArgs): void {
  const errorType = error instanceof Error ? error.name : "Error";
  const sanitizedContext = safeContext(context);
  const production = process.env.NODE_ENV === "production";

  if (production) {
    console.error(`[twyne:${feature}]`, {
      errorType,
      ...sanitizedContext,
    });
  } else {
    console.error(`[twyne:${feature}]`, error, context ?? {});
  }

  // Best-effort PostHog capture. Failures here are swallowed so a
  // telemetry hiccup never breaks the handler.
  try {
    const apiKey =
      process.env.POSTHOG_PROJECT_API_KEY ?? process.env.PUBLIC_POSTHOG_KEY;
    const host =
      process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
    const capture =
      process.env.POSTHOG_CAPTURE !== "false";
    if (!apiKey || !capture) return;

    void fetch(`${host.replace(/\/$/, "")}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "$exception",
        properties: {
          distinct_id: "convex-server",
          $exception_type: errorType,
          $exception_message: "Server operation failed",
          $exception_is_unhandled: false,
          $level: "error",
          twyne_feature: feature,
          twyne_server_runtime: "convex",
          ...sanitizedContext,
        },
      }),
    }).catch(() => {
      /* swallowed — see comment above */
    });
  } catch {
    /* swallowed */
  }
}
