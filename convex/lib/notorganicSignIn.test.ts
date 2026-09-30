import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { parseSetCookieHeader } from "better-auth/cookies";
import { crossDomain } from "@convex-dev/better-auth/plugins";
import { httpRouter } from "convex/server";
import { authComponent, trustedOrigins } from "../auth";
import {
  notOrganicSignIn,
  type VerifiedNotOrganicAccount,
} from "./notorganicSignIn";

const BACKEND = "https://synthetic-auth.example.test";
const DID = "did:plc:syntheticwriter";

function fixture(siteUrl = "https://twyne.love") {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  let verified: VerifiedNotOrganicAccount = {
    did: DID,
    sessionVersion: 3,
    handle: "synthetic.test",
    displayName: "Synthetic Writer",
    avatarUrl: "https://images.example.test/synthetic.png",
  };
  let redemptionCount = 0;
  const links: Array<VerifiedNotOrganicAccount & { userId: string }> = [];
  const auth = betterAuth({
    baseURL: BACKEND,
    secret: "synthetic-test-secret-at-least-thirty-two-characters",
    database: memoryAdapter(db),
    trustedOrigins: trustedOrigins(siteUrl, ""),
    plugins: [
      notOrganicSignIn({
        redeem: async () => {
          redemptionCount++;
          return verified;
        },
        onSignedIn: async (link) => {
          links.push(link);
        },
      }),
      crossDomain({ siteUrl }),
    ],
  });
  const http = httpRouter();
  authComponent.registerRoutes(http, () => auth, { cors: true });
  const request = async (
    path: string,
    method: "GET" | "POST" | "OPTIONS",
    headers: Record<string, string>,
    body?: unknown,
  ) => {
    const route = http.lookup(path.split("?")[0], method);
    if (!route) throw new Error("Missing auth route");
    const handler = route[0] as unknown as {
      _handler: (ctx: unknown, request: Request) => Promise<Response>;
    };
    return handler._handler(
      {},
      new Request(`${BACKEND}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  };
  const signIn = (origin = siteUrl, declaredOrigin = origin) =>
    request(
      "/api/auth/sign-in/notorganic",
      "POST",
      {
        "content-type": "application/json",
        origin,
        "better-auth-cookie": "",
      },
      {
        code: "synthetic-code",
        verifier: "a".repeat(43),
        origin: declaredOrigin,
      },
    );
  const session = (response: Response, origin = siteUrl) => {
    const header = response.headers.get("set-better-auth-cookie") ?? "";
    const cookies = [...parseSetCookieHeader(header)]
      .map(([key, value]) => `${key}=${value.value}`)
      .join("; ");
    return request("/api/auth/get-session?disableCookieCache=true", "GET", {
      origin,
      "better-auth-cookie": cookies,
    });
  };
  return {
    request,
    signIn,
    session,
    links,
    update: (account: VerifiedNotOrganicAccount) => {
      verified = account;
    },
    redemptions: () => redemptionCount,
  };
}

describe("Not Organic HTTP sign-in and session transport", () => {
  test("registered routes allow both production origins and expose the session cookie header", async () => {
    const t = fixture();
    for (const origin of ["https://twyne.love", "https://www.twyne.love"]) {
      const preflight = await t.request(
        "/api/auth/sign-in/notorganic",
        "OPTIONS",
        {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,better-auth-cookie",
        },
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      expect(
        preflight.headers.get("access-control-allow-headers")?.toLowerCase(),
      ).toContain("better-auth-cookie");
      expect(
        preflight.headers.get("access-control-expose-headers")?.toLowerCase(),
      ).toContain("set-better-auth-cookie");

      const response = await t.signIn(origin);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(
        response.headers
          .get("set-better-auth-cookie")
          ?.includes(".session_token="),
      ).toBe(true);
      const issued = await response.json();
      const refreshed = await t.session(response, origin);
      expect(refreshed.status).toBe(200);
      const confirmed = await refreshed.json();
      expect(confirmed.user.id).toBe(issued.user.id);
      expect(confirmed.session.userId).toBe(issued.user.id);
      expect(confirmed.user.name).toBe("Synthetic Writer");
      expect(confirmed.user.image).toBe(
        "https://images.example.test/synthetic.png",
      );
    }
    expect(t.links).toHaveLength(2);
    expect(t.links[0].did).toBe(DID);
  });

  test("configured loopback aliases share only the same protocol and port", async () => {
    const t = fixture("http://localhost:5173");
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ]) {
      const response = await t.request(
        "/api/auth/sign-in/notorganic",
        "OPTIONS",
        {
          origin,
          "access-control-request-method": "POST",
        },
      );
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
    for (const origin of [
      "http://localhost:5174",
      "https://localhost:5173",
      "https://evil.example",
    ]) {
      const response = await t.request(
        "/api/auth/sign-in/notorganic",
        "OPTIONS",
        {
          origin,
          "access-control-request-method": "POST",
        },
      );
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
    }
  });

  test("rejects mismatched request/PKCE origins before redeeming a one-time code", async () => {
    const t = fixture();
    for (const origin of [
      "https://evil.example",
      "https://www.twyne.love",
      "null",
    ]) {
      expect((await t.signIn(origin, "https://twyne.love")).status).toBe(403);
    }
    expect(t.redemptions()).toBe(0);
  });

  test("does not accept URL paths as the submitted client origin", async () => {
    const t = fixture();
    for (const origin of ["https://twyne.love/path", "invalid-origin"]) {
      expect((await t.signIn("https://twyne.love", origin)).status).toBe(400);
    }
    expect(t.redemptions()).toBe(0);
  });

  test("updates the verified name/avatar on the same account and supports avatar removal", async () => {
    const t = fixture();
    const first = await t.signIn();
    const initial = await first.json();
    t.update({
      did: DID,
      sessionVersion: 4,
      handle: "synthetic.test",
      displayName: "Updated Synthetic Writer",
      avatarUrl: null,
    });
    const response = await t.signIn();
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.user.id).toBe(initial.user.id);
    const confirmed = await (await t.session(response)).json();
    expect(confirmed.user.name).toBe("Updated Synthetic Writer");
    expect(confirmed.user.image).toBeNull();
    t.update({ did: DID, sessionVersion: 4 });
    const withoutProfile = await t.signIn();
    expect((await withoutProfile.json()).user.name).toBe(
      "Updated Synthetic Writer",
    );
  });

  test("configured trusted loopback origins expand to exact aliases and reject wildcard configuration", () => {
    expect(
      trustedOrigins("https://twyne.love", "http://localhost:5173"),
    ).toEqual([
      "https://twyne.love",
      "https://www.twyne.love",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ]);
    expect(() =>
      trustedOrigins("https://twyne.love", "https://*.twyne.love"),
    ).toThrow();
  });
});
