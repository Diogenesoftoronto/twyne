import { describe, expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { askExtraction } from "./extraction-client";
import {
  forecastSteps,
  interval,
  type ExtractionAnswer,
  type ExtractionRequest,
} from "./extraction";

const request: ExtractionRequest = {
  state: "Ada arrived",
  fields: { name: { type: "text" } },
};
function client(action: () => Promise<unknown>): ConvexClient {
  return { action } as unknown as ConvexClient;
}
describe("extraction client", () => {
  test("signed out has a deterministic result", async () => {
    expect(await askExtraction(null, request)).toMatchObject({
      ok: false,
      error: "signed out",
    });
  });
  test("generic failures are not mislabeled as rate limits", async () => {
    const result = await askExtraction(
      client(async () => {
        throw new Error("private draft");
      }),
      request,
    );
    expect(result).toEqual({ ok: false, error: "provider" });
  });
  for (const [error, category] of [
    [{ name: "RateLimitError" }, "rate limited"],
    [{ name: "TimeoutError" }, "timeout"],
    [{ data: { code: "UNAUTHENTICATED" } }, "signed out"],
    [{ data: { code: "FORBIDDEN" } }, "unauthorized"],
  ] as const) {
    test(`classifies ${category}`, async () => {
      expect(
        await askExtraction(
          client(async () => {
            throw error;
          }),
          request,
        ),
      ).toEqual({ ok: false, error: category });
    });
  }
  test("rejects malformed successful action responses", async () => {
    const c = client(async () => ({
      ok: true,
      truncated: false,
      answers: { name: { type: "text", value: "Different", span: [0, 3] } },
    }));
    expect(await askExtraction(c, request)).toMatchObject({
      ok: false,
      error: "provider",
    });
  });
  test("preserves a validated success and adds latency", async () => {
    const response = {
      ok: true,
      truncated: false,
      answers: { name: { type: "text", value: "Ada", span: [0, 3] } },
    };
    expect(
      await askExtraction(
        client(async () => response),
        request,
      ),
    ).toMatchObject({ ...response, latencyMs: expect.any(Number) });
  });
});

test("numeric helpers reject NaN, reversed intervals and incomplete forecasts", () => {
  const good = { median: 5, p10: 2, p90: 8 };
  expect(interval({ ...good, p10: NaN } as ExtractionAnswer)).toBeNull();
  expect(interval({ ...good, p10: 9 } as ExtractionAnswer)).toBeNull();
  expect(
    forecastSteps({ steps: [good, { ...good, p90: 1 }] } as ExtractionAnswer),
  ).toEqual([]);
  expect(
    forecastSteps({
      median: [5, 6],
      p10: [2],
      p90: [8, 9],
    } as ExtractionAnswer),
  ).toEqual([]);
  expect(forecastSteps({ steps: [good, good] } as ExtractionAnswer)).toEqual([
    good,
    good,
  ]);
});
