/**
 * The statistics behind the reports: intervals, paired comparisons,
 * agreement and repeatability. Pure functions, no app.
 */
import { describe, expect, test } from "bun:test";
import { agreementFor, parseExplained } from "./agreement";
import { experimentRows } from "./arize";
import { averageRuns } from "./reports";
import type { Score } from "./scoring";
import {
  auc,
  benjaminiHochberg,
  clusterSe,
  comparePaired,
  kappa,
  pearson,
  repeatability,
  signFlipP,
  spearman,
  summarizeByFacet,
  summarizeCases,
  summarizeValues,
  tCritical,
  wilson,
  type CaseLike,
} from "./stats";

const caseOf = (
  case_id: string,
  scores: Record<string, number | null>,
  extra: Partial<CaseLike> = {},
): CaseLike => ({
  case_id,
  ok: true,
  scores: Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, { score: v }]),
  ),
  ...extra,
});

describe("intervals", () => {
  test("t critical values", () => {
    expect(tCritical(9)).toBeCloseTo(2.2622, 4);
    expect(tCritical(31)).toBeCloseTo(2.0395, 3);
    expect(tCritical(1000)).toBeCloseTo(1.9623, 3);
  });

  test("Wilson interval at 10/10 and 5/10", () => {
    const [lo, hi] = wilson(1, 10);
    expect(lo).toBeCloseTo(0.722, 3);
    expect(hi).toBe(1);
    const [a, b] = wilson(0.5, 10);
    expect(a).toBeCloseTo(0.237, 3);
    expect(b).toBeCloseTo(0.763, 3);
  });

  test("cluster-robust se is s/√n with one case per cluster", () => {
    const values = [0.2, 0.4, 0.9, 0.5, 0.7];
    const { se, clusters } = clusterSe(
      values,
      values.map((_, i) => `c${i}`),
    );
    const m = values.reduce((a, b) => a + b) / 5;
    const s = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / 4);
    expect(clusters).toBe(5);
    expect(se).toBeCloseTo(s / Math.sqrt(5), 10);
  });

  test("pass/fail cases get the plain Wilson interval", () => {
    const summary = summarizeValues(
      [1, 1, 1, 0, 1, 1, 1, 1, 0, 1].map((value, i) => ({
        value,
        cluster: `${i}`,
      })),
    );
    expect(summary.mean).toBe(0.8);
    expect(summary.method).toBe("wilson");
    expect(summary.ci?.[0]).toBeCloseTo(wilson(0.8, 10)[0], 10);
  });

  test("near the ceiling the interval stays honest", () => {
    // Nine perfect cases and one at 0.8: a t interval claims [0.935, 1].
    const summary = summarizeValues(
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8].map((value, i) => ({
        value,
        cluster: `${i}`,
      })),
    );
    expect(summary.method).toBe("wilson-t");
    expect(summary.ci![0]).toBeLessThan(0.9);
    expect(summary.ci![1]).toBeLessThanOrEqual(1);
  });

  test("clustered cases count as fewer independent units", () => {
    // Four pairs whose two cases always agree: four units, not eight.
    const values = [1, 1, 0, 0, 1, 1, 0, 0];
    const clustered = summarizeValues(
      values.map((value, i) => ({ value, cluster: `p${Math.floor(i / 2)}` })),
    );
    const independent = summarizeValues(
      values.map((value, i) => ({ value, cluster: `${i}` })),
    );
    expect(clustered.clusters).toBe(4);
    expect(clustered.ci![1] - clustered.ci![0]).toBeGreaterThan(
      independent.ci![1] - independent.ci![0],
    );
  });

  test("boundary intervals count clusters even after uneven within-cluster duplication", () => {
    for (const value of [0, 1]) {
      const points = ["a", "b", "c"].map((cluster) => ({ value, cluster }));
      const base = summarizeValues(points);
      const duplicated = summarizeValues([
        ...points,
        ...Array.from({ length: 97 }, () => points[0]),
      ]);
      expect(duplicated.n).toBe(100);
      expect(duplicated.effectiveN).toBe(3);
      expect(duplicated.ci).toEqual(base.ci);
      expect(duplicated.ci).toEqual(wilson(value, 3));
      expect(
        summarizeValues(Array.from({ length: 100 }, () => points[0])).ci,
      ).toBeNull();
    }
  });

  test("scores copied across a pair are counted once per pair", () => {
    const shared = (v: number): Score => ({ score: v, sharedByCluster: true });
    const cases: CaseLike[] = ["a", "b", "c"].flatMap((pair) =>
      ["strong", "weak"].map((q) => ({
        case_id: `rubric-${pair}-${q}`,
        cluster: pair,
        ok: true,
        scores: { pair_order: shared(1), hosted: { score: 1 } },
      })),
    );
    const summary = summarizeCases("rubric", cases);
    expect(summary.pair_order.n).toBe(3);
    expect(summary.hosted.n).toBe(6);
  });

  test("a suite that runs two strategies is also summarised per strategy", () => {
    const cases = [
      caseOf("draft-a:hosted", { recall: 0.4 }),
      caseOf("draft-a:model", { recall: 1 }),
      caseOf("draft-b:hosted", { recall: 0.5 }),
      caseOf("draft-b:model", { recall: 1 }),
    ];
    const by = summarizeByFacet("research-targets", cases, "strategy")!;
    expect(Object.keys(by)).toEqual(["hosted", "model"]);
    expect(by.hosted.recall.mean).toBeCloseTo(0.45, 10);
    expect(by.model.recall.mean).toBe(1);
    expect(
      summarizeByFacet("room", [caseOf("a", { m: 1 })], "strategy"),
    ).toBeNull();
  });

  test("older reports are clustered by their case_id conventions", () => {
    const summary = summarizeCases("research-sources", [
      caseOf("draft-a:c1", { found: 1 }),
      caseOf("draft-a:c2", { found: 0 }),
      caseOf("draft-b:c1", { found: 1 }),
    ]);
    expect(summary.found.clusters).toBe(2);
  });
});

