import { describe, expect, test } from "bun:test";
import { SPINE_CRITERIA, type RubricCriterionSpec } from "../types";
import { defaultCriteriaSpecs } from "./rubric-criteria";
import {
  DEFAULT_THRESHOLDS,
  SCORE_LEVELS,
  buildRubricQuestions,
  buildRubricState,
  driftedKeys,
  gradeScores,
  readRubricAnswers,
  runRubricPass,
  viewRubricGrade,
  type JudgementCaller,
  type RubricGrade,
} from "./rubric-grade";
import type { ScoreAnswer, SystemOneAnswer } from "./system-one";

const answer = (
  value: number,
  confidence: number,
  probabilities?: Record<string, number>,
): ScoreAnswer => ({
  type: "score",
  score: value,
  legend: Object.fromEntries(SCORE_LEVELS.map((l, i) => [String(i), l])),
  probabilities: probabilities ?? { "0": 0, "1": 0, "2": 1, "3": 0, "4": 0 },
  confidence,
});

const gradeOf = (answers: Record<string, SystemOneAnswer>): RubricGrade =>
  readRubricAnswers(answers, {
    model: "jev-1.13.0",
    usage: { input_tokens: 1401, output_tokens: 300 },
  });

describe("buildRubricQuestions", () => {
  test("one Score per enabled criterion", () => {
    const questions = buildRubricQuestions(defaultCriteriaSpecs());
    for (const q of Object.values(questions)) {
      expect(q.type).toBe("score");
      expect(q.criteria).toEqual(SCORE_LEVELS);
    }
  });

  test("excludes engagement, which is derived from the grade it would feed", () => {
    expect(
      buildRubricQuestions(defaultCriteriaSpecs()).engagement,
    ).toBeUndefined();
  });

  test("skips disabled criteria so the writer is not billed for them", () => {
    const specs = defaultCriteriaSpecs().map((s) =>
      s.id === "pacing" ? { ...s, enabled: false } : s,
    );
    expect(buildRubricQuestions(specs).pacing).toBeUndefined();
    expect(buildRubricQuestions(specs).thesis).toBeDefined();
  });

  test("covers the shipped spine apart from engagement", () => {
    const questions = buildRubricQuestions(defaultCriteriaSpecs());
    const expected = SPINE_CRITERIA.filter((c) => c.id !== "engagement").length;
    expect(Object.keys(questions).length).toBe(expected);
  });

  test("includes the writer's own criteria", () => {
    const custom: RubricCriterionSpec = {
      id: "custom-1",
      label: "Second person",
      description: "Stays in second person throughout",
      source: "custom",
      enabled: true,
      weight: 1,
    };
    expect(
      buildRubricQuestions([...defaultCriteriaSpecs(), custom])["custom-1"],
    ).toBeDefined();
  });
});

describe("buildRubricState", () => {
  test("keeps the brief separate from the draft", () => {
    const state = buildRubricState({
      draft: "the draft",
      audience: "tax lawyers",
      goal: "persuade",
    });
    expect(state.draft).toBe("the draft");
    expect(state.audience).toBe("tax lawyers");
  });

  test("omits absent brief fields rather than sending empty strings", () => {
    expect(buildRubricState({ draft: "d" })).toEqual({ draft: "d" });
  });
});

describe("readRubricAnswers", () => {
  test("rescales levels onto the rubric's 0-10", () => {
    const grade = gradeOf({ thesis: answer(4, 0.9) });
    expect(grade.criteria.thesis.score).toBe(10);
    expect(grade.criteria.thesis.level).toBe(4);
  });

  test("keeps the whole distribution, not just the scalar", () => {
    const probabilities = { "0": 0.21, "1": 0.16, "2": 0.63 };
    const grade = gradeOf({ voice: answer(1.43, 0.14, probabilities) });
    expect(grade.criteria.voice.probabilities).toEqual(probabilities);
    expect(grade.criteria.voice.bimodal).toBe(true);
    expect(grade.criteria.voice.modal).toBe(2);
  });

  test("skips a non-Score answer rather than coercing it", () => {
    const grade = gradeOf({
      thesis: answer(3, 0.8),
      stray: { type: "noul", noul: 0.9 },
    });
    expect(grade.criteria.stray).toBeUndefined();
    expect(grade.criteria.thesis).toBeDefined();
  });

  test("records what the pass cost", () => {
    expect(gradeOf({ thesis: answer(2, 0.5) }).costUsd).toBeCloseTo(
      0.0000588,
      7,
    );
  });
});

