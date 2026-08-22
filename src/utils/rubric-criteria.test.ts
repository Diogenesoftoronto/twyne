import { describe, expect, test } from "bun:test";
import { SPINE_CRITERIA, type RubricCriterionSpec } from "../types";
import {
  MAX_WEIGHT,
  MIN_WEIGHT,
  activeCustomCriteria,
  clampWeight,
  defaultCriteriaSpecs,
  newCustomCriterion,
  reconcileSpecs,
  scoreDelta,
  sparklinePoints,
  stepWeight,
  weightedCriteriaScore,
} from "./rubric-criteria";

const custom = (
  overrides: Partial<RubricCriterionSpec> = {},
): RubricCriterionSpec => ({
  id: "custom-1",
  label: "Stays in second person",
  description: "Never slips into first or third",
  source: "custom",
  enabled: true,
  weight: 1,
  ...overrides,
});

describe("defaultCriteriaSpecs", () => {
  test("ships every spine criterion, enabled and evenly weighted", () => {
    const specs = defaultCriteriaSpecs();
    expect(specs).toHaveLength(SPINE_CRITERIA.length);
    expect(specs.every((s) => s.enabled)).toBe(true);
    expect(specs.every((s) => s.weight === 1)).toBe(true);
    expect(specs.every((s) => s.source === "spine")).toBe(true);
  });

  test("includes the relevance gate", () => {
    expect(defaultCriteriaSpecs().some((s) => s.id === "targetFit")).toBe(true);
  });
});

describe("clampWeight", () => {
  test("holds weights inside the usable range", () => {
    expect(clampWeight(0)).toBe(MIN_WEIGHT);
    expect(clampWeight(99)).toBe(MAX_WEIGHT);
    expect(clampWeight(1.5)).toBe(1.5);
  });

  /**
   * A number input yields NaN on an empty field and can be coaxed into
   * Infinity. Both are garbage rather than an intent to weight heavily, so
   * they fall back to the neutral 1 instead of the maximum.
   */
  test("falls back to neutral on the garbage a number input can produce", () => {
    expect(clampWeight(NaN)).toBe(1);
    expect(clampWeight(Infinity)).toBe(1);
    expect(clampWeight(-Infinity)).toBe(1);
  });
});

describe("stepWeight", () => {
  test("moves through exact quarter-step relative weights", () => {
    expect(stepWeight(1, 1)).toBe(1.25);
    expect(stepWeight(1, -1)).toBe(0.75);
    expect(stepWeight(1.25, 1)).toBe(1.5);
  });

  test("stops at the weight guard rails", () => {
    expect(stepWeight(MIN_WEIGHT, -1)).toBe(MIN_WEIGHT);
    expect(stepWeight(MAX_WEIGHT, 1)).toBe(MAX_WEIGHT);
  });
});

describe("reconcileSpecs", () => {
  test("falls back to the defaults when nothing is stored", () => {
    expect(reconcileSpecs(null)).toHaveLength(SPINE_CRITERIA.length);
    expect(reconcileSpecs([])).toHaveLength(SPINE_CRITERIA.length);
  });

  test("keeps the writer's enable and weight choices", () => {
    const stored: RubricCriterionSpec[] = [
      {
        id: "pacing",
        label: "Pacing & Rhythm",
        description: "old wording",
        source: "spine",
        enabled: false,
        weight: 2,
      },
    ];
    const pacing = reconcileSpecs(stored).find((s) => s.id === "pacing")!;
    expect(pacing.enabled).toBe(false);
    expect(pacing.weight).toBe(2);
  });

  /**
   * The spine is code and the stored list is data. Wording improvements have
   * to reach a writer who configured their rubric months ago, so labels and
   * descriptions always come from the shipped definition.
   */
  test("refreshes labels and descriptions from the shipped spine", () => {
    const stored: RubricCriterionSpec[] = [
      {
        id: "pacing",
        label: "Stale Label",
        description: "stale description",
        source: "spine",
        enabled: true,
        weight: 1,
      },
    ];
    const pacing = reconcileSpecs(stored).find((s) => s.id === "pacing")!;
    expect(pacing.label).toBe("Pacing & Rhythm");
    expect(pacing.description).not.toBe("stale description");
  });

  test("adds spine criteria the writer has never seen", () => {
    const stored: RubricCriterionSpec[] = [
      {
        id: "pacing",
        label: "Pacing & Rhythm",
        description: "d",
        source: "spine",
        enabled: true,
        weight: 1,
      },
    ];
    const ids = reconcileSpecs(stored).map((s) => s.id);
    expect(ids).toContain("targetFit");
    expect(ids).toHaveLength(SPINE_CRITERIA.length);
  });

  test("drops a spine criterion that has since been retired", () => {
    const stored: RubricCriterionSpec[] = [
      ...defaultCriteriaSpecs(),
      {
        id: "retired-criterion",
        label: "Retired",
        description: "no longer shipped",
        source: "spine",
        enabled: true,
        weight: 1,
      },
    ];
    expect(reconcileSpecs(stored).map((s) => s.id)).not.toContain(
      "retired-criterion",
    );
  });

  test("preserves the writer's own criteria", () => {
    const specs = reconcileSpecs([...defaultCriteriaSpecs(), custom()]);
    expect(specs.filter((s) => s.source === "custom")).toHaveLength(1);
    expect(specs[specs.length - 1].label).toBe("Stays in second person");
  });

  test("discards a custom criterion with no name", () => {
    const specs = reconcileSpecs([custom({ label: "   " })]);
    expect(specs.filter((s) => s.source === "custom")).toHaveLength(0);
  });

  test("clamps a stored weight that is out of range", () => {
    const specs = reconcileSpecs([custom({ weight: 500 })]);
    expect(specs.find((s) => s.source === "custom")!.weight).toBe(MAX_WEIGHT);
  });
});