describe("comparing two runs", () => {
  const run = (shift: number, noise: number[]) =>
    noise.map((e, i) =>
      caseOf(`case-${i}`, {
        metric: Math.min(1, Math.max(0, 0.5 + shift + e)),
        flat: 0.7,
      }),
    );
  const noise = [
    0.03, -0.02, 0.05, -0.04, 0.01, 0.02, -0.03, 0.04, -0.01, 0.0, 0.02, -0.02,
  ];

  test("a real shift is flagged, an unchanged metric is not", () => {
    const comparison = comparePaired(
      "room",
      run(0, noise),
      run(
        0.2,
        noise.map((e) => -e / 2),
      ),
    );
    const metric = comparison.metrics.find((m) => m.metric === "metric")!;
    expect(metric.delta).toBeGreaterThan(0.15);
    expect(metric.flag).toBe("up");
    expect(metric.ci![0]).toBeGreaterThan(0);
    expect(
      comparison.metrics.find((m) => m.metric === "flat")!.flag,
    ).toBeNull();
  });

  test("a handful of flipped cases is never beyond noise", () => {
    const base = Array.from({ length: 10 }, (_, i) =>
      caseOf(`c${i}`, { ok: 1 }),
    );
    const next = base.map((c, i) => caseOf(c.case_id, { ok: i < 4 ? 0 : 1 }));
    const metric = comparePaired("room", base, next).metrics[0];
    expect(metric.p).toBeCloseTo(2 / 16, 10);
    expect(metric.flag).toBeNull();
  });

  test("only cases present in both runs are paired, and the interval stays in −1..1", () => {
    const base = [
      caseOf("a", { m: 1 }),
      caseOf("b", { m: 1 }),
      caseOf("x", { m: 1 }),
    ];
    const next = [
      caseOf("a", { m: 0 }),
      caseOf("b", { m: 1 }),
      caseOf("y", { m: 0 }),
    ];
    const comparison = comparePaired("room", base, next);
    expect(comparison.pairedCases).toBe(2);
    expect(comparison.onlyBase).toBe(1);
    expect(comparison.onlyNext).toBe(1);
    const [lo, hi] = comparison.metrics[0].ci!;
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
  });

  test("sign-flip p-values", () => {
    expect(signFlipP([1, 1, 1])).toBeCloseTo(0.25, 10);
    expect(signFlipP([1, 1, 1, 1, 1, 1])).toBeCloseTo(2 / 64, 10);
    expect(signFlipP([0, 0])).toBe(1);
    expect(signFlipP([1, -1, 1, -1])).toBe(1);
  });

  test("Benjamini-Hochberg", () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, null, 0.2]);
    // Four p-values: 0.01 → 0.04; 0.03 and 0.04 → min(0.06, 0.0533) = 0.0533.
    expect(q[0]).toBeCloseTo(0.04, 10);
    expect(q[2]).toBeCloseTo((0.04 * 4) / 3, 10);
    expect(q[1]).toBeCloseTo((0.04 * 4) / 3, 10);
    expect(q[3]).toBeNull();
    expect(q[4]).toBeCloseTo(0.2, 10);
  });

  test("several runs of a baseline are averaged per case", () => {
    const merged = averageRuns([
      { suite: "room", cases: [caseOf("a", { m: 1 }), caseOf("b", { m: 0 })] },
      {
        suite: "room",
        cases: [caseOf("a", { m: 0.5 }), caseOf("b", { m: null })],
      },
    ]);
    expect(merged.find((c) => c.case_id === "a")!.scores.m.score).toBe(0.75);
    expect(merged.find((c) => c.case_id === "b")!.scores.m.score).toBe(0);
  });
});

