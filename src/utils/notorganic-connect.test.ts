import { describe, expect, test } from "bun:test";
import {
  beginNotOrganicSignIn,
  completeNotOrganicSignIn,
  NOTORGANIC_SIGN_IN_ATTEMPT,
  readNotOrganicCallback,
} from "./notorganic-connect";
import { redeemProviderLink } from "../../convex/lib/providerLink";
import { redeemNotOrganicSignIn } from "../../convex/lib/notorganicSignIn";

describe("Not Organic sign-in", () => {
  test("preserves each exact production or local origin throughout PKCE", async () => {
    for (const origin of [
      "https://twyne.love",
      "https://www.twyne.love",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ]) {
      const { attempt, url } = await beginNotOrganicSignIn(
        origin,
        "/library/?view=drafts",
      );
      const authorize = new URL(url);
      expect(authorize.searchParams.get("prompt")).toBe("select_account");
      expect(authorize.searchParams.get("client_id")).toBe(origin);
      expect(authorize.searchParams.get("redirect_uri")).toBe(
        `${origin}/auth/notorganic/`,
      );
      expect(attempt.origin).toBe(origin);
      expect(attempt.returnTo).toBe("/library/?view=drafts");
    }
  });

  test("rejects return paths interpreted by browsers as external redirects", async () => {
    for (const path of [
      "//evil.example/",
      "/\\evil.example/",
      "/\n/evil.example/",
      "https://evil.example/",
    ]) {
      const { attempt } = await beginNotOrganicSignIn(
        "https://twyne.love",
        path,
      );
      expect(attempt.returnTo).toBe("/");
    }
  });
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

  test("preserves profile fields only after server-side account proof succeeds", async () => {
    const requests: Request[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json(
        request.url.endsWith("/token")
          ? { access_token: token() }
          : {
              account: {
                did: "did:plc:writer",
                handle: "writer.test",
                displayName: "  Synthetic Writer  ",
                avatarUrl: "https://images.example.test/writer.png",
              },
            },
      );
    }) as typeof fetch;
    expect(
      await redeemNotOrganicSignIn(
        { code: "one-time", verifier: "a".repeat(43) },
        "https://www.twyne.love",
        "https://api.notorganic.info",
        fake,
      ),
    ).toEqual({
      did: "did:plc:writer",
      sessionVersion: 3,
      handle: "writer.test",
      displayName: "Synthetic Writer",
      avatarUrl: "https://images.example.test/writer.png",
    });
    expect(await requests[0].json()).toMatchObject({
      client_id: "https://www.twyne.love",
      redirect_uri: "https://www.twyne.love/auth/notorganic/",
    });
    expect(requests).toHaveLength(2);
  });

  test("drops unsafe avatars and rejects spoofed account profiles", async () => {
    for (const avatarUrl of [
      "javascript:alert(1)",
      "http://images.example.test/avatar.png",
      "https://user:password@images.example.test/avatar.png",
    ]) {
      const fake = (async (input: RequestInfo | URL) =>
        Response.json(
          String(input).endsWith("/token")
            ? { access_token: token() }
            : { account: { did: "did:plc:writer", avatarUrl } },
        )) as typeof fetch;
      const account = await redeemNotOrganicSignIn(
        { code: "one-time", verifier: "a".repeat(43) },
        "https://twyne.love",
        "https://api.notorganic.info",
        fake,
      );
      expect(account.avatarUrl).toBeUndefined();
    }
    const spoofed = (async (input: RequestInfo | URL) =>
      Response.json(
        String(input).endsWith("/token")
          ? { access_token: token() }
          : {
              account: { did: "did:plc:other", displayName: "Spoofed Writer" },
            },
      )) as typeof fetch;
    await expect(
      redeemNotOrganicSignIn(
        { code: "one-time", verifier: "a".repeat(43) },
        "https://twyne.love",
        "https://api.notorganic.info",
        spoofed,
      ),
    ).rejects.toThrow();
  });

  async function completionFixture(sessionResult: {
    data?: unknown;
    error?: unknown;
  }) {
    const { attempt } = await beginNotOrganicSignIn(
      "https://twyne.love",
      "/library/",
    );
    let saved: string | null = JSON.stringify(attempt);
    const calls: string[] = [];
    const storage = {
      getItem(key: string) {
        expect(key).toBe(NOTORGANIC_SIGN_IN_ATTEMPT);
        return saved;
      },
      removeItem(key: string) {
        expect(key).toBe(NOTORGANIC_SIGN_IN_ATTEMPT);
        saved = null;
      },
    };
    const client = {
      async $fetch(path: string, options: { method: string; body: unknown }) {
        calls.push(path);
        expect(options.body).toEqual({
          code: "synthetic-code",
          verifier: attempt.verifier,
          origin: attempt.origin,
        });
        return { data: { user: { id: "synthetic-user" } }, error: null };
      },
      async getSession(options: { query: { disableCookieCache: boolean } }) {
        calls.push("getSession");
        expect(options.query.disableCookieCache).toBe(true);
        return sessionResult;
      },
    };
    return {
      url: new URL(
        `https://twyne.love/auth/notorganic/?code=synthetic-code&state=${attempt.state}`,
      ),
      storage,
      client,
      calls,
    };
  }

  test("returns the destination only after the newly issued session is confirmed", async () => {
    const fixture = await completionFixture({
      data: {
        session: { id: "synthetic-session", userId: "synthetic-user" },
        user: { id: "synthetic-user" },
      },
      error: null,
    });
    expect(await completeNotOrganicSignIn(fixture.url, fixture)).toBe(
      "/library/",
    );
    expect(fixture.calls).toEqual(["/sign-in/notorganic", "getSession"]);
    await expect(
      completeNotOrganicSignIn(fixture.url, fixture),
    ).rejects.toThrow("Start signing in again");
    expect(fixture.calls).toHaveLength(2);
  });

  test("does not finish after failed refresh, missing session or a stale user's session", async () => {
    for (const result of [
      { data: null, error: { status: 503 } },
      { data: null, error: { status: 401 } },
      { data: null, error: null },
      {
        data: { session: { userId: "old-user" }, user: { id: "old-user" } },
        error: null,
      },
      {
        data: {
          session: { userId: "old-user" },
          user: { id: "synthetic-user" },
        },
        error: null,
      },
    ]) {
      const fixture = await completionFixture(result);
      await expect(
        completeNotOrganicSignIn(fixture.url, fixture),
      ).rejects.toThrow("could not confirm your session");
    }
  });

  test("rejects invalid saved attempts before making redemption requests", async () => {
    for (const saved of ["null", "{}", "not-json"]) {
      let fetched = false;
      await expect(
        completeNotOrganicSignIn(
          new URL(
            "https://twyne.love/auth/notorganic/?code=synthetic-code&state=state",
          ),
          {
            storage: { getItem: () => saved, removeItem: () => {} },
            client: {
              $fetch: async () => {
                fetched = true;
                return {};
              },
              getSession: async () => ({}),
            },
          },
        ),
      ).rejects.toThrow();
      expect(fetched).toBe(false);
    }
  });
});
