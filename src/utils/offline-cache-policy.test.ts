import { describe, expect, test } from "bun:test";
import {
  canStorePublicResponse,
  isCacheableStaticUrl,
  offlineShellPath,
  shouldCacheStaticRequest,
} from "./offline-cache-policy";

const ORIGIN = "https://twyne.example";

describe("offline application shells", () => {
  test("recognises writing routes with or without their trailing slash", () => {
    expect(offlineShellPath("/editor")).toBe("/editor/");
    expect(offlineShellPath("/editor/")).toBe("/editor/");
    expect(offlineShellPath("/dossier/create/")).toBe("/dossier/create/");
  });

  test("never treats public, auth, API, or loader routes as an offline shell", () => {
    expect(offlineShellPath("/@alice/draft/")).toBeUndefined();
    expect(offlineShellPath("/auth/callback/")).toBeUndefined();
    expect(offlineShellPath("/api/tinker/models/")).toBeUndefined();
    expect(
      offlineShellPath("/editor/q-loader-private.hash.json"),
    ).toBeUndefined();
  });
});

describe("offline static asset policy", () => {
  test("allows only same-origin build and public asset URLs", () => {
    expect(
      isCacheableStaticUrl(new URL("/build/q-abc.js", ORIGIN), ORIGIN),
    ).toBe(true);
    expect(
      isCacheableStaticUrl(new URL("/assets/editor.css", ORIGIN), ORIGIN),
    ).toBe(true);
    expect(
      isCacheableStaticUrl(new URL("/manifest.json", ORIGIN), ORIGIN),
    ).toBe(true);
    expect(
      isCacheableStaticUrl(new URL("https://cdn.example/font.woff2"), ORIGIN),
    ).toBe(false);
    expect(
      isCacheableStaticUrl(new URL("/api/image/private", ORIGIN), ORIGIN),
    ).toBe(false);
  });

  test("rejects authenticated, ranged, and Qwik loader requests", () => {
    const sensitiveHeaders: Array<Record<string, string>> = [
      { Authorization: "Bearer secret" },
      { Range: "bytes=0-20" },
      { "X-Qwik-fullpath": "/editor/" },
      { "X-Qwik-route-path": "/editor/" },
    ];
    for (const headers of sensitiveHeaders) {
      const request = new Request(`${ORIGIN}/build/q-abc.js`, { headers });
      expect(
        shouldCacheStaticRequest(request, new URL(request.url), ORIGIN),
      ).toBe(false);
    }
  });

  test("rejects mutations even when their URL resembles a static asset", () => {
    const request = new Request(`${ORIGIN}/assets/upload.png`, {
      method: "POST",
      body: "private bytes",
    });
    expect(
      shouldCacheStaticRequest(request, new URL(request.url), ORIGIN),
    ).toBe(false);
  });
});

describe("public response policy", () => {
  test("stores an ordinary public response", () => {
    expect(
      canStorePublicResponse(
        new Response("asset", {
          headers: { "Cache-Control": "public, max-age=31536000" },
        }),
      ),
    ).toBe(true);
  });

  test("rejects private and explicitly uncacheable responses", () => {
    for (const cacheControl of ["private", "no-store", "max-age=0, private"]) {
      expect(
        canStorePublicResponse(
          new Response("private", {
            headers: { "Cache-Control": cacheControl },
          }),
        ),
      ).toBe(false);
    }
  });

  test("rejects cookie-varying, authorised, partial, and failed responses", () => {
    expect(
      canStorePublicResponse(
        new Response("private", { headers: { Vary: "Accept, Cookie" } }),
      ),
    ).toBe(false);
    expect(
      canStorePublicResponse(
        new Response("private", { headers: { Vary: "Authorization" } }),
      ),
    ).toBe(false);
    expect(
      canStorePublicResponse(
        new Response("partial", {
          status: 206,
          headers: { "Content-Range": "bytes 0-6/20" },
        }),
      ),
    ).toBe(false);
    expect(
      canStorePublicResponse(new Response("missing", { status: 404 })),
    ).toBe(false);
  });
});
