import { describe, expect, test } from "bun:test";
import {
  confidenceOf,
  estimateCost,
  isBimodal,
  isNoul,
  isScore,
  modalLevel,
  noul,
  score,
  scoreOutOf,
  type ScoreAnswer,
} from "./system-one";

const scoreAnswer = (
  probabilities: Record<string, number>,
  value: number,
  confidence = 0.5,
): ScoreAnswer => ({
  type: "score",
  score: value,
  legend: Object.fromEntries(
    Object.keys(probabilities).map((k) => [k, `level ${k}`]),
  ),
  probabilities,
  confidence,
});

describe("isBimodal", () => {
  // The measured failure this function exists for: a real answer came back
  // score 1.43 at confidence 0.14 with mass piled on level 2, so the scalar
  // named the level the model thought *least* likely.
  test("catches the measured trough case", () => {
    const answer = scoreAnswer({ "0": 0.21, "1": 0.16, "2": 0.63 }, 1.43, 0.14);
    expect(isBimodal(answer)).toBe(true);
    expect(modalLevel(answer)).toBe(2);
  });

  test("a concentrated distribution is not bimodal", () => {
    expect(
      isBimodal(scoreAnswer({ "0": 0.05, "1": 0.9, "2": 0.05 }, 1.0)),
    ).toBe(false);
  });

  test("a mild spread around the mean is not bimodal", () => {
    expect(
      isBimodal(scoreAnswer({ "0": 0.2, "1": 0.45, "2": 0.35 }, 1.15)),
    ).toBe(false);
  });

  test("modal level and nearest-to-mean agree when unimodal", () => {
    const answer = scoreAnswer({ "0": 0.1, "1": 0.7, "2": 0.2 }, 1.1);
    expect(modalLevel(answer)).toBe(Math.round(answer.score));
  });
});

describe("scoreOutOf", () => {
  test("maps the top level to the maximum", () => {
    const answer = scoreAnswer({ "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 }, 4);
    expect(scoreOutOf(answer, 10)).toBe(10);
  });

  test("maps the bottom level to zero", () => {
    const answer = scoreAnswer({ "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 }, 0);
    expect(scoreOutOf(answer, 10)).toBe(0);
  });

  test("scales by the declared level count, not a fixed assumption", () => {
    const threeLevel = scoreAnswer({ "0": 0, "1": 1, "2": 0 }, 1);
    const fiveLevel = scoreAnswer(
      { "0": 0, "1": 0, "2": 1, "3": 0, "4": 0 },
      2,
    );
    // Both are the middle level, so both are 5/10.
    expect(scoreOutOf(threeLevel, 10)).toBe(5);
    expect(scoreOutOf(fiveLevel, 10)).toBe(5);
  });
});

describe("confidence semantics", () => {
  test("a Noul carries no confidence", () => {
    expect(confidenceOf({ type: "noul", noul: 0.5 })).toBeNull();
  });

  test("a Score carries its distribution concentration", () => {
    expect(confidenceOf(scoreAnswer({ "0": 0.5, "1": 0.5 }, 0.5, 0.31))).toBe(
      0.31,
    );
  });
});

describe("type guards", () => {
  test("discriminate on the wire tag", () => {
    expect(isNoul({ type: "noul", noul: 0.2 })).toBe(true);
    expect(isScore({ type: "noul", noul: 0.2 })).toBe(false);
    expect(isScore(scoreAnswer({ "0": 1 }, 0))).toBe(true);
  });

  test("tolerate a missing answer", () => {
    expect(isScore(undefined)).toBe(false);
    expect(isNoul(undefined)).toBe(false);
  });
});

describe("builders", () => {
  test("noul carries no criteria", () => {
    expect(noul("ready?")).toEqual({ type: "noul", instructions: "ready?" });
  });

  test("score keeps criteria order, which is the level index", () => {
    const q = score("rate it", ["bad", "ok", "good"]);
    expect(q.criteria[0]).toBe("bad");
    expect(q.criteria[2]).toBe("good");
  });
});

describe("estimateCost", () => {
  // The measured full-spine pass: 1,401 input tokens for all 11 criteria.
  test("matches the measured rubric pass", () => {
    const cost = estimateCost({ input_tokens: 1401, output_tokens: 300 });
    expect(cost).toBeCloseTo(0.0000588, 7);
  });

  test("output tokens are free", () => {
    const a = estimateCost({ input_tokens: 1000, output_tokens: 0 });
    const b = estimateCost({ input_tokens: 1000, output_tokens: 100_000 });
    expect(a).toBe(b);
  });
});
