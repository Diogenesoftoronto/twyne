import { describe, expect, test } from "bun:test";
import {
  capShapeScore,
  combineJudgesAndStatic,
  scoreStaticFeatures,
  shapeCeiling,
  UNJUDGED_TARGET_FIT,
  type JudgeResult,
} from "./rubric";

/**
 * The relevance gate. Static features measure shape and never read the brief,
 * so before the gate existed a fluent piece about the wrong subject scored
 * 10/10 on pacing, vocabulary and paragraph shape and carried a flat 20% of
 * the combined grade. These tests pin the fix.
 */

const brief = {
  answers: {
    audience: "City planners weighing a transit levy",
    goal: "Argue that the levy pays for itself within a decade",
  },
};

function judges(scores: number[]): JudgeResult[] {
  return scores.map((score, i) => ({
    personaId: `p${i}`,
    score,
    rationale: "r",
    provider: "test",
  }));
}

/**
 * Fluent, well-shaped prose: varied sentence length, healthy type-token ratio,
 * balanced paragraphs. It is also entirely about the wrong subject.
 */
const WELL_SHAPED = [
  "The kitchen smelled of burnt sugar and something older, something closer to rust. Mira set the pan down. She had not expected the morning to turn.",
  "Outside, the market was already loud with the particular energy of a Saturday that intends to become something. Vendors argued over awning space, and a child dragged a bicycle wheel along the kerb without any apparent purpose beyond the sound it made against the stone, which was considerable.",
  "She thought about her grandmother's hands. Flour, always. A ring worn thin. The habit of narrating a recipe aloud to nobody, as though the room were an apprentice that might one day learn.",
  "By noon the light had shifted and the whole street took on that flat, generous quality that photographers chase and rarely catch. Mira locked the door behind her, and did not look back at the pan, which would still be there, and would still be ruined, when she returned.",
].join("\n\n");

describe("shapeCeiling", () => {
  test("is a no-op at full target fit", () => {
    expect(shapeCeiling(10)).toBe(10);
  });

  test("bites hard when the draft is off-target", () => {
    expect(shapeCeiling(0)).toBe(3);
    expect(shapeCeiling(2)).toBeCloseTo(4.4, 5);
    expect(shapeCeiling(5)).toBeCloseTo(6.5, 5);
  });

  test("is monotonic in target fit", () => {
    for (let fit = 0; fit < 10; fit++) {
      expect(shapeCeiling(fit)).toBeLessThan(shapeCeiling(fit + 1));
    }
  });

  test("clamps out-of-range input rather than producing nonsense", () => {
    expect(shapeCeiling(-5)).toBe(3);
    expect(shapeCeiling(99)).toBe(10);
  });
});

describe("capShapeScore", () => {
  test("leaves a score untouched when the draft is on-target", () => {
    const { score, capped } = capShapeScore(9.4, 10);
    expect(score).toBe(9.4);
    expect(capped).toBe(false);
  });

  test("caps a perfect shape score when relevance is low, and reports it", () => {
    const { score, capped, ceiling } = capShapeScore(10, 2);
    expect(score).toBe(4.4);
    expect(ceiling).toBe(4.4);
    expect(capped).toBe(true);
  });

  test("does not inflate a score that is already below the ceiling", () => {
    const { score, capped } = capShapeScore(2, 2);
    expect(score).toBe(2);
    expect(capped).toBe(false);
  });
});

describe("combineJudgesAndStatic — the relevance gate", () => {
  const staticScore = scoreStaticFeatures(WELL_SHAPED);

  test("the fixture really does score well on shape — the premise of the gate", () => {
    // If this stops holding, every test below would pass for the wrong
    // reason: there would be no high shape score left to cap.
    expect(staticScore.perFeature.pacing).toBeGreaterThan(7);
    expect(staticScore.perFeature.vocabulary).toBeGreaterThan(7);
  });

  test("defaults to no gating so an unjudged draft is never punished", () => {
    const gated = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
    );
    const explicit = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
      UNJUDGED_TARGET_FIT,
    );
    expect(gated.combined).toBe(explicit.combined);
    expect(gated.targetFit).toBe(10);
    expect(gated.effectiveStatic).toBeCloseTo(staticScore.total, 1);
  });

  test("off-target prose grades lower than the same prose on-target", () => {
    const onTarget = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
      10,
    );
    const offTarget = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
      1,
    );
    expect(offTarget.combined).toBeLessThan(onTarget.combined);
    expect(offTarget.effectiveStatic).toBeLessThan(offTarget.staticTotal);
  });

  /**
   * The property that matters most. An earlier version of the gate
   * redistributed the static weight onto the harshest judge, which raised the
   * grade whenever the static score sat below that judge's score — a
   * relevance gate that sometimes rewarded irrelevance. Lowering target fit
   * must never increase the grade, for any combination of judge scores.
   */
  test("lowering target fit never raises the grade", () => {
    const judgeSets = [
      [2, 2, 3, 2, 2],
      [6, 6, 6, 6, 6],
      [9, 9, 8, 9, 9],
      [9, 9, 9, 9, 2],
      [3, 8, 5, 9, 4],
    ];
    for (const set of judgeSets) {
      for (let fit = 10; fit > 0; fit--) {
        const higher = combineJudgesAndStatic(
          judges(set),
          staticScore,
          brief,
          fit,
        );
        const lower = combineJudgesAndStatic(
          judges(set),
          staticScore,
          brief,
          fit - 1,
        );
        expect(lower.combined).toBeLessThanOrEqual(higher.combined);
      }
    }
  });

  test("at zero relevance the static score is capped to the floor", () => {
    const result = combineJudgesAndStatic(
      judges([8, 8, 8, 8, 3]),
      staticScore,
      brief,
      0,
    );
    expect(result.effectiveStatic).toBeLessThanOrEqual(3);
  });

  test("a strong static score cannot rescue a draft every judge dislikes", () => {
    const result = combineJudgesAndStatic(
      judges([2, 2, 3, 2, 2]),
      staticScore,
      brief,
      2,
    );
    expect(result.combined).toBeLessThan(40);
  });

  test("explains the cap in the summary when relevance is low", () => {
    const result = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
      3,
    );
    expect(result.summary).toContain("Target fit is 3/10");
    expect(result.summary).toContain("capped");
  });

  test("says nothing about capping when the draft is on-target", () => {
    const result = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
      9,
    );
    expect(result.summary).not.toContain("Target fit is");
  });

  test("clamps an out-of-range target fit instead of skewing the weights", () => {
    const result = combineJudgesAndStatic(
      judges([6, 6, 6, 6, 6]),
      staticScore,
      brief,
      42,
    );
    expect(result.targetFit).toBe(10);
    expect(result.effectiveStatic).toBeCloseTo(staticScore.total, 1);
  });
});
