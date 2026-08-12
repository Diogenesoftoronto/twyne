import { afterEach, describe, expect, test } from "bun:test";
import type { AiProviderConfig } from "../types";
import { testProvider } from "./ai-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const provider: AiProviderConfig = {
  id: "provider-1",
  name: "Provider",
  type: "openai",
  apiKey: "secret",
  defaultModel: "model-a",
};

describe("provider validation", () => {
  test("validates for free and returns the endpoint model inventory", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await expect(testProvider(provider)).resolves.toMatchObject({
      ok: true,
      modelCount: 2,
      models: ["model-a", "model-b"],
    });
  });

  test("does not fall back to a billed generation when models are unavailable", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof fetch;

    await expect(testProvider(provider)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "cannot validate it without making a billed",
      ),
    });
  });

  test("surfaces rejected credentials precisely", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 401 })) as unknown as typeof fetch;

    await expect(testProvider(provider)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("rejected this API key (401)"),
    });
  });
});
