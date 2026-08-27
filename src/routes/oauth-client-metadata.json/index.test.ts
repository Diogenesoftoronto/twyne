import { describe, expect, test } from "vitest";
import { metadataOrigin, oauthClientMetadata } from "./index";
import { SCOPE } from "../../utils/atproto";

describe("ATProto OAuth client metadata", () => {
  test("describes the exact public URL used as the client id", () => {
    const origin = metadataOrigin(
      new URL("http://preview.example.com/oauth-client-metadata.json"),
    );
    const metadata = oauthClientMetadata(origin);

    expect(origin).toBe("https://preview.example.com");
    expect(metadata).toMatchObject({
      client_id: "https://preview.example.com/oauth-client-metadata.json",
      client_uri: "https://preview.example.com",
      redirect_uris: ["https://preview.example.com/auth/callback/"],
      scope: SCOPE,
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    });
  });

  test("preserves the IP-literal loopback origin used in development", () => {
    expect(
      metadataOrigin(
        new URL("http://127.0.0.1:5173/oauth-client-metadata.json"),
      ),
    ).toBe("http://127.0.0.1:5173");
  });

  test("rejects public client ids with a port", () => {
    expect(() =>
      metadataOrigin(
        new URL("https://preview.example.com:8443/oauth-client-metadata.json"),
      ),
    ).toThrow("cannot use a public port");
  });
});
