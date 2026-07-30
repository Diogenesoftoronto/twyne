import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";

import {
  assertUniqueDidLink,
  createDpopKeyPair,
  createDpopProof,
  exchangeProductAssertion,
  notOrganicEnabled,
  notOrganicOpenAiRoute,
  signProductAssertion,
} from "../convex/lib/notorganic";

function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("Not Organic product assertions", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;

  test("signs a verifiable 60-second Ed25519 assertion", async () => {
    const jwt = await signProductAssertion(
      {
        did: "did:plc:alice",
        feature: "persona-feedback",
        capabilities: ["infer:balanced"],
        sessionVersion: 7,
      },
      pem,
      {
        nowSeconds: 1_000,
        jti: "test-assertion",
        issuer: "https://api.notorganic.info",
        keyId: "twyne-test",
      },
    );
    const [header, payload, signature] = jwt.split(".");
    expect(decode(header!)).toEqual({
      alg: "EdDSA",
      typ: "JWT",
      kid: "twyne-test",
    });
    expect(decode(payload!)).toMatchObject({
      iss: "twyne",
      sub: "did:plc:alice",
      aud: "https://api.notorganic.info",
      iat: 1_000,
      exp: 1_060,
      session_version: 7,
      feature: "persona-feedback",
      capabilities: ["infer:balanced"],
    });
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey as KeyObject,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  test("exchanges at the locked provider endpoint", async () => {
    let requestedUrl = "";
    const result = await exchangeProductAssertion("assertion", {
      fetch: (async (url, init) => {
        requestedUrl = String(url);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          assertion: "assertion",
          dpop_jwk: { kty: "EC", crv: "P-256" },
        });
        return Response.json({
          access_token: "provider-token",
          expires_in: 300,
          token_type: "Bearer",
        });
      }) as typeof fetch,
    });
    expect(requestedUrl).toBe(
      "https://api.notorganic.info/v1/auth/token/exchange",
    );
    expect(result.accessToken).toBe("provider-token");
  });

  test("routes hosted aliases with product and feature metadata", async () => {
    const route = notOrganicOpenAiRoute(
      {
        accessToken: "access-token",
        dpop: await createDpopKeyPair(),
      },
      "reasoning",
      "rubric-review",
    );
    expect(route).toMatchObject({
      baseURL: "https://api.notorganic.info/v1",
      apiKey: "access-token",
      model: "reasoning",
      headers: {
        "x-notorganic-product": "twyne",
        "x-notorganic-feature": "rubric-review",
      },
    });
    expect(route.fetch).toBeFunction();
  });

  test("binds every request to the exchanged token with DPoP", async () => {
    const token = {
      accessToken: "access-token",
      dpop: await createDpopKeyPair(),
    };
    const proof = await createDpopProof(
      token,
      "https://api.notorganic.info/v1/responses",
      "POST",
      1_000,
    );
    const [header, payload, signature] = proof.split(".");
    expect(decode(header!)).toMatchObject({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: { kty: "EC", crv: "P-256" },
    });
    expect(decode(payload!)).toMatchObject({
      htm: "POST",
      htu: "https://api.notorganic.info/v1/responses",
      iat: 1_000,
      exp: 1_060,
    });
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      token.dpop.publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        Buffer.from(signature!, "base64url"),
        Buffer.from(`${header}.${payload}`),
      ),
    ).toBe(true);
  });
});

describe("provider identity boundary", () => {
  test("enforces one DID and one product subject", () => {
    expect(() =>
      assertUniqueDidLink(
        { did: "did:plc:a", productSubject: "subject-a" },
        { did: "did:plc:a", productSubject: "subject-b" },
        null,
      ),
    ).toThrow("already linked");
    expect(() =>
      assertUniqueDidLink(
        { did: "did:plc:a", productSubject: "subject-a" },
        null,
        { did: "did:plc:b", productSubject: "subject-a" },
      ),
    ).toThrow("already linked");
  });

  test("requires an explicit server feature flag", () => {
    expect(notOrganicEnabled({ NOTORGANIC_ENABLED: "true" })).toBe(true);
    expect(notOrganicEnabled({ NOTORGANIC_ENABLED: "0" })).toBe(false);
  });
});