describe("viewRubricGrade", () => {
  const grade = gradeOf({
    thesis: answer(4, 0.95), // 10/10, confident
    evidence: answer(0, 0.87), // 0/10, confident
    targetFit: answer(1.2, 0.43), // 3/10, unsure
  });
  const specs = defaultCriteriaSpecs();

  test("sorts scores into the writer's bands", () => {
    const views = viewRubricGrade(grade, specs);
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    expect(byId.thesis.verdict).toBe("strong");
    expect(byId.evidence.verdict).toBe("weak");
  });

  test("flags the unsure criterion for escalation, not the confident ones", () => {
    const views = viewRubricGrade(grade, specs);
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    // Confidence tracks objectivity: the subjective criterion is the one
    // worth spending a frontier call on.
    expect(byId.targetFit.escalate).toBe(true);
    expect(byId.thesis.escalate).toBe(false);
    expect(byId.evidence.escalate).toBe(false);
  });

  test("marks below-floor criteria instead of dropping them silently", () => {
    const views = viewRubricGrade(grade, specs, {
      ...DEFAULT_THRESHOLDS,
      confidenceFloor: 0.5,
    });
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    expect(byId.targetFit).toBeDefined();
    expect(byId.targetFit.belowFloor).toBe(true);
    expect(byId.thesis.belowFloor).toBe(false);
  });

  test("omits criteria the writer disabled", () => {
    const disabled = specs.map((s) =>
      s.id === "thesis" ? { ...s, enabled: false } : s,
    );
    const ids = viewRubricGrade(grade, disabled).map((v) => v.id);
    expect(ids).not.toContain("thesis");
    expect(ids).toContain("evidence");
  });

  test("carries the writer's weight through for display", () => {
    const heavy = specs.map((s) =>
      s.id === "thesis" ? { ...s, weight: 2.5 } : s,
    );
    const view = viewRubricGrade(grade, heavy).find((v) => v.id === "thesis");
    expect(view?.weight).toBe(2.5);
  });

  /**
   * Verification step 11. This is the property the whole caching design exists
   * to protect: a threshold slider must re-render from the cached pass alone.
   * If this function ever becomes async or takes a client, a drag starts
   * firing network requests and costing money per pixel.
   */
  test("re-renders from cache alone when a threshold moves", () => {
    const frozen = JSON.stringify(grade);
    // targetFit sits at 3/10: flagged weak by the shipped default, unremarkable
    // once the writer decides only 2 and under is a weakness worth naming.
    const shipped = viewRubricGrade(grade, specs, DEFAULT_THRESHOLDS);
    const relaxed = viewRubricGrade(grade, specs, {
      ...DEFAULT_THRESHOLDS,
      weakAtOrBelow: 2,
    });

    // Different output...
    expect(shipped.find((v) => v.id === "targetFit")?.verdict).toBe("weak");
    expect(relaxed.find((v) => v.id === "targetFit")?.verdict).toBe("middling");
    // ...from an untouched cache.
    expect(JSON.stringify(grade)).toBe(frozen);
  });

  test("is synchronous, so a slider cannot await it", () => {
    expect(viewRubricGrade(grade, specs)).toBeInstanceOf(Array);
  });
});

describe("gradeScores", () => {
  test("feeds the existing weighted score without a second implementation", () => {
    const grade = gradeOf({ thesis: answer(4, 0.9), evidence: answer(2, 0.8) });
    expect(gradeScores(grade)).toEqual({ thesis: 10, evidence: 5 });
  });
});

