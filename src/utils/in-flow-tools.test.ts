import { describe, expect, test } from "bun:test";
import {
  classify,
  fallbackClassification,
  fillSpec,
  readRevision,
  seedSpec,
  type Ask,
} from "./in-flow-tools";
import { emptyActivity, type StruggleReading } from "./struggle-signals";

const passage =
  "Cities are the best engine of opportunity ever built. They pack people together. Ideas spread faster when people are close.";

const reading = (
  kind: StruggleReading["hints"][number]["kind"],
  strength = 0.7,
): StruggleReading => ({
  score: strength,
  hints: [{ kind, strength, reason: "test" }],
});

describe("seedSpec", () => {
  test("Compare a revision seeds the named sentence and its paragraph only", () => {
    const spec = seedSpec("sentence-lab", passage, {
      activity: {
        ...emptyActivity(passage, 0),
        attempts: { 1: ["They cram people in."] },
      },
      sentenceIndex: 1,
    });
    const from = passage.indexOf("They pack");
    expect(spec.elements.tool).toEqual({
      type: "SentenceLab",
      props: {
        sentence: "They pack people together.",
        context: {
          before: passage.slice(0, from),
          after: passage.slice(from + "They pack people together.".length),
          paragraph: passage,
        },
      },
      children: [],
    });
  });

  test("Compare a revision refuses instead of guessing a sentence", () => {
    const spec = seedSpec("sentence-lab", passage);
    expect(spec.elements.tool.props).toMatchObject({
      refusal: expect.stringContaining("select one sentence"),
    });
  });

  test("Rhythm Strip counts words per sentence and honours a saved band", () => {
    const spec = seedSpec("rhythm-strip", passage, {
      config: { targetMin: 5, targetMax: 12 },
    });
    expect(spec.elements.tool.props).toEqual({
      sentences: [
        {
          text: "Cities are the best engine of opportunity ever built.",
          words: 9,
        },
        { text: "They pack people together.", words: 4 },
        { text: "Ideas spread faster when people are close.", words: 7 },
      ],
      targetMin: 5,
      targetMax: 12,
    });
  });

  test("Claim Check uses Jev's pick and its verdict on each slot", () => {
    const spec = seedSpec("claim-check", passage, {
      classification: {
        kind: "claim-check",
        tentative: false,
        claimIndex: 2,
        filled: { "An example": true },
      },
    });
    expect(spec.elements.tool.props).toEqual({
      claim: "Ideas spread faster when people are close.",
      slots: [
        { label: "A source", filled: false },
        { label: "An example", filled: true },
        { label: "A number", filled: false },
      ],
    });
  });
});

describe("classify", () => {
  test("maps Jev's choice onto a tool and reads the claim and slots", async () => {
    let asked: Parameters<Ask>[0] | null = null;
    const ask: Ask = async (input) => {
      asked = input;
      return {
        ok: true,
        answers: {
          tool: {
            type: "choice",
            choice: "Check how strongly to state the claim",
            probabilities: { "Check how strongly to state the claim": 0.8 },
            confidence: 0.7,
          },
          claim: {
            type: "choice",
            choice: "1. Cities are the best engine of opportunity ever built.",
            probabilities: {},
            confidence: 0.9,
          },
          slot0: { type: "noul", noul: 0.1 },
          slot1: { type: "noul", noul: 0.9 },
        },
      };
    };
    const result = await classify(
      {
        passage,
        versions: [],
        reading: reading("claim-check"),
        goal: "",
        audience: "",
      },
      ask,
    );
    expect(result).toEqual({
      kind: "claim-check",
      tentative: false,
      claimIndex: 0,
      filled: { "A source": false, "An example": true },
    });
    expect(Object.keys(asked!.questions)).toContain("slot2");
  });

  test("'leave the writer alone' opens nothing", async () => {
    const ask: Ask = async () => ({
      ok: true,
      answers: {
        tool: {
          type: "choice",
          choice: "Leave the writer alone",
          probabilities: {},
          confidence: 0.9,
        },
      },
    });
    const result = await classify(
      {
        passage,
        versions: [],
        reading: reading("sentence-lab"),
        goal: "",
        audience: "",
      },
      ask,
    );
    expect(result.kind).toBeNull();
  });

  test("without Jev only a strong local signal opens a tool", () => {
    expect(fallbackClassification(reading("rhythm-strip", 0.7)).kind).toBe(
      "rhythm-strip",
    );
    expect(
      fallbackClassification(reading("rhythm-strip", 0.5)).kind,
    ).toBeNull();
  });
});

describe("fillSpec", () => {
  const context = { passage, preceding: "", goal: "", audience: "" };

  test("Compare a revision never calls a model while filling", async () => {
    const seed = seedSpec("sentence-lab", passage, { sentenceIndex: 1 });
    let called = false;
    const { spec } = await fillSpec(
      seed,
      context,
      async () => {
        called = true;
        return "";
      },
      () => {},
    );
    expect(called).toBe(false);
    expect(spec).toEqual(seed);
  });

  test("Reader Questions fall back to general questions without a model", async () => {
    const seed = seedSpec("reader-questions", passage);
    const { spec, notice } = await fillSpec(seed, context, null, () => {});
    expect(
      (spec.elements.tool.props as { questions: string[] }).questions,
    ).toHaveLength(3);
    expect(notice).toContain("Settings");
  });

  test("Rhythm Strip never calls a model", async () => {
    const seed = seedSpec("rhythm-strip", passage);
    let called = false;
    const { spec } = await fillSpec(
      seed,
      context,
      async () => {
        called = true;
        return "";
      },
      () => {},
    );
    expect(called).toBe(false);
    expect(spec).toEqual(seed);
  });
});

describe("readRevision", () => {
  const binding = {
    original: "She had not told her brother that the house was sold.",
    trial: "She had kept the sale from her brother.",
    before: "Mara learned about the sale that morning. ",
    after: " He was already packing for his visit.",
  };

  test("without a configured provider it makes no request and says why", async () => {
    const result = await readRevision(binding, {}, null);
    expect(result).toMatchObject({ ok: false, reason: "no-provider" });
  });

  test("sends the exact texts once and keeps only grounded observations", async () => {
    const prompts: string[] = [];
    const result = await readRevision(
      binding,
      { goal: "A family story" },
      async ({ prompt, system }) => {
        prompts.push(prompt);
        expect(system).toContain("never rewrite");
        return JSON.stringify({
          observations: [
            {
              originalQuote: "had not told",
              trialQuote: "had kept the sale from",
              reading: "The trial suggests deliberate concealment.",
            },
            {
              originalQuote: "had never mentioned",
              trialQuote: "kept",
              reading: "Invented quote.",
            },
          ],
        });
      },
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(binding.original);
    expect(prompts[0]).toContain(binding.trial);
    expect(prompts[0]).toContain("He was already packing");
    expect(result).toMatchObject({ ok: true, dropped: 1, binding });
    if (result.ok) expect(result.observations).toHaveLength(1);
  });

  test("a provider failure reports failure, never an empty reading", async () => {
    expect(await readRevision(binding, {}, async () => null)).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(
      await readRevision(binding, {}, async () => {
        throw new Error("network");
      }),
    ).toMatchObject({ ok: false, reason: "failed" });
  });
});
