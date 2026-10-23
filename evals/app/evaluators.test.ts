/**
 * Jev and Clairic as evaluators, suite by suite, against a recording fake:
 * what each suite asks, what it is allowed to see, and how the answers
 * become scores. The real models are exercised by `--jev` runs; these pin
 * the design, including that the blind readings never see the app's
 * verdicts or the corpus' answer key.
 */
import { describe, expect, test } from "bun:test";
import {
  askJev,
  BRIEF_FIELDS,
  jevComposite,
  jevNot,
  jevShare,
  judgeWeaknessRecall,
  type ClairicAsk,
  type JevAsk,
  type Judge,
} from "./judges";
import { runAppEvals } from "./run";
import { dossierSuite, type DossierCase } from "./suites/dossier";
import {
  interviewSuite,
  transcript,
  type InterviewCase,
} from "./suites/interview";
import { rewriteSuite } from "./suites/rewrite";
import { rubricSuite } from "./suites/rubric";
import type { ScoredCase } from "./suites/types";

type JevRequest = Parameters<JevAsk>[0];

/** A Jev that answers every Noul with `noul(id)` and every Score at `level(id)`. */
function fakeJev(
  options: {
    noul?: (id: string) => number;
    level?: (id: string) => number;
  } = {},
) {
  const requests: JevRequest[] = [];
  const ask: JevAsk = async (request) => {
    requests.push(request);
    return {
      ok: true,
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, q]) => {
          if (q.type === "noul")
            return [id, { type: "noul", noul: options.noul?.(id) ?? 0.9 }];
          const levels = q.criteria ?? [];
          const level = options.level?.(id) ?? levels.length - 1;
          return [
            id,
            {
              type: "score",
              score: level,
              confidence: 0.8,
              legend: Object.fromEntries(
                levels.map((text, i) => [String(i), text]),
              ),
              probabilities: { [String(level)]: 1 },
            },
          ];
        }),
      ),
    };
  };
  return { ask, requests };
}

const brief = (answers: Record<string, string>) => ({
  answers,
  attachments: [],
  completedAt: 1,
  updatedAt: 1,
});

describe("shared readers", () => {
  test("jevShare is the expected share of items, with items kept", () => {
    const share = jevShare(
      { a: { score: 0.9 }, b: { score: 0.3 } },
      { w1: "a", w2: "b" },
    );
    expect(share.score).toBeCloseTo(0.6, 10);
    expect(share.items).toEqual({ w1: 0.9, w2: 0.3 });
    expect(share.label).toBe("jev 1 of 2");
    expect(jevShare({}, {}).score).toBe(1);
    expect(
      jevShare({ a: { score: null, label: "jev-error" } }, { w1: "a" }).label,
    ).toBe("jev-error");
  });

  test("partial Jev shares retain expected items and every error without a partial score", () => {
    for (const invert of [false, true]) {
      const share = jevShare(
        {
          a: { score: 0.9 },
          b: { score: null, label: "jev-error", explanation: "rate limited" },
          d: { score: Number.NaN },
        },
        { w1: "a", w2: "b", w3: "missing", w4: "d" },
        { invert },
      );
      expect(share.score).toBeNull();
      expect(share.label).toBe("jev-error");
      expect(share.expectedItems).toEqual(["w1", "w2", "w3", "w4"]);
      expect(share.items!.w1).toBeCloseTo(invert ? 0.1 : 0.9);
      expect(Object.keys(share.itemErrors)).toEqual(["w2", "w3", "w4"]);
      expect(share.itemErrors.w2).toBe("rate limited");
      expect(share.explanation).toContain("1 of 4 items scored");
    }
    const failed = jevShare({}, { w1: "a", w2: "b" });
    expect(failed.items).toEqual({});
    expect(failed.expectedItems).toHaveLength(2);
    expect(Object.keys(failed.itemErrors)).toHaveLength(2);
  });

  test("a composite needs every part, and a Noul can be inverted", () => {
    expect(
      jevComposite([
        [{ score: 1 }, 1],
        [{ score: 0 }, 3],
      ]).score,
    ).toBeCloseTo(0.25, 10);
    expect(
      jevComposite([
        [{ score: 1 }, 1],
        [{ score: null }, 1],
      ]).score,
    ).toBeNull();
    expect(jevNot({ score: 0.2 }, "fine", "bad")).toMatchObject({
      score: 0.8,
      label: "fine",
    });
  });

  test("a failed Jev request marks every question jev-error", async () => {
    const answers = await askJev(
      async () => ({ ok: false, error: "rate limited" }),
      {},
      {
        a: { type: "noul", instructions: "?" },
      },
    );
    expect(answers.a).toMatchObject({
      score: null,
      label: "jev-error",
      explanation: "rate limited",
    });
  });

  test("the judge's weakness recall keeps one item per weakness, and a garbled reply is a judge error", async () => {
    const judge = (reply: string): Judge => ({
      label: "fake",
      complete: async () => reply,
    });
    const ok = await judgeWeaknessRecall(
      judge(`{"identified": [1, 3], "explanation": "two"}`),
      {
        draft: "d",
        weaknesses: ["a", "b", "c"],
        feedback: "f",
      },
    );
    expect(ok.score).toBeCloseTo(2 / 3, 10);
    expect(ok.items).toEqual({ w1: 1, w2: 0, w3: 1 });
    const garbled = await judgeWeaknessRecall(judge("I think the first one."), {
      draft: "d",
      weaknesses: ["a"],
      feedback: "f",
    });
    expect(garbled).toMatchObject({ score: null, label: "judge-error" });
  });
});