describe("driftedKeys", () => {
  test("says nothing when the writer has not tuned anything", () => {
    expect(driftedKeys(DEFAULT_THRESHOLDS)).toEqual([]);
  });

  test("names each knob that has moved", () => {
    expect(
      driftedKeys({
        ...DEFAULT_THRESHOLDS,
        escalateBelow: 0.8,
        weakAtOrBelow: 2,
      }).sort(),
    ).toEqual(["escalateBelow", "weakAtOrBelow"]);
  });
});

describe("runRubricPass", () => {
  const draft = { draft: "A real draft.", audience: "readers", goal: "argue" };

  /** Answers every question the caller asked, so ids always line up. */
  const responder =
    (
      over: Partial<Awaited<ReturnType<JudgementCaller>>> = {},
    ): JudgementCaller =>
    async ({ questions }) => ({
      ok: true,
      model: "jev-1.13.0",
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => [id, answer(2, 0.8)]),
      ),
      usage: { input_tokens: 1401, output_tokens: 162 },
      ...over,
    });

  test("grades every enabled criterion in one call", async () => {
    let calls = 0;
    const ask: JudgementCaller = async (input) => {
      calls += 1;
      return responder()(input);
    };
    const result = await runRubricPass(ask, draft, defaultCriteriaSpecs());
    expect(result.ok).toBe(true);
    // Eleven criteria, one request — the whole economic argument for the tier.
    expect(calls).toBe(1);
    if (!result.ok) return;
    expect(Object.keys(result.grade.criteria)).toHaveLength(
      SPINE_CRITERIA.length - 1, // engagement is derived, never asked
    );
  });

  test("reports the measured cost of a real pass", async () => {
    const result = await runRubricPass(
      responder(),
      draft,
      defaultCriteriaSpecs(),
    );
    if (!result.ok) throw new Error("expected a grade");
    expect(result.grade.costUsd).toBeCloseTo(0.0000588, 7);
    expect(result.grade.model).toBe("jev-1.13.0");
  });

  test("passes the brief through so targetFit can see it", async () => {
    let seen: Record<string, string> = {};
    await runRubricPass(
      async (input) => {
        seen = input.state;
        return responder()(input);
      },
      draft,
      defaultCriteriaSpecs(),
    );
    expect(seen.audience).toBe("readers");
    expect(seen.goal).toBe("argue");
  });

  test("refuses an empty draft without spending a request", async () => {
    let called = false;
    const result = await runRubricPass(
      async (input) => {
        called = true;
        return responder()(input);
      },
      { draft: "   " },
      defaultCriteriaSpecs(),
    );
    expect(result).toEqual({ ok: false, error: "empty draft" });
    expect(called).toBe(false);
  });

  test("refuses when the writer disabled everything", async () => {
    const none = defaultCriteriaSpecs().map((s) => ({ ...s, enabled: false }));
    const result = await runRubricPass(responder(), draft, none);
    expect(result).toEqual({ ok: false, error: "no criteria enabled" });
  });

  test("surfaces the transport's own reason for failing", async () => {
    const result = await runRubricPass(
      async () => ({ ok: false, error: "account not linked" }),
      draft,
      defaultCriteriaSpecs(),
    );
    expect(result).toEqual({ ok: false, error: "account not linked" });
  });

  test("a thrown transport degrades rather than propagating", async () => {
    const result = await runRubricPass(
      async () => {
        throw new Error("socket hang up");
      },
      draft,
      defaultCriteriaSpecs(),
    );
    expect(result).toEqual({ ok: false, error: "unreachable" });
  });

  test("a pass with no answers is a failure, not an empty grade", async () => {
    const result = await runRubricPass(
      async () => ({ ok: true, model: "jev-1.13.0" }),
      draft,
      defaultCriteriaSpecs(),
    );
    expect(result.ok).toBe(false);
  });
});
