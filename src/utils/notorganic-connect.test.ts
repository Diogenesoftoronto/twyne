import { describe, expect, test } from "bun:test";
import {
  beginNotOrganicSignIn,
  readNotOrganicCallback,
} from "./notorganic-connect";
import { redeemProviderLink } from "../../convex/lib/providerLink";

describe("Not Organic sign-in", () => {
  test("binds the callback to the initiating origin, path, state and expiry", async () => {
    const { attempt, url } = await beginNotOrganicSignIn(
      "https://twyne.love",
      "//evil.example/",
    );
    const authorize = new URL(url);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://twyne.love/auth/notorganic/",
    );
    expect(attempt.returnTo).toBe("/");
    const callback = new URL(
      `https://twyne.love/auth/notorganic/?code=one-time&state=${attempt.state}`,
    );
    expect(readNotOrganicCallback(attempt, callback).verifier).toBe(
      attempt.verifier,
    );
    expect(() =>
      readNotOrganicCallback({ ...attempt, expiresAt: 0 }, callback),
    ).toThrow();
    expect(() =>
      readNotOrganicCallback(attempt, new URL(callback.href + "&state=other")),
    ).toThrow();
    expect(() =>
      readNotOrganicCallback(
        attempt,
        new URL(callback.href.replace("twyne.love", "evil.example")),
      ),
    ).toThrow();
    expect(() =>
      readNotOrganicCallback(
        attempt,
        new URL(callback.href.replace("/auth/notorganic/", "/settings/")),
      ),
    ).toThrow();
  });

  const token = (product = "twyne") =>
    `e30.${btoa(JSON.stringify({ sub: "did:plc:writer", product, session_version: 3 }))}.signature`;
  test("redeems the code on the server and verifies account ownership with DPoP", async () => {
    const requests: Request[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json(
        request.url.endsWith("/token")
          ? { access_token: token() }
          : { account: { did: "did:plc:writer" } },
      );
    }) as typeof fetch;
    const result = await redeemProviderLink(
      { code: "one-time", verifier: "a".repeat(43) },
      "https://twyne.love",
      "https://api.notorganic.info",
      fake,
      "/auth/notorganic/",
    );
    expect(result).toEqual({ did: "did:plc:writer", sessionVersion: 3 });
    expect(await requests[0].json()).toMatchObject({
      client_id: "https://twyne.love",
      redirect_uri: "https://twyne.love/auth/notorganic/",
      code: "one-time",
    });
    expect(requests[1].headers.get("dpop")).toBeTruthy();
    expect(requests[1].headers.get("authorization")).toStartWith("DPoP ");
  });
  test("rejects failed proof, cross-product tokens, and mismatched account identities", async () => {
    for (const [status, product, did] of [
      [401, "twyne", "did:plc:writer"],
      [200, "keating", "did:plc:writer"],
      [200, "twyne", "did:plc:other"],
    ] as const) {
      const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        return request.url.endsWith("/token")
          ? Response.json({ access_token: token(product) })
          : Response.json({ account: { did } }, { status });
      }) as typeof fetch;
      await expect(
        redeemProviderLink(
          { code: "one-time", verifier: "a".repeat(43) },
          "https://twyne.love",
          "https://api.notorganic.info",
          fake,
        ),
      ).rejects.toThrow();
    }
  });
});
