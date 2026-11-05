import { expect, test } from "bun:test";
import { rejectMissingBuildAsset } from "../scripts/static-miss.mjs";

test("missing chunks and assets return a plain uncacheable 404 without SSR or redirects", () => {
  for (const url of [
    "/build/q-old.js",
    "/assets/old.wasm?version=1",
    "/assets/old.wasm/",
  ]) {
    let status = 0;
    let headers: Record<string, string> = {};
    let body: string | undefined;
    expect(
      rejectMissingBuildAsset(
        { method: "GET", url },
        {
          writeHead(code: number, values: Record<string, string>) {
            status = code;
            headers = values;
          },
          end(value?: string) {
            body = value;
          },
        },
      ),
    ).toBe(true);
    expect(status).toBe(404);
    expect(headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers.location).toBeUndefined();
    expect(body).toBe("Not Found");
  }
});

test("HEAD has no body; application routes and mutations still reach the router", () => {
  let body: string | undefined;
  const response = {
    writeHead() {},
    end(value?: string) {
      body = value;
    },
  };
  expect(
    rejectMissingBuildAsset(
      { method: "HEAD", url: "/build/q-old.js" },
      response,
    ),
  ).toBe(true);
  expect(body).toBeUndefined();
  expect(
    rejectMissingBuildAsset({ method: "GET", url: "/editor/" }, response),
  ).toBe(false);
  expect(
    rejectMissingBuildAsset(
      { method: "POST", url: "/assets/upload" },
      response,
    ),
  ).toBe(false);
});
