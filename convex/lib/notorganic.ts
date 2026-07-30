export const NOTORGANIC_DEFAULT_ISSUER = "https://api.notorganic.info";
export const NOTORGANIC_PRODUCT = "twyne";
export const NOTORGANIC_ASSERTION_TTL_SECONDS = 60;

export const NOTORGANIC_MODEL_ALIASES = [
  "fast",
  "balanced",
  "reasoning",
  "vision",
  "embedding",
  "image",
  "audio",
  "realtime",
] as const;
export type NotOrganicModelAlias =
  (typeof NOTORGANIC_MODEL_ALIASES)[number];

export interface ProductAssertionInput {
  readonly did: string;
  readonly feature: string;
  readonly capabilities: readonly string[];
  readonly sessionVersion?: number;
}

export interface NotOrganicAccessToken {
  readonly accessToken: string;
  readonly expiresIn?: number;
  readonly tokenType?: string;
  readonly dpop: DpopKeyPair;
}

export interface DpopKeyPair {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

export interface NotOrganicOpenAiRoute {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: NotOrganicModelAlias;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetch: typeof fetch;
}

export interface DidLinkRecord {
  readonly did: string;
  readonly productSubject: string;
}

function base64url(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function loadPrivateKey(value: string): Promise<CryptoKey> {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    return crypto.subtle.importKey(
      "jwk",
      JSON.parse(trimmed),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  }
  const encoded = trimmed.includes("BEGIN PRIVATE KEY")
    ? trimmed
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
    : trimmed;
  return crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(encoded),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

export function notOrganicEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = env.NOTORGANIC_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function notOrganicIssuer(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (env.NOTORGANIC_ISSUER ?? NOTORGANIC_DEFAULT_ISSUER).replace(
    /\/$/,
    "",
  );
}

export function notOrganicOpenAiRoute(
  token: NotOrganicAccessToken,
  alias: NotOrganicModelAlias,
  feature: string,
  issuer = NOTORGANIC_DEFAULT_ISSUER,
  fetchImpl: typeof fetch = fetch,
): NotOrganicOpenAiRoute {
  if (!token.accessToken) throw new Error("A provider access token is required");
  if (!feature.trim()) throw new Error("A feature is required");
  return {
    baseURL: `${issuer.replace(/\/$/, "")}/v1`,
    apiKey: token.accessToken,
    model: alias,
    headers: {
      "x-notorganic-product": NOTORGANIC_PRODUCT,
      "x-notorganic-feature": feature,
    },
    fetch: createDpopFetch(token, fetchImpl),
  };
}

export async function createDpopKeyPair(): Promise<DpopKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: pair.privateKey,
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

async function accessTokenHash(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(accessToken),
  );
  return base64url(new Uint8Array(digest));
}

export async function createDpopProof(
  token: NotOrganicAccessToken,
  url: string,
  method: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> {
  const header = {
    alg: "ES256",
    typ: "dpop+jwt",
    jwk: token.dpop.publicJwk,
  };
  const claims = {
    htm: method.toUpperCase(),
    htu: url,
    ath: await accessTokenHash(token.accessToken),
    iat: nowSeconds,
    exp: nowSeconds + 60,
    jti: crypto.randomUUID(),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims),
  )}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    token.dpop.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

export function createDpopFetch(
  token: NotOrganicAccessToken,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("authorization", `DPoP ${token.accessToken}`);
    headers.set(
      "dpop",
      await createDpopProof(token, request.url, request.method),
    );
    return fetchImpl(new Request(request, { headers }));
  }) as typeof fetch;
}

/**
 * Sign the 60-second product assertion exchanged for a provider access token.
 * The Ed25519 private key is accepted as PKCS#8 PEM/base64 or a private JWK and
 * never leaves the Convex server action runtime.
 */
