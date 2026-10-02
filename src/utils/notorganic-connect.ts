/**
 * Browser half of "Continue with Not Organic" — the only Twyne sign-in.
 *
 * PKCE against id.notorganic.info. The browser only keeps the verifier and
 * state; the code is redeemed by Convex (`/sign-in/notorganic`), which verifies
 * the DID and issues the Twyne session.
 */
import {
  claimBriefDraftHandoff,
  FLUSH_BRIEF_DRAFT,
  prepareBriefDraftHandoff,
  type BriefDraftHandoff,
} from "./brief-form-draft";

export const NOTORGANIC_SIGN_IN_ATTEMPT = "twyne:notorganic-sign-in";
export const NOTORGANIC_CALLBACK_PATH = "/auth/notorganic/";

export interface NotOrganicSignInAttempt {
  state: string;
  verifier: string;
  expiresAt: number;
  origin: string;
  /** Where to land after the session is issued. Same-origin path only. */
  returnTo: string;
  briefDraft?: BriefDraftHandoff;
}

const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function safeReturnTo(value: string | undefined): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return "/";
  return value;
}

export async function beginNotOrganicSignIn(
  origin: string,
  returnTo?: string,
): Promise<{ attempt: NotOrganicSignInAttempt; url: string }> {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const url = new URL("https://id.notorganic.info/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: origin,
    redirect_uri: `${origin}${NOTORGANIC_CALLBACK_PATH}`,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: "wallet:read",
    product: "twyne",
  }).toString();
  return {
    attempt: {
      state,
      verifier,
      expiresAt: Date.now() + 600_000,
      origin,
      returnTo: safeReturnTo(returnTo),
    },
    url: url.href,
  };
}

export function readNotOrganicCallback(
  attempt: NotOrganicSignInAttempt,
  url: URL,
): { code: string; verifier: string } {
  if (
    !attempt ||
    typeof attempt.state !== "string" ||
    !attempt.state ||
    typeof attempt.verifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(attempt.verifier) ||
    !Number.isFinite(attempt.expiresAt) ||
    Date.now() >= attempt.expiresAt ||
    url.origin !== attempt.origin ||
    url.pathname !== NOTORGANIC_CALLBACK_PATH ||
    url.hash ||
    url.searchParams.has("error") ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== attempt.state ||
    url.searchParams.getAll("code").length !== 1 ||
    !url.searchParams.get("code")
  ) {
    throw new Error(
      "This sign-in attempt expired or belongs to another tab. Please sign in again.",
    );
  }
  return { code: url.searchParams.get("code")!, verifier: attempt.verifier };
}

/** Redirect to Not Organic. Resolves only if the redirect could not start. */
export async function startNotOrganicSignIn(returnTo?: string): Promise<void> {
  const { attempt, url } = await beginNotOrganicSignIn(
    location.origin,
    returnTo ?? location.pathname + location.search,
  );
  window.dispatchEvent(new Event(FLUSH_BRIEF_DRAFT));
  attempt.briefDraft = prepareBriefDraftHandoff(sessionStorage);
  sessionStorage.setItem(NOTORGANIC_SIGN_IN_ATTEMPT, JSON.stringify(attempt));
  location.assign(url);
}

/** Finish the redirect on the callback page; returns where to go next. */
export async function completeNotOrganicSignIn(
  url: URL,
  dependencies: {
    storage?: Pick<Storage, "getItem" | "removeItem"> &
      Partial<Pick<Storage, "setItem">>;
    client?: {
      $fetch: (
        path: string,
        options: {
          method: "POST";
          body: { code: string; verifier: string; origin: string };
        },
      ) => Promise<{ data?: unknown; error?: unknown }>;
      getSession: (options: {
        query: { disableCookieCache: true };
      }) => Promise<{ data?: unknown; error?: unknown }>;
    };
  } = {},
): Promise<string> {
  const storage = dependencies.storage ?? sessionStorage;
  const saved = storage.getItem(NOTORGANIC_SIGN_IN_ATTEMPT);
  storage.removeItem(NOTORGANIC_SIGN_IN_ATTEMPT);
  if (!saved) throw new Error("Start signing in again from Twyne.");
  let attempt: NotOrganicSignInAttempt;
  try {
    attempt = JSON.parse(saved) as NotOrganicSignInAttempt;
  } catch {
    throw new Error("Start signing in again from Twyne.");
  }
  const args = readNotOrganicCallback(attempt, url);
  const client =
    dependencies.client ?? (await import("./auth-client")).authClient;
  const result = await client.$fetch("/sign-in/notorganic", {
    method: "POST",
    body: { ...args, origin: attempt.origin },
  });
  if (result?.error) {
    throw new Error("Not Organic could not verify this sign-in.");
  }
  // The crossDomain client stores the new session cookie; refresh the atom.
  const refreshed = await client.getSession({
    query: { disableCookieCache: true },
  });
  const issuedUser = record(record(result?.data)?.user);
  const sessionData = record(refreshed?.data);
  const session = record(sessionData?.session);
  const user = record(sessionData?.user);
  if (
    refreshed?.error ||
    typeof issuedUser?.id !== "string" ||
    !issuedUser.id ||
    !session ||
    typeof session.id !== "string" ||
    !session.id ||
    session.userId !== issuedUser.id ||
    user?.id !== issuedUser.id
  ) {
    throw new Error(
      "Twyne could not confirm your session. Please sign in again.",
    );
  }
  if (storage.setItem)
    claimBriefDraftHandoff(
      storage as Storage,
      attempt.briefDraft,
      issuedUser.id,
    );
  return safeReturnTo(attempt.returnTo);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
