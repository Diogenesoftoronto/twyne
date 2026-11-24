import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import {
  APP_ROUTE_ROOTS,
  CUSTOM_DOMAIN_HEADER,
  PASSTHROUGH_ROOTS,
  createHostResolver,
  hostFromHeader,
  isTwyneHost,
  planCustomDomainRequest,
  routeCustomDomain,
} from "../scripts/custom-domain-routing.mjs";

describe("Twyne host classification", () => {
  test("Twyne, Railway, local and IP hosts serve the app", () => {
    for (const host of [
      "twyne.love",
      "www.twyne.love",
      "TWYNE.LOVE:443",
      "anything.twyne.love",
      "twyne-production.up.railway.app",
      "healthcheck.railway.app",
      "twyne.railway.internal",
      "localhost:5173",
      "app.localhost",
      "127.0.0.1:3000",
      "[::1]:3000",
      "",
    ]) {
      expect(isTwyneHost(host)).toBe(true);
    }
    expect(isTwyneHost("preview.example.dev", ["preview.example.dev"])).toBe(
      true,
    );
  });

  test("everything else is a candidate custom domain", () => {
    for (const host of [
      "myfrens.us",
      "pages.myfrens.us",
      "twyne.love.example.com",
      "nottwyne.love",
    ]) {
      expect(isTwyneHost(host)).toBe(false);
    }
  });

  test("Host headers lose ports and trailing dots", () => {
    expect(hostFromHeader("Pages.MyFrens.us.:443")).toBe("pages.myfrens.us");
    expect(hostFromHeader(["a.example.com", "b.example.com"])).toBe(
      "a.example.com",
    );
    expect(hostFromHeader(undefined)).toBe("");
  });
});

