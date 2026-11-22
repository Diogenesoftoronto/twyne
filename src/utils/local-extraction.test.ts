import { afterEach, expect, mock, test } from "bun:test";
import { askLocalExtraction } from "./local-extraction";

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
  const result = await askLocalExtraction({
    state: "🌧️ Rain came early that night. Rain returned.",
    fields: {
      theme: { type: "text" },
      fragments: { type: "list", items: "text" },
    },
  });
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
    "http://127.0.0.1:8081/v1/chat/completions",
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
});

test("refuses forecasts without dispatching or falling back", async () => {
  const fetch = mock(async () => {
    throw new Error("Unexpected call");
  });
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  expect(
    await askLocalExtraction({
      state: "Ten days.",
      fields: { prediction: { type: "forecast", horizon: 2 } },
    }),
  ).toMatchObject({ ok: false, transport: "local", error: "unsupported" });
  expect(fetch).not.toHaveBeenCalled();
});
