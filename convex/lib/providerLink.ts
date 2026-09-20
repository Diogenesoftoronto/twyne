import { createDpopKeyPair, createDpopFetch } from "./notorganic";

/** Redeem a one-time provider authorization; no caller-supplied DID is trusted. */
export async function redeemProviderLink(
  input: { code: string; verifier: string },
  siteUrl: string,
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ did: string; sessionVersion: number }> {
  if (
    !input.code ||
    input.code.length > 2048 ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)
  ) {
    throw new Error(
      "The connection attempt is invalid. Start again from Settings.",
    );
  }
  const origin = new URL(siteUrl).origin;
  const dpop = await createDpopKeyPair();
  const response = await fetchImpl(`${issuer}/v1/public/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      code: input.code,
      code_verifier: input.verifier,
      client_id: origin,
      redirect_uri: `${origin}/settings/`,
      dpop_jwk: dpop.publicJwk,
    }),
  });
  if (!response.ok)
    throw new Error(
      "Not Organic could not verify this connection. Start again from Settings.",
    );
  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new Error("Not Organic returned no account proof.");
  const accountResponse = await createDpopFetch(
    { accessToken: body.access_token, dpop },
    fetchImpl,
  )(`${issuer}/v1/account`, { signal: AbortSignal.timeout(15_000) });
  if (!accountResponse.ok)
    throw new Error("Not Organic could not verify account ownership.");
  const account = (await accountResponse.json()) as {
    account?: { did?: string };
  };
  // This token has now been authenticated by the issuer with its DPoP proof.
  const encoded = body.access_token.split(".")[1];
  const claims = JSON.parse(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
  ) as { sub?: string; product?: string; session_version?: number };
  if (
    !account.account?.did ||
    !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(account.account.did) ||
    account.account.did !== claims.sub ||
    claims.product !== "twyne" ||
    !Number.isSafeInteger(claims.session_version) ||
    claims.session_version! < 0
  ) {
    throw new Error(
      "The verified account does not match this Twyne connection.",
    );
  }
  return { did: account.account.did, sessionVersion: claims.session_version! };
}