export async function signProductAssertion(
  input: ProductAssertionInput,
  privateKey: string,
  options: {
    readonly issuer?: string;
    readonly keyId?: string;
    readonly nowSeconds?: number;
    readonly jti?: string;
  } = {},
): Promise<string> {
  if (!input.did.startsWith("did:")) throw new Error("A valid DID is required");
  if (!input.feature.trim()) throw new Error("A feature is required");
  if (input.capabilities.length === 0) {
    throw new Error("At least one capability is required");
  }

  const iat = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const header = {
    alg: "EdDSA",
    typ: "JWT",
    ...(options.keyId ? { kid: options.keyId } : {}),
  };
  const claims = {
    typ: "notorganic/assertion+jwt",
    iss: NOTORGANIC_PRODUCT,
    sub: input.did,
    aud: options.issuer ?? NOTORGANIC_DEFAULT_ISSUER,
    jti: options.jti ?? crypto.randomUUID(),
    iat,
    exp: iat + NOTORGANIC_ASSERTION_TTL_SECONDS,
    session_version: input.sessionVersion ?? 1,
    capabilities: [...input.capabilities],
    feature: input.feature,
    environment: "server",
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims),
  )}`;
  const signature = await crypto.subtle.sign(
    "Ed25519",
    await loadPrivateKey(privateKey),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

export async function exchangeProductAssertion(
  assertion: string,
  options: {
    readonly issuer?: string;
    readonly fetch?: typeof fetch;
    readonly dpop?: DpopKeyPair;
  } = {},
): Promise<NotOrganicAccessToken> {
  const issuer = (options.issuer ?? NOTORGANIC_DEFAULT_ISSUER).replace(
    /\/$/,
    "",
  );
  const dpop = options.dpop ?? (await createDpopKeyPair());
  const response = await (options.fetch ?? fetch)(
    `${issuer}/v1/auth/token/exchange`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assertion,
        dpop_jwk: dpop.publicJwk,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Not Organic token exchange failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
    token_type?: unknown;
  };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Not Organic token exchange returned no access_token");
  }
  return {
    accessToken: body.access_token,
    expiresIn:
      typeof body.expires_in === "number" ? body.expires_in : undefined,
    tokenType:
      typeof body.token_type === "string" ? body.token_type : undefined,
    dpop,
  };
}

export async function issueNotOrganicAccessToken(
  input: ProductAssertionInput,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<NotOrganicAccessToken> {
  if (!notOrganicEnabled(env)) {
    throw new Error("Not Organic provider is disabled");
  }
  const privateKey = env.NOTORGANIC_ASSERTION_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("NOTORGANIC_ASSERTION_PRIVATE_KEY is not configured");
  }
  const issuer = notOrganicIssuer(env);
  const assertion = await signProductAssertion(input, privateKey, {
    issuer,
    keyId: env.NOTORGANIC_ASSERTION_KEY_ID,
  });
  return exchangeProductAssertion(assertion, {
    issuer,
    fetch: fetchImpl,
  });
}

/**
 * Pure uniqueness guard used inside the transactional Convex link mutation.
 */
export function assertUniqueDidLink(
  requested: DidLinkRecord,
  existingByDid: DidLinkRecord | null,
  existingBySubject: DidLinkRecord | null,
): void {
  if (
    existingByDid &&
    existingByDid.productSubject !== requested.productSubject
  ) {
    throw new Error("This DID is already linked to another Twyne account");
  }
  if (
    existingBySubject &&
    existingBySubject.did !== requested.did
  ) {
    throw new Error("This Twyne account is already linked to another DID");
  }
}

export async function providerJsonRequest<T>(
  path: string,
  token: NotOrganicAccessToken,
  init: RequestInit = {},
  options: {
    readonly issuer?: string;
    readonly feature: string;
    readonly fetch?: typeof fetch;
  },
): Promise<T> {
  const issuer = (options.issuer ?? NOTORGANIC_DEFAULT_ISSUER).replace(
    /\/$/,
    "",
  );
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-notorganic-product", NOTORGANIC_PRODUCT);
  headers.set("x-notorganic-feature", options.feature);
  const response = await createDpopFetch(
    token,
    options.fetch ?? fetch,
  )(`${issuer}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Not Organic API failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}