describe("rubric", () => {
  const [strong, weak] = rubricSuite.load().slice(0, 2);
  const grade = (combined: number) => ({
    grade: "B",
    combined,
    judges: ["devil", "angel", "scholar", "editor", "reader"].map(
      (personaId) => ({
        personaId,
        score: 7,
        rationale: "THE APP'S OWN VERDICT",
        provider: "rivet",
      }),
    ),
    sufficiency: {
      score: 7,
      rationale: "THE APP'S OWN VERDICT",
      provider: "rivet",
    },
    evidence: {
      score: 7,
      rationale: "THE APP'S OWN VERDICT",
      provider: "rivet",
    },
    integrity: {
      score: 7,
      rationale: "THE APP'S OWN VERDICT",
      provider: "rivet",
    },
    targetFit: {
      score: 7,
      rationale: "THE APP'S OWN VERDICT",
      provider: "rivet",
    },
    review: { text: "THE APP'S OWN VERDICT", provider: "rivet" },
    unjudged: [],
  });

  test("Jev reads the four dimensions blind, and checks each planted weakness against the feedback", async () => {
    expect(weak.quality).toBe("weak");
    const jev = fakeJev({
      level: () => 2,
      noul: (id) => (id === "named_w1" ? 0.9 : 0.1),
    });
    const scores = await rubricSuite.score(
      { judge: null, jev: jev.ask, extract: null },
      weak,
      grade(40),
    );
    for (const key of [
      "jev_sufficiency",
      "jev_evidence",
      "jev_integrity",
      "jev_target_fit",
    ])
      expect(scores[key].score).toBeCloseTo(2 / 3, 10);
    expect(scores.jev_quality.score).toBeCloseTo(2 / 3, 10);
    const recall = scores.jev_weakness_recall;
    expect(Object.keys(recall.items ?? {})).toEqual(
      weak.weaknesses!.map((_, i) => `w${i + 1}`),
    );
    expect(recall.items?.w1).toBe(0.9);

    const [blind, named] = jev.requests;
    expect(Object.keys(blind.state).sort()).toEqual([
      "audience",
      "draft",
      "format",
      "goal",
      "successSignal",
    ]);
    expect(JSON.stringify(blind.state)).not.toContain("THE APP'S OWN VERDICT");
    expect(named.state.feedback).toContain("THE APP'S OWN VERDICT");
    expect(jev.requests).toHaveLength(2);
  });

  test("a strong draft gets one request, and the pair is ordered by Jev's composite", async () => {
    const better = fakeJev({ level: () => 3 });
    const worse = fakeJev({ level: () => 1 });
    const results: Array<ScoredCase<typeof strong>> = [
      {
        case: strong,
        raw: grade(80),
        scores: await rubricSuite.score(
          { judge: null, jev: better.ask, extract: null },
          strong,
          grade(80),
        ),
      },
      {
        case: weak,
        raw: grade(40),
        scores: await rubricSuite.score(
          { judge: null, jev: worse.ask, extract: null },
          weak,
          grade(40),
        ),
      },
    ];
    expect(better.requests).toHaveLength(1);
    rubricSuite.scoreAll!(results);
    expect(results[0].scores.jev_pair_order).toMatchObject({
      score: 1,
      label: "ordered",
      sharedByCluster: true,
    });
    expect(results[1].scores.pair_order.sharedByCluster).toBe(true);
  });
});

