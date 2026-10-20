import { describe, expect, test } from "bun:test";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { redirectCanonicalHost } from "../scripts/canonical-host.mjs";

describe("canonical host redirect", () => {
  test("redirects www requests before serving content, preserving paths and queries", async () => {
    const server = createServer((req, res) => {
      if (redirectCanonicalHost(req, res)) return;
      res.end("router response");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;

    async function send(host: string, path: string, method = "GET") {
      return new Promise<{ status: number; location?: string; body: string }>(
        (resolve, reject) => {
          const req = request(
            { hostname: "127.0.0.1", port, path, method, headers: { host } },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () =>
                resolve({
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
    }

    try {
      for (const method of ["GET", "HEAD"]) {
        expect(
          await send("www.twyne.love", "/docs/?utm_source=google", method),
        ).toEqual({
          status: 301,
          location: "https://twyne.love/docs/?utm_source=google",
          body: "",
        });
      }
      expect((await send("WWW.TWYNE.LOVE:443", "/")).location).toBe(
        "https://twyne.love/",
      );
      expect(
        (await send("www.twyne.love", "//example.com/path")).location,
      ).toBe("https://twyne.love/path");
      for (const host of [
        "twyne.love",
        "localhost",
        "preview.example",
        "www.twyne.love.evil.example",
      ]) {
        expect(await send(host, "/docs/")).toEqual({
          status: 200,
          location: undefined,
          body: "router response",
        });
      }
      // Authentication callbacks and mutations retain their original origin.
      expect(
        (await send("www.twyne.love", "/auth/callback/", "POST")).status,
      ).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
