export type AnalyticsAuthMethod = "passkey" | "email_otp" | "bluesky";
export type AuthFlow = "signin" | "signup";

export interface PendingAuthAttempt {
  method: AnalyticsAuthMethod;
  flow: AuthFlow;
  startedAt: number;
}

export type AuthIdentityTransition =
  | "identify_anonymous"
  | "already_identified"
  | "alias_legacy_id"
  | "reset_other_account";

const PENDING_AUTH_ATTEMPT_KEY = "twyne:analytics:pending-auth-attempt";
const PENDING_AUTH_ATTEMPT_TTL_MS = 15 * 60 * 1000;
const AUTH_METHODS = new Set(["passkey", "email_otp", "bluesky"]);
const AUTH_FLOWS = new Set(["signin", "signup"]);

type AuthAttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserSessionStorage(): AuthAttemptStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Decode the already-authenticated Convex JWT only to align analytics IDs.
 * This value must never be used to make an authorization decision.
 */
export function analyticsIdFromConvexJwt(
  token: string | undefined,
): string | undefined {
  if (!token) return undefined;
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) return undefined;

  try {
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      iss?: unknown;
      sub?: unknown;
    };
    const issuer =
      typeof payload.iss === "string" ? payload.iss.trim() : undefined;
    const subject =
      typeof payload.sub === "string" ? payload.sub.trim() : undefined;
    if (!issuer || !subject) return undefined;
    return `${issuer}|${subject}`;
  } catch {
    return undefined;
  }
}

/** Keep account switching isolated while preserving a known legacy identity. */
export function authIdentityTransition(
  previousUserId: string | undefined,
  authUserId: string,
  analyticsId: string,
): AuthIdentityTransition {
  if (!previousUserId) return "identify_anonymous";
  if (previousUserId === analyticsId) return "already_identified";
  if (previousUserId === authUserId && authUserId !== analyticsId) {
    return "alias_legacy_id";
  }
  return "reset_other_account";
}

export function rememberAuthAttempt(
  attempt: Omit<PendingAuthAttempt, "startedAt">,
  storage: AuthAttemptStorage | undefined = browserSessionStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      PENDING_AUTH_ATTEMPT_KEY,
      JSON.stringify({ ...attempt, startedAt: now }),
    );
  } catch {
    // Analytics must never block authentication when storage is unavailable.
  }
}

export function clearAuthAttempt(
  storage: AuthAttemptStorage | undefined = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_AUTH_ATTEMPT_KEY);
  } catch {
    // Analytics must never block authentication when storage is unavailable.
  }
}

export function consumeAuthAttempt(
  storage: AuthAttemptStorage | undefined = browserSessionStorage(),
  now = Date.now(),
): PendingAuthAttempt | undefined {
  if (!storage) return undefined;

  try {
    const raw = storage.getItem(PENDING_AUTH_ATTEMPT_KEY);
    storage.removeItem(PENDING_AUTH_ATTEMPT_KEY);
    if (!raw) return undefined;

    const attempt = JSON.parse(raw) as Partial<PendingAuthAttempt>;
    if (
      typeof attempt.method !== "string" ||
      !AUTH_METHODS.has(attempt.method) ||
      typeof attempt.flow !== "string" ||
      !AUTH_FLOWS.has(attempt.flow) ||
      typeof attempt.startedAt !== "number" ||
      !Number.isFinite(attempt.startedAt) ||
      attempt.startedAt > now ||
      now - attempt.startedAt > PENDING_AUTH_ATTEMPT_TTL_MS
    ) {
      return undefined;
    }

    return attempt as PendingAuthAttempt;
  } catch {
    return undefined;
  }
}
