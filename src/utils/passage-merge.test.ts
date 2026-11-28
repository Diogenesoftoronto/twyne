import { describe, expect, test } from "bun:test";
import {
  adviceFor,
  evidenceRequest,
  foldOffer,
  localEvidence,
  mergeQuestion,
  mergeWhy,
  planMerge,
  readEvidence,
  readMergeAdvice,
  snapToSentences,
} from "./passage-merge";

const HERE =
  "By the fourth day the road forgot the sea entirely. The drivers stopped looking west.";
const OTHER =
  "The road forgot the sea entirely by the fourth day. Salt still crusted the harness buckles.";

const slices = (text: string, spans: { from: number; to: number }[]) =>
  spans.map((s) => text.slice(s.from, s.to));

describe("which paragraph stays", () => {
  const question = mergeQuestion("passage", "echo0", "Evidence only.");

  test("the choice names both paragraphs by their place in the state", () => {
    expect(question.instructions).toStartWith("Evidence only. `passage`");
    expect(question.criteria).toHaveLength(4);
    expect(question.criteria[0]).toContain("`passage`");
    expect(question.criteria[1]).toContain("`echo0`");
  });

  test("each option reads back as one outcome, and anything else as none", () => {
    expect(
      question.criteria.map((c) => readMergeAdvice(c, question.criteria)),
    ).toEqual(["fold-here", "fold-there", "together", "apart"]);
    expect(readMergeAdvice(undefined, question.criteria)).toBe(null);
    expect(readMergeAdvice("Something else", question.criteria)).toBe(null);
  });

  test("a relation that works at a distance is never folded or moved", () => {
    expect(adviceFor("Unpaid promise", "fold-here")).toBe(null);
    expect(adviceFor("Echo", "together")).toBe(null);
    expect(adviceFor("Tension", "fold-there")).toBe(null);
    expect(adviceFor("Tension", "together")).toBe("together");
    expect(adviceFor("Repetition", "fold-there")).toBe("fold-there");
    expect(adviceFor("Same subject", "apart")).toBe(null);
  });

  test("a fold is offered only where the relation can carry one", () => {
    expect(foldOffer("Repetition")).toBe("always");
    expect(foldOffer("Same subject")).toBe("always");
    expect(foldOffer("Unpaid promise")).toBe("never");
    expect(foldOffer("Tension")).toBe("never");
    expect(foldOffer("Echo")).toBe("never");
    // Nothing has read these for meaning: the evidence decides.
    expect(foldOffer("Shared words")).toBe("if-repeats");
    expect(foldOffer(undefined)).toBe("if-repeats");
  });
});

describe("the sentences each paragraph repeats", () => {
  test("an extraction answer becomes sentences of its own paragraph", () => {
    const { state } = evidenceRequest(HERE, OTHER);
    const at = (text: string): [number, number] => {
      const from = state!.indexOf(text);
      return [from, from + text.length];
    };
    const evidence = readEvidence(HERE, OTHER, {
      first: {
        type: "list",
        value: [],
        spans: [at("the road forgot the sea entirely")],
      },
      second: {
        type: "list",
        value: [],
        spans: [at("The road forgot the sea entirely by the fourth day.")],
      },
    })!;
    expect(evidence.source).toBe("reading");
    expect(slices(HERE, evidence.here)).toEqual([
      "By the fourth day the road forgot the sea entirely.",
    ]);
    expect(slices(OTHER, evidence.other)).toEqual([
      "The road forgot the sea entirely by the fourth day.",
    ]);
  });

  test("a span from the wrong paragraph is not evidence", () => {
    const { state } = evidenceRequest(HERE, OTHER);
    const from = state!.indexOf("Salt still crusted");
    const evidence = readEvidence(HERE, OTHER, {
      first: { type: "list", value: [], spans: [[from, from + 30]] },
    })!;
    expect(evidence.here).toEqual([]);
    expect(evidence.other).toEqual([]);
  });

  test("no answer is no evidence, so the caller falls back", () => {
    expect(readEvidence(HERE, OTHER, undefined)).toBe(null);
    expect(readEvidence(HERE, OTHER, {})).toBe(null);
  });

  test("a sentence is taken whole only when most of it was pointed at", () => {
    expect(snapToSentences(HERE, [{ from: 0, to: 8 }])).toEqual([]);
    expect(slices(HERE, snapToSentences(HERE, [{ from: 10, to: 50 }]))).toEqual(
      ["By the fourth day the road forgot the sea entirely."],
    );
  });

  test("shared words stand in when nothing has read the paragraphs", () => {
    const evidence = localEvidence(HERE, OTHER);
    expect(evidence.source).toBe("words");
    expect(slices(OTHER, evidence.other)).toEqual([
      "The road forgot the sea entirely by the fourth day.",
    ]);
    expect(slices(HERE, evidence.here)).toEqual([
      "By the fourth day the road forgot the sea entirely.",
    ]);
  });
});

describe("the fold", () => {
  const repeated = localEvidence(HERE, OTHER).other;

  test("repeats are left out and the rest is carried, in order", () => {
    const plan = planMerge(OTHER, repeated);
    expect(slices(OTHER, plan.dropped)).toEqual([
      "The road forgot the sea entirely by the fourth day.",
    ]);
    expect(slices(OTHER, plan.carried)).toEqual([
      "Salt still crusted the harness buckles.",
    ]);
  });

  test("a sentence that must travel is carried even when it repeats", () => {
    const plan = planMerge(OTHER, repeated, () => true);
    expect(plan.dropped).toEqual([]);
    expect(plan.carried).toHaveLength(2);
  });

  test("with no evidence every sentence is carried", () => {
    expect(planMerge(OTHER, []).carried).toHaveLength(2);
  });
});

describe("why a fold is offered", () => {
  const names = { here: "paragraph 4", other: "paragraph 19" };
  const texts = { here: HERE, other: OTHER };
  const evidence = localEvidence(HERE, OTHER);

  test("names the keeper and counts what the evidence found", () => {
    expect(mergeWhy("fold-here", names, texts, evidence)).toBe(
      "Paragraph 4 makes the point more fully. One sentence in paragraph 19 repeats it; the other one would be carried over.",
    );
    expect(mergeWhy("fold-there", names, texts, evidence)).toBe(
      "Paragraph 19 makes the point more fully. One sentence in paragraph 4 repeats it; the other one would be carried over.",
    );
  });

  test("says only what it knows before the evidence arrives", () => {
    expect(mergeWhy("fold-here", names, texts, null)).toBe(
      "Paragraph 4 makes the point more fully.",
    );
  });

  test("has nothing to say when no fold was advised", () => {
    expect(mergeWhy(null, names, texts, evidence)).toBe("");
    expect(mergeWhy("apart", names, texts, evidence)).toBe("");
    expect(mergeWhy("together", names, texts, evidence)).toContain(
      "Side by side",
    );
  });
});
