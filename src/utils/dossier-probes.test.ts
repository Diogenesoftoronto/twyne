import { describe, expect, test } from "bun:test";
import type { DossierProbe } from "../types";
import {
  blankAnswer,
  countBlanks,
  isAnswered,
  normalizeProbe,
  normalizeProbes,
  probeAnswerText,
  upsertProbe,
} from "./dossier-probes";

/**
 * These probes arrive as model-authored JSON, so "almost right" is the common
 * case: a choice with one option, a scale with no bounds, a blanks template
 * with no blanks. The contract is that anything malformed becomes null and the
 * interview carries on in prose — never a control the writer cannot answer.
 */

describe("normalizeProbe — rejection", () => {
  test.each([
    ["a non-object", 42],
    ["null", null],
    ["an unknown kind", { kind: "essay", prompt: "p" }],
    ["a missing prompt", { kind: "choice", prompt: "  ", options: ["a", "b"] }],
    ["a choice with no options", { kind: "choice", prompt: "p" }],
    ["a choice with one option", { kind: "choice", prompt: "p", options: ["a"] }],
    ["blanks with no template", { kind: "blanks", prompt: "p" }],
    [
      "blanks whose template has no blank",
      { kind: "blanks", prompt: "p", template: "no blank here" },
    ],
    ["a scale whose range is inverted", { kind: "scale", prompt: "p", min: 5, max: 2 }],
    ["a scale with no range at all", { kind: "scale", prompt: "p", min: 3, max: 3 }],
  ])("rejects %s", (_label, input) => {
    expect(normalizeProbe(input)).toBeNull();
  });

  test("a choice whose options collapse to one after dedupe is rejected", () => {
    expect(
      normalizeProbe({
        kind: "choice",
        prompt: "p",
        options: ["Essay", "essay ", "  Essay  "],
      }),
    ).not.toBeNull();
    expect(
      normalizeProbe({ kind: "choice", prompt: "p", options: ["Essay", "Essay"] }),
    ).toBeNull();
  });
});

describe("normalizeProbe — acceptance", () => {
  test("keeps a well-formed choice and trims its options", () => {
    const p = normalizeProbe({
      kind: "choice",
      prompt: "  What form is this?  ",
      options: [" Essay ", "Dispatch", ""],
      relatesTo: "format",
    })!;
    expect(p.kind).toBe("choice");
    expect(p.prompt).toBe("What form is this?");
    expect(p.options).toEqual(["Essay", "Dispatch"]);
    expect(p.relatesTo).toBe("format");
  });

  test("mints an id when the model omits one, and they do not collide", () => {
    const base = { kind: "choice", prompt: "p", options: ["a", "b"] };
    expect(normalizeProbe(base)!.id).not.toBe(normalizeProbe(base)!.id);
  });

  test("ignores a relatesTo that is not a brief field", () => {
    const p = normalizeProbe({
      kind: "choice",
      prompt: "p",
      options: ["a", "b"],
      relatesTo: "vibes",
    })!;
    expect(p.relatesTo).toBeUndefined();
  });

  test("defaults a scale's bounds and caps how many stops it can have", () => {
    const bare = normalizeProbe({ kind: "scale", prompt: "p" })!;
    expect(bare.min).toBe(1);
    expect(bare.max).toBe(5);

    const huge = normalizeProbe({ kind: "scale", prompt: "p", min: 0, max: 100 })!;
    expect(huge.max).toBe(10);
  });

  test("caps the option count so a choice stays a choice", () => {
    const many = normalizeProbe({
      kind: "choice",
      prompt: "p",
      options: Array.from({ length: 20 }, (_, i) => `option ${i}`),
    })!;
    expect(many.options!.length).toBeLessThanOrEqual(8);
  });
});

describe("normalizeProbes", () => {
  test("accepts a bare array or a wrapped object", () => {
    const good = { kind: "choice", prompt: "p", options: ["a", "b"] };
    expect(normalizeProbes([good])).toHaveLength(1);
    expect(normalizeProbes({ probes: [good] })).toHaveLength(1);
  });

  test("drops the malformed and keeps the rest", () => {
    const list = normalizeProbes([
      { kind: "choice", prompt: "p", options: ["a", "b"] },
      { kind: "choice", prompt: "broken", options: ["only"] },
      { kind: "scale", prompt: "q" },
    ]);
    expect(list).toHaveLength(2);
  });

  test("returns nothing for junk rather than throwing", () => {
    expect(normalizeProbes(null)).toEqual([]);
    expect(normalizeProbes("nope")).toEqual([]);
  });
});

