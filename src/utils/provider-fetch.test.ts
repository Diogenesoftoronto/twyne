import { afterEach, expect, test } from "bun:test";
import { providerFetch, usesProviderRelay } from "./provider-fetch";

test("remote providers share a relay while local models stay direct", () => {
  for (const url of [
    "https://api.minimax.io/v1/models",
    "https://api.anthropic.com/v1/messages",
    "https://my-provider.example/v1/responses",
  ]) {
    expect(usesProviderRelay(new URL(url), "https://twyne.love")).toBe(true);
  }
  for (const url of [
    "http://127.0.0.1:11434/v1/models",
    "https://localhost:11434",
    "https://192.168.1.2:1234",
    "https://[::1]:1234",
    "https://model.local",
    "https://model.ts.net",
    "https://twyne.love/api/tinker/models",
  ]) {
    expect(usesProviderRelay(new URL(url), "https://twyne.love")).toBe(false);
  }
});

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  "location",
);
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, descriptor] of [
    ["window", originalWindow],
    ["location", originalLocation],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});
test("keeps target and credentials out of the relay URL and preserves request bodies", async () => {
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: new URL("https://twyne.love/settings/"),
    configurable: true,
  });
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({ data: [] });
  }) as typeof fetch;
  await providerFetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=test-key",
  );
  await providerFetch(
    new Request("https://custom.example/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "test-key" },
      body: '{"model":"test"}',
    }),
  );
  expect(requests[0].url).toBe("https://twyne.love/api/provider/");
  expect(requests[0].headers.get("x-twyne-provider-method")).toBe("GET");
  expect(requests[0].headers.get("x-twyne-provider-url")).toContain(
    "?key=test-key",
  );
  expect(requests[1].headers.get("x-api-key")).toBe("test-key");
  expect(await requests[1].json()).toEqual({ model: "test" });
});