describe("repeatability", () => {
  test("separates run-to-run noise from differences between cases", () => {
    const runs = [
      [
        caseOf("a", { m: 0.2 }),
        caseOf("b", { m: 0.8 }),
        caseOf("c", { m: 0.5 }),
      ],
      [
        caseOf("a", { m: 0.3 }),
        caseOf("b", { m: 0.7 }),
        caseOf("c", { m: 0.5 }),
      ],
      [
        caseOf("a", { m: 0.25 }),
        caseOf("b", { m: 0.75 }),
        caseOf("c", { m: 0.4 }),
      ],
    ];
    const [row] = repeatability(runs);
    expect(row.cases).toBe(3);
    expect(row.runMeans).toHaveLength(3);
    expect(row.withinCaseSd!).toBeGreaterThan(0);
    expect(row.icc!).toBeGreaterThan(0.8);
  });
});

describe("agreement", () => {
  test("correlation, kappa and AUC", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 10);
    expect(kappa([1, 0, 1, 0], [1, 0, 1, 0]).kappa).toBe(1);
    expect(auc([0.9, 0.8], [0.1, 0.85])).toBeCloseTo(0.75, 10);
  });

  test("per-note readings are recovered from explanations", () => {
    expect(
      parseExplained(
        "devil: level 5; angel: level 3",
        (l) => (Number(l.split(" ")[1]) - 1) / 4,
      ),
    ).toEqual({
      devil: 1,
      angel: 0.5,
    });
  });

  test("the rubric's evaluators are compared on shared cases, with AUC against the planted answer", () => {
    const grade = (combined: number, evidence: number) => ({
      combined,
      evidence: { score: evidence },
    });
    const cases: CaseLike[] = [
      {
        case_id: "rubric-a-strong",
        cluster: "a",
        scores: { jev_quality: { score: 0.8 }, jev_evidence: { score: 0.7 } },
        raw: grade(78, 8),
      },
      {
        case_id: "rubric-a-weak",
        cluster: "a",
        scores: { jev_quality: { score: 0.3 }, jev_evidence: { score: 0.2 } },
        raw: grade(35, 3),
      },
      {
        case_id: "rubric-b-strong",
        cluster: "b",
        scores: { jev_quality: { score: 0.7 }, jev_evidence: { score: 0.6 } },
        raw: grade(70, 7),
      },
      {
        case_id: "rubric-b-weak",
        cluster: "b",
        scores: { jev_quality: { score: 0.4 } },
        raw: grade(40, 4),
      },
    ];
    const results = agreementFor("rubric", cases);
    const quality = results.find((r) => r.name === "draft quality")!;
    expect(quality.n).toBe(4);
    expect(quality.pairs[0].pearson!).toBeGreaterThan(0.9);
    expect(quality.gold!.auc["jev_quality"]).toBe(1);
    // One case has no Jev evidence reading: common support only.
    expect(results.find((r) => r.name === "evidence")!.n).toBe(3);
  });

  test("item-level constructs join the same items across evaluators", () => {
    const cases: CaseLike[] = [
      {
        case_id: "rubric-a-weak",
        scores: {
          weakness_recall: { score: 0.5, items: { w1: 1, w2: 0 } },
          jev_weakness_recall: { score: 0.5, items: { w1: 0.9, w2: 0.2 } },
        },
      },
    ];
    const item = agreementFor("rubric", cases).find((r) => r.level === "item")!;
    expect(item.n).toBe(2);
    expect(item.pairs[0].agree).toBe(1);
  });
});

