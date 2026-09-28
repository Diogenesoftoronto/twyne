import { describe, expect, test } from "bun:test";
import {
  classify,
  fallbackClassification,
  fillSpec,
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
  test("Sentence Lab shows the writer's own earlier attempts", () => {
    const activity = {
      ...emptyActivity(passage, 0),
      attempts: { 1: ["They cram people in.", "They put people close."] },
    };
    const spec = seedSpec("sentence-lab", passage, {
      activity,
      sentenceIndex: 1,
    });
    expect(spec.elements.tool).toMatchObject({
      type: "SentenceLab",
      props: {
        sentence: "They pack people together.",
        attempts: ["They cram people in.", "They put people close."],
        variants: [],
      },
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

  test("streams variants into Sentence Lab as the model writes", async () => {
    const seed = seedSpec("sentence-lab", passage, { sentenceIndex: 1 });
    const seen: number[] = [];
    const lines = ["They crowd people close.", "They bring people near."].map(
      (value) =>
        JSON.stringify({
          op: "add",
          path: "/elements/tool/props/variants/-",
          value,
        }),
    );
    const { spec } = await fillSpec(
      seed,
      context,
      async ({ onText }) => {
        onText?.(`${lines[0]}\n`);
        onText?.(`${lines[0]}\n${lines[1]}`);
        return `${lines[0]}\n${lines[1]}`;
      },
      (partial) => {
        const props = partial.elements.tool.props as { variants: string[] };
        seen.push(props.variants.length);
      },
    );
    expect(seen[0]).toBe(1);
    expect(spec.elements.tool.props).toMatchObject({
      variants: ["They crowd people close.", "They bring people near."],
    });
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
