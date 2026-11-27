/**
 * What went wrong in automatic research, in a shape both the writer and a
 * developer can use.
 *
 * The writer sees `title` and `message` (what happened, whether anything was
 * lost) and a button for `recovery`. "What happened" shows `stage`, the
 * upstream status and `referenceId`; the reference matches the Convex log
 * line `[twyne:research.search] { referenceId, … }`, so a pasted report leads
 * straight to the server side.
 */
export type ResearchRecovery =
  | "retry"
  | "sign_in"
  | "add_credit"
  | "open_settings"
  | "contact_support"
  | "none";

export interface ResearchFailure {
  title: string;
  message: string;
  recovery: ResearchRecovery;
  /** Which step failed: "read-draft", "claim-check", "search", "read-page", "save". */
  stage: string;
  retryable: boolean;
  code?: string;
  referenceId?: string;
  provider?: string;
  upstreamStatus?: number;
  upstreamCode?: string;
  at: number;
}

const RECOVERIES = new Set<ResearchRecovery>([
  "retry",
  "sign_in",
  "add_credit",
  "open_settings",
  "contact_support",
]);

function text(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** The structured payload of a ConvexError, if this is one. */
function convexData(err: unknown): Record<string, unknown> | null {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      if (parsed && typeof parsed === "object")
        return parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/** Turn anything a research step threw into a {@link ResearchFailure}. */
export function researchFailureFrom(
  err: unknown,
  fallback: { stage: string; title: string; message: string; provider?: string },
): ResearchFailure {
  const data = convexData(err);
  if (data) {
    const recovery = text(data, "recovery") as ResearchRecovery | undefined;
    return {
      title: text(data, "title") ?? fallback.title,
      message: text(data, "message") ?? fallback.message,
      recovery:
        recovery && RECOVERIES.has(recovery)
          ? recovery
          : data.retryable === false
            ? "none"
            : "retry",
      stage: text(data, "stage") ?? fallback.stage,
      retryable: data.retryable !== false,
      code: text(data, "code"),
      referenceId: text(data, "referenceId"),
      provider: text(data, "provider") ?? fallback.provider,
      upstreamStatus:
        typeof data.upstreamStatus === "number"
          ? data.upstreamStatus
          : undefined,
      upstreamCode: text(data, "upstreamCode"),
      at: Date.now(),
    };
  }
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const offline =
    /failed to fetch|networkerror|network request failed|load failed/i.test(raw) ||
    (typeof navigator !== "undefined" && navigator.onLine === false);
  if (offline)
    return {
      title: "You're offline",
      message:
        "Twyne couldn't reach the research service. Your draft is safe; research resumes when the connection is back.",
      recovery: "retry",
      stage: fallback.stage,
      retryable: true,
      code: "offline",
      provider: fallback.provider,
      at: Date.now(),
    };
  return {
    title: fallback.title,
    message: raw ? `${fallback.message} (${raw})` : fallback.message,
    recovery: "retry",
    stage: fallback.stage,
    retryable: true,
    provider: fallback.provider,
    at: Date.now(),
  };
}

/** The one-line form used where only a string fits (activity rows, titles). */
export function researchFailureLine(f: ResearchFailure): string {
  return `${f.title}. ${f.message}`;
}

/** Lines for "What happened" and "Copy for support". */
export function researchFailureDetails(f: ResearchFailure): string[] {
  return [
    `Step: ${f.stage}`,
    f.provider && `Service: ${f.provider}`,
    f.upstreamStatus !== undefined &&
      `Answered: ${f.upstreamStatus || "no response"}${f.upstreamCode ? ` ${f.upstreamCode}` : ""}`,
    f.code && `Code: ${f.code}`,
    `When: ${new Date(f.at).toISOString()}`,
    f.referenceId && `Reference: ${f.referenceId}`,
  ].filter((line): line is string => Boolean(line));
}

/** Button label for a recovery, or null when there is nothing to press. */
export function researchRecoveryLabel(r: ResearchRecovery): string | null {
  switch (r) {
    case "retry":
      return "Try again now";
    case "sign_in":
      return "Sign in again";
    case "add_credit":
      return "Add credit";
    case "open_settings":
      return "Open research settings";
    case "contact_support":
      return "Copy details for support";
    case "none":
      return null;
  }
}

/* ── Developer log ────────────────────────────────────────────────
 * A short in-memory record of what research did, newest last. Never holds
 * draft text or queries beyond the first 80 characters, and never leaves
 * the browser unless the writer copies it.
 */

export interface ResearchLogEntry {
  at: number;
  stage: string;
  event: string;
  detail?: Record<string, string | number | boolean | undefined>;
}

const LOG_LIMIT = 200;
const researchLog: ResearchLogEntry[] = [];

export function logResearchEvent(
  stage: string,
  event: string,
  detail?: ResearchLogEntry["detail"],
): void {
  const entry = { at: Date.now(), stage, event, detail };
  researchLog.push(entry);
  if (researchLog.length > LOG_LIMIT) researchLog.shift();
  if (import.meta.env?.DEV)
    console.debug(`[twyne:research:${stage}] ${event}`, detail ?? "");
}

export function researchLogEntries(): readonly ResearchLogEntry[] {
  return researchLog;
}

/** A plain-text report a writer can paste into a support message. */
export function researchDiagnosticsReport(input: {
  status: string;
  route?: string;
  signedIn: boolean;
  failure?: ResearchFailure;
}): string {
  const lines: Array<string | false | undefined> = [
    `Twyne research diagnostics, ${new Date().toISOString()}`,
    `Page: ${typeof location === "undefined" ? "?" : location.origin}`,
    `Status: ${input.status}`,
    `Signed in: ${input.signedIn ? "yes" : "no"}`,
    input.route && `Searching through: ${input.route}`,
    ...(input.failure
      ? ["", "Last failure:", input.failure.title, ...researchFailureDetails(input.failure)]
      : []),
    "",
    "Recent events:",
    ...researchLog.slice(-40).map((e) => {
      const detail = e.detail
        ? " " +
          Object.entries(e.detail)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
        : "";
      return `${new Date(e.at).toISOString().slice(11, 19)} ${e.stage} ${e.event}${detail}`;
    }),
  ];
  return lines.filter((l): l is string => typeof l === "string").join("\n");
}