describe("custom domain path plan", () => {
  const plan = (pathname: string, search = "") =>
    planCustomDomainRequest({ pathname, search, handle: "Mara" });

  test("the root and slugs map onto the writer's routes", () => {
    expect(plan("/")).toEqual({ action: "rewrite", path: "/mara/" });
    expect(plan("/on-salt/")).toEqual({
      action: "rewrite",
      path: "/mara/on-salt/",
    });
    expect(plan("/on-salt/", "?ref=x")).toEqual({
      action: "rewrite",
      path: "/mara/on-salt/?ref=x",
    });
    expect(plan("/q-data.json")).toEqual({
      action: "rewrite",
      path: "/mara/q-data.json",
    });
    expect(plan("/on-salt/q-data.json")).toEqual({
      action: "rewrite",
      path: "/mara/on-salt/q-data.json",
    });
  });

  test("paths already under the handle are not prefixed twice", () => {
    expect(plan("/mara/")).toEqual({ action: "pass" });
    expect(plan("/mara/on-salt/")).toEqual({ action: "pass" });
    expect(plan("/MARA/on-salt/")).toEqual({ action: "pass" });
  });

  test("build output, assets and root files pass through", () => {
    for (const path of [
      "/build/q-abc123.js",
      "/assets/griffin-mark.svg",
      "/og/mara/on-salt",
      "/.well-known/site.standard.publication/at/x/y",
      "/favicon.ico",
      "/manifest.json",
      "/service-worker.js",
      "/robots.txt",
    ]) {
      expect(plan(path)).toEqual({ action: "pass" });
    }
  });

  test("app routes redirect to Twyne, keeping the path and query", () => {
    expect(plan("/signin/", "?returnTo=%2F")).toEqual({
      action: "redirect",
      status: 302,
      location: "https://twyne.love/signin/?returnTo=%2F",
    });
    expect(plan("/editor/")).toMatchObject({
      action: "redirect",
      location: "https://twyne.love/editor/",
    });
    expect(plan("/api/auth/session")).toMatchObject({ action: "redirect" });
    expect(
      planCustomDomainRequest({
        pathname: "/settings/",
        handle: "mara",
        twyneOrigin: "https://staging.twyne.love",
      }),
    ).toMatchObject({ location: "https://staging.twyne.love/settings/" });
  });

  test("a missing trailing slash is added on the custom domain itself", () => {
    expect(plan("/on-salt", "?a=1")).toEqual({
      action: "redirect",
      status: 301,
      location: "/on-salt/?a=1",
    });
  });

  test("every route directory is classified", () => {
    const roots = readdirSync(new URL("../src/routes/", import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const allowed = new Set([
      "[handle]",
      "[...standardSiteVerification]",
      "og",
    ]);
    const unclassified = roots.filter(
      (root) =>
        // Root files such as robots.txt pass through by the root-file rule.
        !root.includes(".") &&
        !allowed.has(root) &&
        !APP_ROUTE_ROOTS.has(root) &&
        !PASSTHROUGH_ROOTS.has(root),
    );
    expect(unclassified).toEqual([]);
  });
});

describe("host resolver cache", () => {
  test("caches answers, negative ones too, and shares in-flight lookups", async () => {
    let clock = 0;
    const calls: string[] = [];
    const resolve = createHostResolver({
      lookup: async (host) => {
        calls.push(host);
        return host === "myfrens.us" ? "mara" : null;
      },
      ttlMs: 1_000,
      negativeTtlMs: 100,
      now: () => clock,
    });
    const [a, b] = await Promise.all([
      resolve("myfrens.us"),
      resolve("myfrens.us"),
    ]);
    expect([a, b]).toEqual(["mara", "mara"]);
    expect(await resolve("unknown.example")).toBeNull();
    expect(await resolve("unknown.example")).toBeNull();
    expect(calls).toEqual(["myfrens.us", "unknown.example"]);
    clock = 500;
    await resolve("unknown.example");
    await resolve("myfrens.us");
    expect(calls).toEqual(["myfrens.us", "unknown.example", "unknown.example"]);
  });

  test("serves an expired answer when the lookup fails", async () => {
    let clock = 0;
    let fail = false;
    const resolve = createHostResolver({
      lookup: async () => {
        if (fail) throw new Error("down");
        return "mara";
      },
      ttlMs: 10,
      now: () => clock,
    });
    expect(await resolve("myfrens.us")).toBe("mara");
    fail = true;
    clock = 100;
    expect(await resolve("myfrens.us")).toBe("mara");
    expect(resolve("other.example")).rejects.toThrow("down");
  });

  test("stays bounded", async () => {
    const calls: string[] = [];
    const resolve = createHostResolver({
      lookup: async (host) => {
        calls.push(host);
        return null;
      },
      maxEntries: 2,
    });
    await resolve("a.example");
    await resolve("b.example");
    await resolve("c.example");
    await resolve("a.example");
    expect(calls).toEqual(["a.example", "b.example", "c.example", "a.example"]);
  });
});

describe("custom domain request hook", () => {
  async function withServer<T>(
    resolve: ((host: string) => Promise<string | null>) | null,
    run: (
      send: (
        host: string,
        path: string,
        headers?: Record<string, string>,
      ) => Promise<{ status: number; location?: string; body: string }>,
    ) => Promise<T>,
  ) {
    const server = createServer(async (req, res) => {
      if (await routeCustomDomain(req, res, { resolve })) return;
      res.end(
        JSON.stringify({
          url: req.url,
          domain: req.headers[CUSTOM_DOMAIN_HEADER] ?? null,
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;
    const send = (host: string, path: string, headers = {}) =>
      new Promise<{ status: number; location?: string; body: string }>(
        (done, reject) => {
          const req = request(
            {
              hostname: "127.0.0.1",
              port,
              path,
              headers: { host, ...headers },
            },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () =>
                done({
                  status: res.statusCode!,
                  location: res.headers.location,
                  body,
                }),
              );
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
    try {
      return await run(send);
    } finally {
      await new Promise((done) => server.close(done));
    }
  }

  const resolve = async (host: string) =>
    host === "myfrens.us" || host === "pages.myfrens.us" ? "mara" : null;

  test("rewrites the writer's domain and marks it for SSR", async () => {
    await withServer(resolve, async (send) => {
      expect(JSON.parse((await send("myfrens.us", "/")).body)).toEqual({
        url: "/mara/",
        domain: "myfrens.us",
      });
      expect(
        JSON.parse((await send("pages.myfrens.us:443", "/on-salt/")).body),
      ).toEqual({ url: "/mara/on-salt/", domain: "pages.myfrens.us" });
    });
  });

  test("unknown hosts get a plain 404, and Twyne hosts are untouched", async () => {
    await withServer(resolve, async (send) => {
      const unknown = await send("stranger.example", "/");
      expect(unknown.status).toBe(404);
      expect(unknown.body).toBe("Not found\n");
      expect(JSON.parse((await send("twyne.love", "/mara/")).body)).toEqual({
        url: "/mara/",
        domain: null,
      });
    });
  });

  test("an inbound custom-domain header is never trusted", async () => {
    await withServer(resolve, async (send) => {
      const res = await send("twyne.love", "/", {
        [CUSTOM_DOMAIN_HEADER]: "evil.example",
      });
      expect(JSON.parse(res.body).domain).toBeNull();
    });
  });

  test("sign-in redirects to Twyne", async () => {
    await withServer(resolve, async (send) => {
      const res = await send("myfrens.us", "/signin/");
      expect(res.status).toBe(302);
      expect(res.location).toBe("https://twyne.love/signin/");
    });
  });

  test("lookup failures answer 503, and no resolver means 404", async () => {
    await withServer(
      async () => {
        throw new Error("convex down");
      },
      async (send) => {
        expect((await send("myfrens.us", "/")).status).toBe(503);
      },
    );
    await withServer(null, async (send) => {
      expect((await send("myfrens.us", "/")).status).toBe(404);
    });
  });
});
