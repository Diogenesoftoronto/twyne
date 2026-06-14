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

export const onGet: RequestHandler = ({ json, url }) => {
  const origin = url.origin;
  json(200, {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: "Twyne",
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    scope: SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  });
};
