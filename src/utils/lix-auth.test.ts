import { afterAll, expect, mock, test } from "bun:test";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const RELAY = "https://relay.example";
const originalWindow = globalThis.window;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();
const sent: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

import.meta.env.VITE_CONVEX_SITE_URL = RELAY;
mock.module("./auth-client", () => ({
  authClient: { getCookie: () => "better-auth.session_token=s" },
}));
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ input, init });
      return new Response(null);
    },
  },
});

const { installLixAuthInterceptor } = await import("./lix-auth");
installLixAuthInterceptor();

afterAll(() => {
  mock.restore();
  if (originalWindow === undefined)
    Reflect.deleteProperty(globalThis, "window");
  else
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  releaseBrowserGlobalsLock();
});

test("a sync request keeps its JSON type when the session is added", async () => {
  // The Lix SDK hands fetch a whole Request carrying its own headers.
  await window.fetch(
    new Request(`${RELAY}/lsp/pull-v1`, {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    }),
  );
  const headers = new Headers(sent.at(-1)!.init?.headers);
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("Better-Auth-Cookie")).toBe("better-auth.session_token=s");
});

test("requests to anywhere else are left alone", async () => {
  await window.fetch("https://elsewhere.example/lsp/pull-v1");
  expect(sent.at(-1)!.init).toBeUndefined();
});
