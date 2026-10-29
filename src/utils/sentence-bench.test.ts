import { describe, expect, test } from "bun:test";
import {
  bindingKey,
  checkTrial,
  MAX_REVISION_OBSERVATIONS,
  parseRevisionReading,
  revisionEdits,
  revisionReadingRequest,
  sameBinding,
  sentenceAtSelection,
  sentenceWordDiff,
  type RevisionBinding,
} from "./sentence-bench";

const binding: RevisionBinding = {
  original: "She had not told her brother that the house was sold.",
  trial: "She had kept the sale from her brother.",
  before: "Mara learned about the sale that morning. ",
  after: " He was already packing for his visit.",
};
const answer = (observations: unknown[]) => JSON.stringify({ observations });
const apply = (original: string, trial: string) => {
  let out = original;
  for (const e of [...revisionEdits(original, trial)].reverse())
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
};

describe("word diff", () => {
  test("keeps every character of both sides", () => {
    const before = "The letter suggested he had meant to come back.";
    const after = "The letter proved he had meant to return.";
    const parts = sentenceWordDiff(before, after);
    expect(
      parts
        .filter((p) => p.kind !== "added")
        .map((p) => p.text)
        .join(""),
    ).toBe(before);
    expect(
      parts
        .filter((p) => p.kind !== "removed")
        .map((p) => p.text)
        .join(""),
    ).toBe(after);
  });
});

describe("source targeting", () => {
  const paragraph = "It rained. It rained. The roads closed.";

  test("names the sentence under a collapsed cursor by position", () => {
    const second = paragraph.indexOf("It rained.", 1);
    expect(
      sentenceAtSelection(paragraph, second + 3, second + 3),
    ).toMatchObject({
      ok: true,
      index: 1,
      span: { from: second, text: "It rained." },
    });
  });

  test("distinguishes duplicate sentences by where the selection is", () => {
    const first = sentenceAtSelection(paragraph, 0, 10);
    const second = sentenceAtSelection(paragraph, 11, 21);
    expect(first).toMatchObject({ ok: true, index: 0 });
    expect(second).toMatchObject({ ok: true, index: 1 });
  });

  test("a partial selection inside one sentence names that sentence", () => {
    const at = paragraph.indexOf("roads");
    expect(sentenceAtSelection(paragraph, at, at + 5)).toMatchObject({
      ok: true,
      index: 2,
    });
  });

  test("refuses a selection across sentences instead of narrowing it", () => {
    const result = sentenceAtSelection(paragraph, 3, paragraph.length);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain("3 sentences");
  });

  test("ignores whitespace at the edges of a selection", () => {
    expect(sentenceAtSelection(paragraph, 0, 11)).toMatchObject({
      ok: true,
      index: 0,
    });
  });
});

describe("trial limits", () => {
  test("allows fragments and several sentences; grammar is not a gate", () => {
    expect(checkTrial("  kept from him  ")).toEqual({
      ok: true,
      text: "kept from him",
    });
    expect(checkTrial("She kept it. He never asked.").ok).toBe(true);
  });
  test("refuses empty, oversize and multi-paragraph trials", () => {
    expect(checkTrial("   ").ok).toBe(false);
    expect(checkTrial("a".repeat(1201)).ok).toBe(false);
    expect(checkTrial("One.\nTwo.").ok).toBe(false);
  });
});

describe("revision edits", () => {
  test("replace only the changed words", () => {
    const original = "The letter suggested he had meant to come back.";
    const trial = "The letter proved he had meant to come back.";
    expect(revisionEdits(original, trial)).toEqual([
      { from: 11, to: 20, insert: "proved" },
    ]);
  });
  test("reproduce the trial exactly, including additions and cuts", () => {
    for (const [original, trial] of [
      [binding.original, binding.trial],
      [
        "Most residents would probably move.",
        "Most residents would move, they said. Few had looked.",
      ],
      ["A quiet room.", "quiet"],
      ["A quiet room.", "A quiet room."],
    ])
      expect(apply(original, trial)).toBe(trial);
  });
});

describe("reading the difference", () => {
  test("the request carries the exact texts and forbids rewriting and ranking", () => {
    const { system, prompt } = revisionReadingRequest(binding, {
      audience: "General readers",
    });
    expect(system).toContain("never rewrite");
    expect(system).toContain("rank");
    expect(prompt).toContain(binding.original);
    expect(prompt).toContain(binding.trial);
    expect(prompt).toContain("He was already packing");
    expect(prompt).toContain("General readers");
  });

  test("keeps observations whose quotes exist in the bound texts", () => {
    const result = parseRevisionReading(
      `Here you go:\n${answer([
        {
          originalQuote: "had not told",
          trialQuote: "had kept the sale from",
          contextQuote: "already packing",
          reading: "The trial can suggest deliberate concealment.",
        },
      ])}`,
      binding,
    );
    expect(result).toMatchObject({
      ok: true,
      dropped: 0,
      binding,
      observations: [
        {
          originalQuote: "had not told",
          trialQuote: "had kept the sale from",
          contextQuote: "already packing",
        },
      ],
    });
  });

  test("drops invented, swapped, empty or context-mismatched quotes", () => {
    const result = parseRevisionReading(
      answer([
        { originalQuote: "never mentioned", trialQuote: "kept", reading: "x" },
        // Quote taken from the trial but presented as the original.
        { originalQuote: "kept the sale", trialQuote: "", reading: "x" },
        { originalQuote: "", trialQuote: "", reading: "x" },
        { originalQuote: "had not told", trialQuote: "kept", reading: "" },
        {
          originalQuote: "had not told",
          trialQuote: "kept",
          contextQuote: "she was furious",
          reading: "x",
        },
        { originalQuote: "—", trialQuote: "kept", reading: "x" },
      ]),
      binding,
    );
    expect(result).toMatchObject({ ok: true, dropped: 6, observations: [] });
  });

  test("allows a phrase that is only gone or only new", () => {
    const result = parseRevisionReading(
      answer([
        {
          originalQuote: "that the house was sold",
          trialQuote: "",
          reading: "The object of the secret is no longer named.",
        },
        { originalQuote: "", trialQuote: "the sale", reading: "x" },
      ]),
      binding,
    );
    expect(result.ok && result.observations).toHaveLength(2);
  });

  test("caps observations and removes duplicates", () => {
    const one = {
      originalQuote: "had not told",
      trialQuote: "kept",
      reading: "One.",
    };
    const result = parseRevisionReading(
      answer([
        one,
        one,
        {
          originalQuote: "her brother",
          trialQuote: "her brother",
          reading: "Two.",
        },
        { originalQuote: "house", trialQuote: "sale", reading: "Three." },
      ]),
      binding,
    );
    expect(result.ok && result.observations).toHaveLength(
      MAX_REVISION_OBSERVATIONS,
    );
    expect(result.ok && result.dropped).toBe(1);
  });

  test("an empty list is a valid answer, distinct from a malformed one", () => {
    expect(parseRevisionReading(answer([]), binding)).toMatchObject({
      ok: true,
      observations: [],
      dropped: 0,
    });
    expect(
      parseRevisionReading("The meaning is unchanged.", binding),
    ).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(
      parseRevisionReading('{"observations": "none"}', binding),
    ).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  test("a binding changes with any of its texts", () => {
    expect(sameBinding(binding, { ...binding })).toBe(true);
    for (const field of ["original", "trial", "before", "after"] as const)
      expect(
        bindingKey({ ...binding, [field]: `${binding[field]} ` }) ===
          bindingKey(binding),
      ).toBe(false);
  });
});
