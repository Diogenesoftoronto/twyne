/**
 * Browser half of "Continue with Not Organic" — the only Twyne sign-in.
 *
 * PKCE against id.notorganic.info. The browser only keeps the verifier and
 * state; the code is redeemed by Convex (`/sign-in/notorganic`), which verifies
 * the DID and issues the Twyne session.
 */
export const NOTORGANIC_SIGN_IN_ATTEMPT = "twyne:notorganic-sign-in";
export const NOTORGANIC_CALLBACK_PATH = "/auth/notorganic/";

export interface NotOrganicSignInAttempt {
  state: string;
  verifier: string;
  expiresAt: number;
  origin: string;
  /** Where to land after the session is issued. Same-origin path only. */
  returnTo: string;
}

const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
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
  sessionStorage.setItem(NOTORGANIC_SIGN_IN_ATTEMPT, JSON.stringify(attempt));
  location.assign(url);
}

/** Finish the redirect on the callback page; returns where to go next. */
export async function completeNotOrganicSignIn(url: URL): Promise<string> {
  const saved = sessionStorage.getItem(NOTORGANIC_SIGN_IN_ATTEMPT);
  sessionStorage.removeItem(NOTORGANIC_SIGN_IN_ATTEMPT);
  if (!saved) throw new Error("Start signing in again from Twyne.");
  const attempt = JSON.parse(saved) as NotOrganicSignInAttempt;
  const args = readNotOrganicCallback(attempt, url);
  const { authClient } = await import("./auth-client");
  const result = await authClient.$fetch("/sign-in/notorganic", {
    method: "POST",
    body: { ...args, origin: attempt.origin },
  });
  if ((result as { error?: unknown })?.error) {
    throw new Error("Not Organic could not verify this sign-in.");
  }
  // The crossDomain client stores the new session cookie; refresh the atom.
  await authClient.getSession({ query: { disableCookieCache: true } });
  return safeReturnTo(attempt.returnTo);
}