describe("rewrite", () => {
  const testCase = rewriteSuite.load().find((c) => c.mustPreserve.length >= 2)!;

  test("rewrites of one draft share a cluster", () => {
    const all = rewriteSuite.load();
    const salt = all.filter((c) => c.case_id.startsWith("rewrite-salt-"));
    expect(salt.length).toBeGreaterThan(1);
    expect(new Set(salt.map((c) => c.cluster)).size).toBe(1);
    expect(
      all.find((c) => c.case_id === "rewrite-oped-bloat-paragraph")!.cluster,
    ).not.toBe(salt[0].cluster);
  });

  test("the judge's one word becomes parts, weighed in code", async () => {
    const jev = fakeJev({
      level: (id) => (id === "jev_fixes_problem" ? 3 : 1),
      noul: (id) => (id === "invents" ? 0.2 : id === "fits" ? 0.7 : 0.95),
    });
    const replacement = `${testCase.mustPreserve.join(", ")} — rewritten.`;
    const scores = await rewriteSuite.score(
      { judge: null, jev: jev.ask, extract: null },
      testCase,
      {
        replacement,
        provider: "rivet",
      },
    );
    expect(scores.jev_fixes_problem.score).toBe(1);
    expect(scores.jev_keeps_meaning.score).toBeCloseTo(1 / 3, 10);
    expect(scores.jev_no_invention).toMatchObject({
      label: "nothing invented",
    });
    expect(scores.jev_no_invention.score).toBeCloseTo(0.8, 10);
    expect(scores.jev_fits_context).toMatchObject({
      score: 0.7,
      label: "fits",
    });
    expect(scores.jev_rewrite.score).toBeCloseTo(
      0.5 * 1 + 0.3 * (1 / 3) + 0.2 * 0.7,
      10,
    );
    expect(Object.keys(scores.jev_keeps_facts.items ?? {})).toEqual(
      testCase.mustPreserve.map((_, i) => `f${i + 1}`),
    );
    expect(Object.keys(scores.preserves_facts.items ?? {})).toEqual(
      testCase.mustPreserve.map((_, i) => `f${i + 1}`),
    );
    // Invention is judged against the whole draft.
    expect(jev.requests[0].state.draft).toBe(testCase.draftText);
  });

  test("no replacement scores zero without asking Jev", async () => {
    const jev = fakeJev();
    const scores = await rewriteSuite.score(
      { judge: null, jev: jev.ask, extract: null },
      testCase,
      {},
    );
    expect(scores.jev_rewrite).toMatchObject({ score: 0, label: "absent" });
    expect(jev.requests).toHaveLength(0);
  });
});