describe("countBlanks", () => {
  test("counts each run of underscores once", () => {
    expect(countBlanks("The reader leaves ___ and does ___.")).toBe(2);
    expect(countBlanks("no blanks")).toBe(0);
    expect(countBlanks("________")).toBe(1);
  });
});

describe("isAnswered", () => {
  const probe = (over: Partial<DossierProbe>): DossierProbe => ({
    id: "p",
    kind: "choice",
    prompt: "p",
    ...over,
  });

  test("an untouched probe is unanswered", () => {
    expect(isAnswered(probe({}))).toBe(false);
  });

  test("whitespace is not an answer", () => {
    expect(isAnswered(probe({ answer: "   " }))).toBe(false);
    expect(isAnswered(probe({ kind: "multi", answer: ["", "  "] }))).toBe(false);
  });

  test("a partly-filled blanks sentence counts as answered", () => {
    expect(
      isAnswered(probe({ kind: "blanks", answer: ["moved", ""] })),
    ).toBe(true);
  });

  test("zero is a real scale answer", () => {
    expect(isAnswered(probe({ kind: "scale", answer: 0 }))).toBe(true);
  });
});

describe("probeAnswerText", () => {
  test("fills a blanks template in order", () => {
    expect(
      probeAnswerText({
        id: "p",
        kind: "blanks",
        prompt: "Finish it",
        template: "The reader should leave ___ and do ___.",
        answer: ["unsettled", "call their sister"],
      }),
    ).toBe("The reader should leave unsettled and do call their sister.");
  });

  test("leaves an unfilled blank visible rather than silently closing it", () => {
    expect(
      probeAnswerText({
        id: "p",
        kind: "blanks",
        prompt: "Finish it",
        template: "Leave them ___ and ___.",
        answer: ["unsettled", "  "],
      }),
    ).toBe("Leave them unsettled and ___.");
  });

  test("reads a scale back with its ends", () => {
    expect(
      probeAnswerText({
        id: "p",
        kind: "scale",
        prompt: "How formal?",
        min: 1,
        max: 5,
        minLabel: "pub talk",
        maxLabel: "white paper",
        answer: 4,
      }),
    ).toBe("4 of 5 (1=pub talk, 5=white paper)");
  });

  test("joins a multi-select", () => {
    expect(
      probeAnswerText({
        id: "p",
        kind: "multi",
        prompt: "Which?",
        answer: ["one", "two"],
      }),
    ).toBe("one, two");
  });

  test("is empty for an unanswered probe", () => {
    expect(probeAnswerText({ id: "p", kind: "choice", prompt: "p" })).toBe("");
  });
});

describe("blankAnswer", () => {
  test("shapes the empty answer to the probe's kind", () => {
    expect(blankAnswer({ id: "p", kind: "choice", prompt: "p" })).toBe("");
    expect(blankAnswer({ id: "p", kind: "multi", prompt: "p" })).toEqual([]);
    expect(
      blankAnswer({ id: "p", kind: "blanks", prompt: "p", template: "a ___ b ___" }),
    ).toEqual(["", ""]);
    expect(
      blankAnswer({ id: "p", kind: "scale", prompt: "p", min: 1, max: 5 }),
    ).toBe(3);
  });
});

describe("upsertProbe", () => {
  const a: DossierProbe = { id: "a", kind: "choice", prompt: "p", answer: "x" };

  test("appends a probe that is not there yet", () => {
    expect(upsertProbe([], a)).toHaveLength(1);
  });

  test("replaces rather than duplicating when the writer changes their mind", () => {
    const changed = { ...a, answer: "y" };
    const out = upsertProbe([a], changed);
    expect(out).toHaveLength(1);
    expect(out[0].answer).toBe("y");
  });

  test("does not mutate the list it was given", () => {
    const list = [a];
    upsertProbe(list, { ...a, answer: "y" });
    expect(list[0].answer).toBe("x");
  });
});
