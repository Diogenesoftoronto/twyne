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

export function reportError({ feature, error, context }: ReportArgs): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Console first — always works, even if PostHog is unconfigured.
  console.error(`[twyne:${feature}]`, message, stack ?? "", context ?? "");

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
          $exception_type:
            error instanceof Error ? error.name : "Error",
          $exception_message: message,
          $exception_stack: stack,
          $exception_is_unhandled: false,
          $level: "error",
          twyne_feature: feature,
          twyne_server_runtime: "convex",
          ...context,
        },
      }),
    }).catch(() => {
      /* swallowed — see comment above */
    });
  } catch {
    /* swallowed */
  }
}