describe("activeCustomCriteria", () => {
  test("returns only the writer's criteria that are switched on", () => {
    const specs = [
      ...defaultCriteriaSpecs(),
      custom({ id: "c1" }),
      custom({ id: "c2", enabled: false }),
    ];
    const active = activeCustomCriteria(specs);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("c1");
  });
});

describe("newCustomCriterion", () => {
  test("trims and enables, with a unique id", () => {
    const a = newCustomCriterion("  Name  ", "  What good looks like  ");
    const b = newCustomCriterion("Name", "");
    expect(a.label).toBe("Name");
    expect(a.description).toBe("What good looks like");
    expect(a.enabled).toBe(true);
    expect(a.source).toBe("custom");
    expect(a.id).not.toBe(b.id);
  });
});

describe("weightedCriteriaScore", () => {
  const scores = { targetFit: 8, pacing: 4, thesis: 6, engagement: 10 };

  test("is null when the writer has not customised anything", () => {
    expect(weightedCriteriaScore(defaultCriteriaSpecs(), scores)).toBeNull();
  });

  test("appears once a criterion is reweighted", () => {
    const specs = defaultCriteriaSpecs().map((s) =>
      s.id === "pacing" ? { ...s, weight: 3 } : s,
    );
    expect(weightedCriteriaScore(specs, scores)).not.toBeNull();
  });

  test("appears once the writer adds a criterion of their own", () => {
    const specs = [...defaultCriteriaSpecs(), custom()];
    expect(
      weightedCriteriaScore(specs, { ...scores, "custom-1": 9 }),
    ).not.toBeNull();
  });

  test("weighting a criterion down raises a score it was dragging", () => {
    const heavy = defaultCriteriaSpecs().map((s) =>
      s.id === "pacing" ? { ...s, weight: MAX_WEIGHT } : s,
    );
    const light = defaultCriteriaSpecs().map((s) =>
      s.id === "pacing" ? { ...s, weight: MIN_WEIGHT } : s,
    );
    // pacing is the weakest score in the set, so leaning on it must hurt.
    expect(weightedCriteriaScore(heavy, scores)!).toBeLessThan(
      weightedCriteriaScore(light, scores)!,
    );
  });

  /**
   * "Reader Engagement" is derived from the combined grade, so including it
   * would make this score partly a function of the very number it is meant to
   * stand apart from.
   */
  test("excludes the criterion derived from the combined grade", () => {
    const specs = [...defaultCriteriaSpecs(), custom()];
    const withEngagement = weightedCriteriaScore(specs, {
      ...scores,
      "custom-1": 5,
      engagement: 10,
    });
    const withoutEngagement = weightedCriteriaScore(specs, {
      ...scores,
      "custom-1": 5,
      engagement: 1,
    });
    expect(withEngagement).toBe(withoutEngagement!);
  });

  test("is null when every criterion has been switched off", () => {
    const specs = defaultCriteriaSpecs().map((s) => ({ ...s, enabled: false }));
    expect(weightedCriteriaScore(specs, scores)).toBeNull();
  });
});

describe("the trend line", () => {
  const entry = (at: number, overall: number) => ({
    at,
    overall,
    grade: "C",
    perCriterion: {},
  });

  test("a single pass is not a trend", () => {
    expect(sparklinePoints([entry(1, 50)])).toEqual([]);
    expect(scoreDelta([entry(1, 50)])).toBeNull();
  });

  test("scales to the observed range so small movement stays visible", () => {
    const points = sparklinePoints([entry(1, 60), entry(2, 65), entry(3, 70)]);
    expect(points[0].y).toBe(0);
    expect(points[2].y).toBe(1);
    expect(points[1].y).toBeCloseTo(0.5, 5);
  });

  test("does not divide by zero when every pass scored the same", () => {
    const points = sparklinePoints([entry(1, 60), entry(2, 60)]);
    expect(points.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  test("reports the change since the previous pass", () => {
    expect(scoreDelta([entry(1, 60), entry(2, 67)])).toBe(7);
    expect(scoreDelta([entry(1, 67), entry(2, 60)])).toBe(-7);
  });
});