describe("dossier", () => {
  const cases = dossierSuite.load();
  const compost = cases.find(
    (c) => c.case_id === "dossier-goal-compost-pilot",
  ) as DossierCase;
  const observations = [
    {
      field: "goal",
      current: "never asks residents to sign up",
      suggested: "ask",
      reason: "the goal is sign-ups",
    },
    {
      field: "workingTitle",
      current: "reads as a history",
      suggested: "retitle",
      reason: "the title promises a call to join",
    },
  ];
  const clairic = (max: number | null, min: number | null = null) => {
    const requests: Array<Parameters<ClairicAsk>[0]> = [];
    const ask: ClairicAsk = async (request) => {
      requests.push(request);
      return {
        ok: true,
        answers: {
          max_words: {
            type: "number",
            value: max,
            p_null: max === null ? 0.9 : 0.01,
          },
          min_words: {
            type: "number",
            value: min,
            p_null: min === null ? 0.9 : 0.01,
          },
        },
      };
    };
    return { ask, requests };
  };

  test("field names are checked both ways, and Jev's precision request never sees the planted drifts", async () => {
    const jev = fakeJev({
      noul: (id) => (id === "claims_overrun" ? 0.1 : 0.9),
    });
    const scores = await dossierSuite.score(
      { judge: null, jev: jev.ask, extract: clairic(600).ask },
      compost,
      { observations, provider: "rivet" },
    );
    expect(scores.field_precision.score).toBe(0.5);
    expect(scores.jev_obs_supported.items).toEqual({ o1: 0.9, o2: 0.9 });
    expect(Object.keys(scores.jev_drift_recall.items ?? {})).toHaveLength(
      compost.drifts.length,
    );
    const blind = jev.requests.find((r) => "draft" in r.state)!;
    const keyed = jev.requests.find((r) => "drift1" in r.state)!;
    for (const drift of compost.drifts)
      expect(JSON.stringify(blind.state)).not.toContain(
        drift.issue.slice(0, 40),
      );
    expect(JSON.stringify(blind.state)).not.toContain("retitle");
    expect(keyed.state.drift1).toBe(compost.drifts[0].issue);
  });

  test("a claimed overrun is checked against the word count, not the answer key", async () => {
    const words = compost.draftText.trim().split(/\s+/).length;
    const quiet = await dossierSuite.score(
      {
        judge: null,
        jev: fakeJev({ noul: (id) => (id === "claims_overrun" ? 0.1 : 0.9) })
          .ask,
        extract: clairic(600).ask,
      },
      compost,
      { observations, provider: "rivet" },
    );
    expect(words).toBeLessThan(600);
    expect(quiet.length_claims).toMatchObject({
      score: 1,
      label: "no false claim",
    });
    expect(quiet.length_claims.explanation).toContain(
      "claim an overrun the count does not show",
    );

    const claimed = await dossierSuite.score(
      {
        judge: null,
        jev: fakeJev({ noul: () => 0.9 }).ask,
        extract: clairic(500).ask,
      },
      compost,
      { observations, provider: "rivet" },
    );
    expect(claimed.length_claims).toMatchObject({
      score: 1,
      label: "caught overrun",
    });

    const falseAlarm = await dossierSuite.score(
      {
        judge: null,
        jev: fakeJev({ noul: () => 0.9 }).ask,
        extract: clairic(null).ask,
      },
      compost,
      { observations, provider: "rivet" },
    );
    expect(falseAlarm.length_claims).toMatchObject({
      score: 0,
      label: "false overrun",
    });
  });

  test("an aligned draft: nothing to find, and every observation is off target", async () => {
    const aligned = cases.find((c) => c.drifts.length === 0);
    if (!aligned) return;
    const scores = await dossierSuite.score(
      { judge: null, jev: null, extract: null },
      aligned,
      {
        observations,
        provider: "rivet",
      },
    );
    expect(scores.drift_recall).toMatchObject({
      score: 1,
      label: "nothing to find",
    });
    expect(scores.field_precision.score).toBe(0);
  });
});

