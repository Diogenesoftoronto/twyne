export const PROVIDER_LINK_ATTEMPT = "twyne:notorganic-connect";
export interface ProviderLinkAttempt {
  userId: string;
  state: string;
  verifier: string;
  expiresAt: number;
  origin: string;
}
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function beginProviderConnection(
  userId: string,
  origin: string,
): Promise<{ attempt: ProviderLinkAttempt; url: string }> {
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
    redirect_uri: `${origin}/settings/`,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: "wallet:read",
    product: "twyne",
  }).toString();
  return {
    attempt: {
      userId,
      state,
      verifier,
      expiresAt: Date.now() + 600_000,
      origin,
    },
    url: url.href,
  };
}

export function readProviderCallback(
  attempt: ProviderLinkAttempt,
  userId: string,
  url: URL,
): { code: string; verifier: string } {
  if (
    attempt.userId !== userId ||
    !Number.isFinite(attempt.expiresAt) ||
    Date.now() >= attempt.expiresAt ||
    url.origin !== attempt.origin ||
    url.pathname !== "/settings/" ||
    url.hash ||
    url.searchParams.has("error") ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== attempt.state ||
    url.searchParams.getAll("code").length !== 1 ||
    !url.searchParams.get("code")
  ) {
    throw new Error(
      "This connection attempt expired or belongs to another session. Please connect again.",
    );
  }
  return { code: url.searchParams.get("code")!, verifier: attempt.verifier };
}
