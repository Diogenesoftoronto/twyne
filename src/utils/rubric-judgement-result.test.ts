import { describe, expect, test } from "bun:test";
import type { RubricCriterionSpec } from "../types";
import { scoreStaticFeatures } from "./rubric";
import { readRubricAnswers, SCORE_LEVELS } from "./rubric-grade";
import {
  judgementRubricResult,
  rubricDraftFingerprint,
} from "./rubric-judgement-result";

const specs: RubricCriterionSpec[] = [
  {
    id: "thesis",
    label: "Thesis",
    description: "A clear argument",
    enabled: true,
    source: "spine",
    weight: 1,
  },
  {
    id: "custom-voice",
    label: "My voice",
    description: "Keep the unusual rhythm",
    enabled: true,
    source: "custom",
    weight: 3,
  },
  {
    id: "engagement",
    label: "Engagement",
    description: "Derived",
    enabled: true,
    source: "spine",
    weight: 1,
  },
];
const grade = readRubricAnswers(
  Object.fromEntries(
    [
      ["thesis", 4],
      ["custom-voice", 2],
    ].map(([id, score]) => [
      id,
      {
        type: "score" as const,
        score: Number(score),
        confidence: 0.8,
        legend: Object.fromEntries(
          SCORE_LEVELS.map((level, index) => [String(index), level]),
        ),
        probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.1, "4": 0.8 },
      },
    ]),
  ),
  { model: "jev-test", usage: { input_tokens: 100, output_tokens: 0 } },
);
const input = {
  folioId: "folio-a",
  fingerprint: "fingerprint",
  grade,
  specs,
  staticScore: scoreStaticFeatures("A draft."),
};

describe("judgement rubric results", () => {
  test("preserves custom marks and raw provenance without inventing room opinions", () => {
    const result = judgementRubricResult(input)!;
    expect(result.overallScore).toBe(75);
    expect(result.overallGrade).toBe("B");
    expect(result.writerScore).toBe(63);
    expect(result.criteria.map((criterion) => criterion.id)).toEqual([
      "thesis",
      "custom-voice",
    ]);
    expect(result.judges).toEqual([]);
    expect(result.judgementGrade).toEqual(grade);
    expect(result.scoringMethod).toBe("judgement");
    expect(result.draftFingerprint).toBe("fingerprint");
  });

  test("fails closed on missing marks so the aggregate cannot hide an omitted weakness", () => {
    expect(
      judgementRubricResult({
        ...input,
        grade: { ...grade, criteria: { thesis: grade.criteria.thesis } },
      }),
    ).toBeNull();
  });

  test("changing weights reuses exactly the same judgement", () => {
    const result = judgementRubricResult({
      ...input,
      specs: specs.map((spec) => ({ ...spec, weight: 1 })),
    })!;
    expect(result.writerScore).toBe(75);
    expect(result.overallScore).toBe(75);
    expect(result.judgementGrade).toEqual(grade);
  });

  test("disabled criteria do not require a mark", () => {
    const result = judgementRubricResult({
      ...input,
      specs: specs.map((spec) => ({ ...spec, enabled: spec.id === "thesis" })),
    })!;
    expect(result.overallScore).toBe(100);
    expect(result.overallGrade).toBe("A+");
  });

  test("draft fingerprint changes with edits and never contains manuscript text", async () => {
    const before = await rubricDraftFingerprint("Original draft");
    expect(before).toMatch(/^[a-f0-9]{64}$/);
    expect(before).toBe(await rubricDraftFingerprint("Original draft"));
    expect(before).not.toBe(await rubricDraftFingerprint("Revised draft"));
  });
});
