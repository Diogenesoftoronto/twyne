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

function metadataOrigin(url: URL): string {
  if (PROD_HOSTS.has(url.hostname)) return url.origin;
  const configured =
    import.meta.env.PUBLIC_SITE_URL ||
    import.meta.env.SITE_URL ||
    import.meta.env.BETTER_AUTH_URL;
  if (configured) return new URL(configured).origin;
  return url.origin;
}

export const onGet: RequestHandler = ({ json, url }) => {
  const origin = metadataOrigin(url);
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
