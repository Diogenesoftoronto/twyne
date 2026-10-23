import { describe, expect, test } from "bun:test";
import { validateExtractionAnswers } from "./extraction-validation";
import type { ExtractionRequest } from "./extraction";
import fixture from "./extraction-contract-v1.json";

describe("Clairic response contract v1", () => {
  for (const example of fixture.cases) {
    test(example.name, () => {
      const request = example.request as ExtractionRequest;
      const validate = () =>
        validateExtractionAnswers(request, example.answers);
      if (example.valid)
        expect<unknown>(validate()).toEqual(
          ("expectedAnswers" in example
            ? example.expectedAnswers
            : undefined) ?? example.answers,
        );
      else expect(validate).toThrow();
    });
  }
  test("non-finite estimates cannot enter forecasts", () => {
    const request: ExtractionRequest = {
      state: "x",
      fields: { x: { type: "estimate", min: 0, max: 10 } },
    };
    for (const bad of [NaN, Infinity, -Infinity])
      expect(() =>
        validateExtractionAnswers(request, {
          x: { type: "estimate", value: 5, median: 5, p10: bad, p90: 9 },
        }),
      ).toThrow();
  });
});

test("already-normalized UTF-16 spans retain their occurrence", () => {
  const request: ExtractionRequest = {
    state: "🪶🪶🪶AdaAda",
    fields: { x: { type: "text" } },
  };
  const answers = { x: { type: "text", value: "Ada", span: [6, 9] } };
  expect<unknown>(
    validateExtractionAnswers(request, answers, undefined, "utf16"),
  ).toEqual(answers);
});
