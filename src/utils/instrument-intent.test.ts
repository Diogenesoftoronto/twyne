import { describe, expect, test } from "bun:test";
import {
  parseInstrumentIntent,
  buildInstrumentIntentRequest,
  readInstrumentIntentLabels,
  classifyInstrumentIntent,
  confirmInstrumentIntent,
  INTENT_LABELS,
} from "./instrument-intent";
function answers(keys: string[], option = 0): Record<string, unknown> {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        type: "choice",
        choice: INTENT_LABELS[option],
        confidence: 0.8,
        probabilities: Object.fromEntries(
          INTENT_LABELS.map((label, index) => [
            label,
            index === option ? 0.8 : 0.05,
          ]),
        ),
      },
    ]),
  );
}
describe("inspectable task intent", () => {
  test("code retains exact quote/date/word-limit offsets including Unicode", () => {
    const text =
      "Keep “the river returns” intact; finish by October 9, 2026 in at most 500 words.";
    const parsed = parseInstrumentIntent(text);
    expect(parsed.tokens.map((token) => token.kind)).toEqual([
      "quote",
      "date",
      "word-limit",
    ]);
    for (const token of parsed.tokens)
      expect(text.slice(token.from, token.to)).toBe(token.text);
    expect(parsed.tokens[0].value).toBe("the river returns");
    expect(parsed.tokens[1].value).toBe("2026-10-09");
    expect(parsed.tokens[2].limits).toEqual({ max: 500 });
  });
  test("word-count ranges and inequality boundaries are exact; approximate targets stay marked", () => {
    const cases = [
      ["under 500 words", { max: 499 }],
      ["more than 200 words", { min: 201 }],
      ["at least 200 words", { min: 200 }],
      ["exactly 1,000 words", { min: 1000, max: 1000 }],
      ["exactly 1,000,000 words", { min: 1000000, max: 1000000 }],
      ["between 200 and 300 words", { min: 200, max: 300 }],
      ["200–300 words", { min: 200, max: 300 }],
      ["about 500 words", { min: 500, max: 500, approximate: true }],
    ] as const;
    for (const [text, limits] of cases)
      expect(parseInstrumentIntent(text).tokens[0].limits).toEqual(limits);
  });
  test("invalid dates and reversed ranges are visible for review instead of normalized silently", () => {
    expect(
      parseInstrumentIntent("By 2026-02-30, use 300-200 words.").tokens.map(
        (token) => token.valid,
      ),
    ).toEqual([false, false]);
    expect(parseInstrumentIntent("By 2028-02-29.").tokens[0]).toMatchObject({
      valid: true,
      value: "2028-02-29",
    });
  });
  test("quoted numeric instructions do not become independently executable constraints", () => {
    const parsed = parseInstrumentIntent(
      'Discuss "under 100 words by 2026-10-09" without changing it.',
    );
    expect(parsed.tokens).toHaveLength(1);
    expect(parsed.tokens[0].kind).toBe("quote");
    expect(
      parseInstrumentIntent("Don't rewrite this author's words.").tokens,
    ).toHaveLength(0);
  });
  test("Jev labels can only refer to exact code-generated spans", () => {
    const parsed = parseInstrumentIntent(
      "Summarize the findings. Use only my account sources.",
    );
    const request = buildInstrumentIntentRequest(parsed);
    expect(Object.keys(request.questions)).toHaveLength(2);
    expect(request.state.span0).toBe("Summarize the findings.");
    const labels = readInstrumentIntentLabels(
      parsed,
      answers(Object.keys(request.questions)),
    );
    for (const label of labels)
      expect(parsed.text.slice(label.from, label.to)).toBe(label.text);
    expect(labels[0]).toMatchObject({
      source: "jev",
      label: "operation",
      probability: 0.8,
    });
    expect(labels[0]).not.toHaveProperty("execute");
    expect(labels[0]).not.toHaveProperty("sourceId");
  });
  test("soft interpretations require explicit confirmation against identical instruction and selected scope", () => {
    const parsed = parseInstrumentIntent("Use the selected account resources.");
    const labels = readInstrumentIntentLabels(parsed, answers(["intent0"], 1));
    expect(
      confirmInstrumentIntent(
        parsed,
        "scope1",
        labels,
        `${parsed.text} changed`,
        "scope1",
      ),
    ).toBeNull();
    expect(
      confirmInstrumentIntent(parsed, "scope1", labels, parsed.text, "scope2"),
    ).toBeNull();
    expect(
      confirmInstrumentIntent(
        parsed,
        "scope1",
        [{ ...labels[0], from: 2 }],
        parsed.text,
        "scope1",
      ),
    ).toBeNull();
    const confirmed = confirmInstrumentIntent(
      parsed,
      "scope1",
      labels,
      parsed.text,
      "scope1",
    );
    expect(confirmed).toMatchObject({
      fingerprint: parsed.fingerprint,
      contextKey: "scope1",
    });
    expect(confirmed).not.toHaveProperty("operation");
    expect(confirmed).not.toHaveProperty("sources");
  });
  test("malformed or partial distributions cannot become model labels", () => {
    const parsed = parseInstrumentIntent("Review this claim.");
    for (const raw of [
      {
        type: "choice",
        choice: INTENT_LABELS[0],
        confidence: 0.8,
        probabilities: { [INTENT_LABELS[0]]: 1 },
      },
      { type: "noul", noul: 0.8 },
      {
        type: "choice",
        choice: "Execute now",
        confidence: 1,
        probabilities: {},
      },
    ])
      expect(readInstrumentIntentLabels(parsed, { intent0: raw })).toEqual([]);
  });
  test("late labels are discarded after an instruction or account/scope change; no auto retry", async () => {
    const parsed = parseInstrumentIntent("Review this claim.");
    let current = true,
      calls = 0;
    expect(
      await classifyInstrumentIntent(
        parsed,
        "scope",
        async (request) => {
          calls++;
          current = false;
          return { ok: true, answers: answers(Object.keys(request.questions)) };
        },
        () => current,
      ),
    ).toBeNull();
    expect(calls).toBe(1);
    expect(
      await classifyInstrumentIntent(
        parsed,
        "scope",
        async () => {
          calls++;
          throw new Error("Unavailable");
        },
        () => true,
      ),
    ).toBeNull();
    expect(calls).toBe(2);
  });
  test("editing preserves native text exactly; parser does not insert or rewrite tokens", () => {
    const text = "  200 words\n“a quote” — by 2026-10-09\n";
    const parsed = parseInstrumentIntent(text);
    expect(parsed.text).toBe(text);
    const changed = parseInstrumentIntent(text.replace("200", "201"));
    expect(changed.fingerprint).not.toBe(parsed.fingerprint);
    expect(parsed.text).toBe(text);
  });
});
