import { afterEach, expect, mock, test } from "bun:test";
import { askLocalExtraction, localExtractionModel } from "./local-extraction";
import { DEFAULT_AI_SETTINGS, type AiProviderConfig } from "../types";

const provider = (
  id: string,
  model: string,
  baseUrl = "http://127.0.0.1:11434/v1",
): AiProviderConfig => ({
  id,
  name: id,
  type: "openai-compatible",
  apiKey: "",
  baseUrl,
  defaultModel: model,
});
const lfm = provider(
  "local-lfm",
  "LiquidAI/LFM3-1.7B",
  "http://127.0.0.1:8090/v1",
);
const local = localExtractionModel({
  ...DEFAULT_AI_SETTINGS,
  advancedMode: true,
  providers: [lfm],
})!;

test("prefers LFM3 and falls back to Gemma 4 E4B, then E2B", () => {
  const e4b = provider("gemma-4b", "gemma4:e4b");
  const e2b = provider("gemma-2b", "gemma-4-e2b-it");
  const choose = (...providers: AiProviderConfig[]) =>
    localExtractionModel({
      ...DEFAULT_AI_SETTINGS,
      advancedMode: true,
      providers,
    })?.model;
  expect(choose(e2b, e4b, lfm)).toBe(lfm.defaultModel);
  expect(choose(e2b, e4b)).toBe(e4b.defaultModel);
  expect(choose(e2b)).toBe(e2b.defaultModel);
  expect(
    choose(provider("remote", lfm.defaultModel, "https://example.com/v1")),
  ).toBeUndefined();
  expect(choose(provider("unlisted", "some-other-model"))).toBeUndefined();
  expect(choose({ ...lfm, apiMode: "responses" })).toBeUndefined();
  expect(
    localExtractionModel({ ...DEFAULT_AI_SETTINGS, providers: [lfm] }),
  ).toBeNull();
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("sends a single loopback request and grounds only unique exact quotes", async () => {
  const fetch = mock(async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              theme: "early",
              fragments: [
                "night",
                "not in the source",
                "Rain",
                "early",
                "night",
              ],
            }),
          },
        },
      ],
    }),
  );
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  const result = await askLocalExtraction(
    {
      state: "🌧️ Rain came early that night. Rain returned.",
      fields: {
        theme: { type: "text" },
        fragments: { type: "list", items: "text" },
      },
    },
    local,
  );
  expect(result).toMatchObject({
    ok: true,
    transport: "local",
    answers: {
      theme: { value: "early", span: [14, 19] },
      fragments: {
        value: ["early", "night"],
        spans: [
          [14, 19],
          [25, 30],
        ],
      },
    },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    new URL("http://127.0.0.1:8090/v1/chat/completions"),
    expect.objectContaining({
      redirect: "error",
      credentials: "omit",
      body: expect.stringContaining(lfm.defaultModel),
    }),
  );
  expect(fetch).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      body: expect.stringContaining(
        '"chat_template_kwargs":{"enable_thinking":false}',
      ),
    }),
  );
});

test("refuses forecasts without dispatching or falling back", async () => {
  const fetch = mock(async () => {
    throw new Error("Unexpected call");
  });
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  expect(
    await askLocalExtraction(
      {
        state: "Ten days.",
        fields: { prediction: { type: "forecast", horizon: 2 } },
      },
      local,
    ),
  ).toMatchObject({ ok: false, transport: "local", error: "unsupported" });
  expect(fetch).not.toHaveBeenCalled();
});
