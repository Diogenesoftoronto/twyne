import type { RequestHandler } from "@builder.io/qwik-city";

/**
 * ATProto OAuth client-metadata document.
 *
 * Served at `/oauth-client-metadata.json`. The `client_id` must equal this
 * document's own URL, so we derive everything from the request origin —
 * that way every deploy origin (production, preview, branch builds) is
 * self-describing without configuration. Loopback dev skips this endpoint
 * entirely (see src/utils/atproto.ts).
 *
 * Scope is kept in sync with SCOPE in src/utils/atproto.ts.
 */

const SCOPE = "atproto blob:image/* include:site.standard.authFull";
const AUTH_CALLBACK_PATH = "/auth/callback/";
const PROD_HOSTS = new Set(["twyne.love", "www.twyne.love"]);

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Railway (and most edge proxies) terminate TLS at the edge and forward
 * plain HTTP to the app, so `url.origin` comes back as `http://…` even on
 * the public HTTPS site. ATProto only accepts an `http:` client_id for
 * loopback dev clients, so an `http://twyne.love` document is rejected with
 * "URL must use localhost…". Force `https` for every non-loopback host and
 * honor `x-forwarded-proto` when present.
 */
function metadataOrigin(url: URL, forwardedProto?: string | null): string {
  if (isLoopbackHost(url.hostname)) return url.origin;

  if (!PROD_HOSTS.has(url.hostname)) {
    const configured =
      import.meta.env.PUBLIC_SITE_URL ||
      import.meta.env.SITE_URL ||
      import.meta.env.BETTER_AUTH_URL;
    if (configured) return new URL(configured).origin;
  }

  const proto = forwardedProto?.split(",")[0]?.trim() || "https";
  return `${proto}://${url.host}`;
}

export const onGet: RequestHandler = ({ json, url, request }) => {
  const origin = metadataOrigin(
    url,
    request.headers.get("x-forwarded-proto"),
  );
  json(200, {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: "Twyne",
    client_uri: origin,
    redirect_uris: [`${origin}${AUTH_CALLBACK_PATH}`, `${origin}/`],
    scope: SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  });
};
