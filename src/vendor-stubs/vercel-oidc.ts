/**
 * Browser/SSR-safe stub for `@vercel/oidc`.
 *
 * The `ai` SDK statically pulls in `@ai-sdk/gateway`, which imports
 * `@vercel/oidc`. That package reads `process.version` / `process.env`
 * at module-eval time and crashes in the browser ("process is not
 * defined"). Twyne is BYOK — it calls providers directly and never uses
 * the Vercel AI Gateway — so this stub satisfies the import surface
 * without ever touching `process`. The token getters throw only if
 * actually called (they never are).
 */

export class AccessTokenMissingError extends Error {}
export class RefreshAccessTokenFailedError extends Error {}

export function getContext(): Record<string, unknown> {
  return {};
}

function unavailable(): never {
  throw new Error("Vercel OIDC is not available in this environment.");
}

export function getVercelOidcToken(): Promise<string> {
  return unavailable();
}

export function getVercelOidcTokenSync(): string {
  return unavailable();
}

export function getVercelToken(): Promise<string> {
  return unavailable();
}
