/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { api } from "./_generated/api";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

describeConvex("hosted usage account boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  test("rejects unauthenticated and unlinked callers", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.providerIdentity.getHostedUsage, { from: 100, to: 200 }),
    ).rejects.toThrow("Not signed in");
    await expect(
      t
        .withIdentity({ subject: "unlinked" })
        .action(api.providerIdentity.getHostedUsage, { from: 100, to: 200 }),
    ).rejects.toThrow("Sign in with Not Organic");
  });
  test("uses the verified caller link and returns only bounded Twyne totals", async () => {
    const key = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    vi.stubEnv("NOTORGANIC_ENABLED", "true");
    vi.stubEnv("NOTORGANIC_ASSERTION_PRIVATE_KEY", key);
    vi.stubEnv("NOTORGANIC_ISSUER", "https://provider.example.test");
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requested.push(request.url);
        if (request.url.endsWith("/v1/auth/token/exchange")) {
          const body = await request.json();
          const claims = JSON.parse(
            atob(
              body.assertion
                .split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            ),
          );
          expect(claims).toMatchObject({
            sub: "did:plc:alice",
            capabilities: ["usage:read"],
            session_version: 3,
          });
          return Response.json({ access_token: "test-token" });
        }
        expect(request.headers.get("authorization")).toBe("DPoP test-token");
        expect(request.headers.get("dpop")).toBeTruthy();
        return Response.json({
          object: "list",
          data: [
            {
              requestId: "twyne-request",
              product: "twyne",
              createdAt: 150,
              state: "succeeded",
              billedMicros: 42,
            },
            {
              requestId: "other-request",
              product: "keating",
              createdAt: 150,
              state: "succeeded",
              billedMicros: 999,
            },
          ],
        });
      },
    );
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("providerIdentities", {
        did: "did:plc:alice",
        productSubject: "alice",
        verificationMethod: "notorganic_pkce",
        sessionVersion: 3,
        verifiedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const summary = await t
      .withIdentity({ subject: "alice" })
      .action(api.providerIdentity.getHostedUsage, { from: 100, to: 200 });
    expect(summary).toEqual({
      billedMicrousd: 42,
      settledRequests: 1,
      unverifiedCostRequests: 0,
      unverifiedCostMicrousd: 0,
      unresolvedRequests: 0,
      truncated: false,
    });
    expect(requested).toEqual([
      "https://provider.example.test/v1/auth/token/exchange",
      "https://provider.example.test/v1/usage?limit=100",
    ]);
  });
});