describe("interview", () => {
  const cases = interviewSuite.load();
  const terse = cases.find(
    (c) => c.case_id === "iv-complete-terse",
  ) as InterviewCase;
  const refine = cases.find((c) => c.mode === "refine") as InterviewCase;

  /** Clairic that "finds" each field at a given span of the transcript. */
  const clairic = (
    spans: Partial<Record<string, [number, number]>>,
    text: string,
  ) => {
    const ask: ClairicAsk = async (request) => ({
      ok: true,
      answers: Object.fromEntries(
        Object.keys(request.fields).map((field) => {
          const span = spans[field];
          return [
            field,
            span
              ? {
                  type: "text",
                  value: text.slice(span[0], span[1]),
                  p_null: 0.05,
                  confidence: 0.6,
                  span,
                }
              : { type: "text", value: null, p_null: 0.95, span: null },
          ];
        }),
      ),
    });
    return ask;
  };

  test("the transcript is the answer key, and a span in the interviewer's line does not count", async () => {
    const { text, turns } = transcript(terse.messages);
    const writerTurn = turns.find((t) => t.author === "writer")!;
    const interviewerTurn = turns.find((t) => t.author === "interviewer")!;
    const spans = {
      audience: [writerTurn.start, writerTurn.start + 10] as [number, number],
      constraints: [interviewerTurn.start, interviewerTurn.start + 8] as [
        number,
        number,
      ],
    };
    const turn = {
      kind: "question",
      text: "What next?",
      draft: { brief: { audience: "readers", tone: "warm" } },
      provider: "rivet",
    };
    const scores = await interviewSuite.score(
      {
        judge: null,
        jev: fakeJev({ noul: () => 0.1 }).ask,
        extract: clairic(spans, text),
      },
      terse,
      turn,
    );
    expect(scores.clairic_field_recall).toMatchObject({ score: 1 });
    expect(scores.clairic_field_recall.items?.audience).toBeCloseTo(0.95, 10);
    expect(scores.clairic_field_recall.items?.constraints).toBe(0);
    // tone was filed but Clairic finds the writer never stated it.
    expect(scores.clairic_field_support.score).toBe(0.5);
    expect(scores.clairic_field_support.explanation).toContain("tone");
    expect(Object.keys(scores.jev_field_recall.items ?? {})).toEqual([
      ...BRIEF_FIELDS,
    ]);
    expect(scores.jev_no_repeat.score).toBeCloseTo(0.9, 10);
  });

  test("Jev's stated-field reading is blind to the filed dossier, and refine mode counts the brief on file", async () => {
    const jev = fakeJev();
    const filed = {
      ...refine.currentBrief!.answers,
      tone: "Blunt and personal",
    } as Record<string, string>;
    await interviewSuite.score(
      { judge: null, jev: jev.ask, extract: null },
      refine,
      {
        kind: "question",
        text: "What replaces evidence-led?",
        draft: { brief: filed },
        provider: "rivet",
      },
    );
    const blind = jev.requests.find((r) => "stated_tone" in r.questions)!;
    const record = jev.requests.find((r) =>
      Object.keys(r.questions).some((q) => q.startsWith("faithful_")),
    )!;
    expect(Object.keys(blind.state).sort()).toEqual([
      "conversation",
      "question",
    ]);
    // Only the field that changed is checked, against the conversation and the brief on file.
    expect(Object.keys(record.questions)).toEqual(["faithful_tone"]);
    expect(record.state.brief_on_file).toContain("tone:");
  });

  test("a synthesis turn has no question to rate", async () => {
    const jev = fakeJev();
    const scores = await interviewSuite.score(
      { judge: null, jev: jev.ask, extract: null },
      terse,
      {
        kind: "synthesis",
        text: "Done.",
        brief: { workingTitle: "Genji" },
        provider: "rivet",
      },
    );
    expect(scores.jev_question_value).toBeUndefined();
    expect(jev.requests.some((r) => "question" in r.state)).toBe(false);
  });
});

test("--jev, --baseline and --repeat end to end on the scripted model", async () => {
  const options = {
    suites: ["rewrite" as const],
    target: "local" as const,
    model: "mock" as const,
    driver: "mcp" as const,
    judge: "none" as const,
    jev: true,
    limit: 2,
    concurrency: 1,
    arize: false,
    trace: false,
    project: "twyne-app-evals",
    env: {},
    log: () => {},
  };
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "twyne-evals-"));
  try {
    const [first] = await runAppEvals({
      ...options,
      out: dir,
      experiment: "base",
    });
    expect(first.jev).toBe(true);
    expect(first.summary.jev_rewrite.n).toBe(2);
    expect(first.summary.contract.ci).toHaveLength(2);
    expect(first.cases.every((c) => typeof c.cluster === "string")).toBe(true);
    expect(first.agreement?.some((a) => a.name === "fact kept, per fact")).toBe(
      true,
    );

    const rounds = await runAppEvals({
      ...options,
      out: dir,
      experiment: "next",
      repeat: 2,
      baseline: [join(dir, "base-rewrite.json")],
    });
    expect(rounds.map((r) => r.experiment)).toEqual([
      "next-rewrite-r1",
      "next-rewrite-r2",
    ]);
    const last = rounds[1];
    expect(last.repeatability?.find((r) => r.metric === "contract")?.runs).toBe(
      2,
    );
    expect(last.comparison?.pairedCases).toBe(2);
    // The scripted model is deterministic: nothing moves.
    expect(last.comparison?.metrics.every((m) => m.flag === null)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