describe("the Arize upload stays rectangular", () => {
  test("scores are numbers in every row and labels never read as numbers", () => {
    const { rows } = experimentRows([
      {
        example_id: "e1",
        output: "x",
        ok: true,
        scores: {
          jev_rewrite: { score: 0.7, label: "jev pass" },
          jev_fixes_problem: {
            score: 0.66,
            label: "level 2.0",
            explanation: "Jev confidence 0.40",
          },
          jev_keeps_facts: {
            score: 1,
            label: "jev 2 of 2",
            items: { f1: 0.9, f2: 0.95 },
          },
        },
        metadata: { case_id: "a" },
      },
      {
        example_id: "e2",
        output: "",
        ok: false,
        error: "boom",
        scores: {},
        metadata: { case_id: "b" },
      },
    ]);
    for (const row of rows)
      for (const [key, value] of Object.entries(row)) {
        if (key.endsWith(".score")) expect(typeof value).toBe("number");
        if (key.endsWith(".label"))
          expect(Number.isNaN(Number(value)) || value === "").toBe(true);
      }
    expect(Object.keys(rows[0]).some((k) => k.includes("items"))).toBe(false);
  });
});

describe("conditional quality denominators", () => {
  const runs = [
    {
      example_id: "good",
      output: "ok",
      ok: true,
      scores: {
        quality: { score: 0.8 },
        optional: { score: null, label: "n/a" },
      },
      metadata: {},
    },
    {
      example_id: "failed",
      output: "",
      ok: false,
      error: "boom",
      scores: { quality: { score: 0 } },
      metadata: {},
    },
  ];
  const cases = runs.map((r) => ({
    ...r,
    case_id: r.example_id,
    scores: { ...r.scores, harness: { score: r.ok ? 1 : 0 } },
  }));

  test("Arize keeps failures separate and nullable quality label-only", () => {
    const { rows, labelOnly } = experimentRows(runs);
    expect(labelOnly.sort()).toEqual(["optional", "quality"]);
    expect(rows.map((r) => r["eval.harness.score"])).toEqual([1, 0]);
    expect(rows.every((r) => !("eval.quality.score" in r))).toBe(true);
    expect(rows[0]["eval.quality.explanation"]).toContain("score=0.8");
    expect(rows[1]["eval.quality.label"]).toBe("execution-error");
    expect(rows[1]["eval.quality.explanation"]).toContain("boom");
    expect(rows[0]["eval.optional.label"]).toBe("unscored");
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
    const complete = experimentRows([
      runs[0],
      { ...runs[0], example_id: "another" },
    ]);
    expect(complete.labelOnly).not.toContain("quality");
    expect(complete.rows.map((r) => r["eval.quality.score"])).toEqual([
      0.8, 0.8,
    ]);
  });

  test("local summaries, comparisons and repeatability exclude failed quality", () => {
    const summary = summarizeCases("room", cases);
    expect(summary.quality).toMatchObject({ mean: 0.8, n: 1 });
    expect(summary.harness).toMatchObject({ mean: 0.5, n: 2 });
    expect(
      comparePaired("room", cases, cases).metrics.find(
        (m) => m.metric === "quality",
      )?.n,
    ).toBe(1);
    expect(
      repeatability([cases, cases]).find((m) => m.metric === "quality")?.cases,
    ).toBe(1);
  });

  test("averaged reports exclude failed quality regardless of run order", () => {
    for (const ordered of [
      [cases[1], cases[0]],
      [cases[0], cases[1]],
    ]) {
      const averaged = averageRuns(
        ordered.map((c) => ({
          suite: "room",
          cases: [{ ...c, case_id: "same" }],
        })),
      );
      expect(averaged[0].ok).toBe(true);
      const summary = summarizeCases("room", averaged);
      expect(summary.quality.mean).toBe(0.8);
      expect(summary.harness.mean).toBe(0.5);
    }
  });
});
