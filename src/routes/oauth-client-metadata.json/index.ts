import type { RequestHandler } from "@builder.io/qwik-city";
import { AUTH_CALLBACK_PATH, SCOPE } from "../../utils/atproto";

/**
 * ATProto OAuth client-metadata document.
 *
 * Served at `/oauth-client-metadata.json`. The `client_id` must equal this
 * document's own URL, so we derive everything from the request origin —
 * that way every deploy origin (production, preview, branch builds) is
 * self-describing without configuration. Loopback dev skips this endpoint
 * entirely (see src/utils/atproto.ts).
 */

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
export function metadataOrigin(url: URL): string {
  if (isLoopbackHost(url.hostname)) return url.origin;
  if (url.port) {
    throw new Error("ATProto OAuth client metadata cannot use a public port");
  }
  return `https://${url.hostname}`;
}

export function oauthClientMetadata(origin: string) {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: "Twyne",
    client_uri: origin,
    redirect_uris: [`${origin}${AUTH_CALLBACK_PATH}`],
    scope: SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  };
}

export const onGet: RequestHandler = ({ json, url }) => {
  try {
    json(200, oauthClientMetadata(metadataOrigin(url)));
  } catch (error) {
    json(400, {
      error: "invalid_client_metadata_origin",
      error_description:
        error instanceof Error ? error.message : "Invalid OAuth client origin",
    });
  }
};
