/**
 * Intercepts Lix sync fetch calls so they carry the better-auth session.
 *
 * The Lix SDK's `initSyncProcess` issues raw `fetch()` requests to the
 * `/lsp/*` relay on the Convex site URL. On a cross-domain deployment the
 * browser won't automatically send the better-auth session cookie, so the
 * cross-domain client stores it in localStorage and exposes `getCookie()`.
 * We intercept same-origin-to-the-relay LSP requests and add the
 * `Better-Auth-Cookie` header, which the server converts back into a `Cookie`
 * header for session verification.
 */
import { authClient } from "./auth-client";

const CONVEX_SITE_URL = (
  import.meta.env.VITE_CONVEX_SITE_URL as string | undefined
)?.replace(/\/$/, "");

function isLspRequest(input: RequestInfo | URL): boolean {
  if (!CONVEX_SITE_URL) return false;
  const url =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString();
  return url.startsWith(`${CONVEX_SITE_URL}/lsp/`);
}

function getStoredAuthCookie(): string | undefined {
  try {
    return ((authClient as any).getCookie?.() as string | undefined) ?? "";
  } catch {
    return "";
  }
}

let installed = false;

/** Install a fetch wrapper that adds the auth cookie to Lix LSP requests. */
export function installLixAuthInterceptor(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  const originalFetch = window.fetch;
  const wrapper = async function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (isLspRequest(input)) {
      const cookie = getStoredAuthCookie();
      if (cookie) {
        const headers = new Headers(init?.headers);
        headers.set("Better-Auth-Cookie", cookie);
        init = { ...init, headers };
      }
    }
    return originalFetch.call(this, input, init);
  };
  window.fetch = wrapper as typeof window.fetch;
}
