import { describe, expect, test } from "bun:test";
import {
  buildQuoteTools,
  resolveDraftPassage,
  firstSubstantiveSentence,
} from "./agentTools";

/** Invoke the quote_passage tool's execute, bypassing the AI SDK call shape. */
async function callQuote(
  tools: ReturnType<typeof buildQuoteTools>["tools"],
  query: string,
): Promise<unknown> {
  const execute = (
    tools.quote_passage as unknown as {
      execute: (input: { query: string }, options: unknown) => Promise<unknown>;
    }
  ).execute;
  return execute({ query }, {});
}

const draft = [
  "The opening claims too much before the reader has evidence.",
  "The second paragraph finally gives the piece a spine.",
  "The closing sentence should stop before it explains itself twice.",
].join("\n\n");

describe("resolveDraftPassage", () => {
  test("returns the exact passage when present verbatim", () => {
    expect(
      resolveDraftPassage(
        "The second paragraph finally gives the piece a spine.",
        draft,
      ),
    ).toBe("The second paragraph finally gives the piece a spine.");
  });

  test("fuzzy-matches a passage with different punctuation/case", () => {
    expect(
      resolveDraftPassage(
        "the second paragraph finally gives the piece a spine",
        draft,
      ),
    ).toBe("The second paragraph finally gives the piece a spine.");
  });

  test("returns undefined for a passage the model invented", () => {
    expect(
      resolveDraftPassage("A sentence the model invented entirely.", draft),
    ).toBeUndefined();
  });

  test("returns undefined for too-short queries", () => {
    expect(resolveDraftPassage("too short", draft)).toBeUndefined();
  });
});

describe("buildQuoteTools", () => {
  test("records the first resolved passage as the anchor", async () => {
    const { tools, getAnchor } = buildQuoteTools(draft);
    const result = (await callQuote(
      tools,
      "the second paragraph finally gives the piece a spine",
    )) as { found: boolean; passage: string | null };

    expect(result.found).toBe(true);
    expect(result.passage).toBe(
      "The second paragraph finally gives the piece a spine.",
    );
    expect(getAnchor()).toBe(
      "The second paragraph finally gives the piece a spine.",
    );
  });

  test("reports not found and leaves the anchor empty for an invented quote", async () => {
    const { tools, getAnchor } = buildQuoteTools(draft);
    const result = (await callQuote(
      tools,
      "A sentence the model invented entirely.",
    )) as { found: boolean };

    expect(result.found).toBe(false);
    expect(getAnchor()).toBeUndefined();
  });
});

describe("firstSubstantiveSentence", () => {
  test("returns the first sentence with enough words", () => {
    expect(firstSubstantiveSentence(draft)).toBe(
      "The opening claims too much before the reader has evidence.",
    );
  });

  test("returns undefined for an empty draft", () => {
    expect(firstSubstantiveSentence("")).toBeUndefined();
  });
});
