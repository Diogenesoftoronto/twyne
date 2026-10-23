/**
 * The rubric, graded through `twyne_grade_draft` on strong/weak pairs.
 *
 * Each topic has a strong draft and a fluent but padded, hedging, generic
 * one under the same brief. The rubric earns its keep only if it ranks the
 * pair correctly, so ordering is scored per pair and attached to both cases.
 * The judge, when enabled, checks whether the feedback on a weak draft names
 * the weaknesses that were planted in it.
 *
 * With `--jev`, Jev reads every draft on the rubric's own four dimensions,
 * blind to the app's grades, as an independent check of the app's judges;
 * the four readings combine into `jev_quality` and a Jev pair order. On weak
 * drafts Jev also answers, weakness by weakness, the question the LLM judge
 * answers for `weakness_recall`.
 */
import {
  askJev,
  JEV_RUBRIC_QUESTIONS,
  jevComposite,
  jevRubricState,
  jevShare,
  jevWeaknessRequest,
  judged,
  judgeFaithfulness,
  judgeWeaknessRecall,
  type JevAsk,
} from "../judges";
import { pass, ratio, type Score } from "../scoring";
import { readJsonl } from "./load";
import type { ProjectBrief, ScoredCase, Suite } from "./types";

export interface RubricCase {
  case_id: string;
  pair_id: string;
  quality: "strong" | "weak";
  brief: ProjectBrief;
  draftText: string;
  weaknesses?: string[];
}

interface Judgement {
  score: number;
  rationale: string;
  provider?: string;
}

export interface RubricGrade {
  /** Persona judges that returned nothing usable, even after a retry. */
  unjudged?: string[];
  grade?: string;
  combined?: number;
  judgeMean?: number;
  minJudge?: number;
  staticTotal?: number;
  judges?: Array<Judgement & { personaId: string }>;
  sufficiency?: Judgement;
  evidence?: Judgement;
  integrity?: Judgement;
  targetFit?: Judgement;
  review?: { text: string; provider?: string } | null;
}

export const DIMENSIONS = [
  "sufficiency",
  "evidence",
  "integrity",
  "targetFit",
] as const;

/** The Jev question that reads each of the app's dimensions. */
export const JEV_DIMENSION: Record<
  (typeof DIMENSIONS)[number],
  keyof typeof JEV_RUBRIC_QUESTIONS
> = {
  sufficiency: "jev_sufficiency",
  evidence: "jev_evidence",
  integrity: "jev_integrity",
  targetFit: "jev_target_fit",
};

export function gradeOf(raw: unknown): RubricGrade {
  return (raw ?? {}) as RubricGrade;
}

function validJudgement(j: Judgement | undefined): boolean {
  return (
    !!j &&
    Number.isInteger(j.score) &&
    j.score >= 1 &&
    j.score <= 10 &&
    typeof j.rationale === "string" &&
    j.rationale.trim().length > 0
  );
}

function feedbackText(grade: RubricGrade): string {
  return [
    ...(grade.judges ?? []).map((j) => `${j.personaId}: ${j.rationale}`),
    ...DIMENSIONS.map((d) => `${d}: ${grade[d]?.rationale ?? ""}`),
    grade.review?.text ? `Review: ${grade.review.text}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderGrade(grade: RubricGrade): string {
  const judges = (grade.judges ?? [])
    .map((j) => `  ${j.personaId.padEnd(8)} ${j.score}  ${j.rationale}`)
    .join("\n");
  const dims = DIMENSIONS.map(
    (d) =>
      `  ${d.padEnd(11)} ${grade[d]?.score ?? "-"}  ${grade[d]?.rationale ?? ""}`,
  ).join("\n");
  return (
    `Grade ${grade.grade ?? "?"} (combined ${grade.combined ?? "?"}, judges ${grade.judgeMean ?? "?"}, static ${grade.staticTotal ?? "?"})\n` +
    `${judges}\n${dims}` +
    (grade.review?.text ? `\n\n${grade.review.text}` : "")
  );
}

/**
 * Jev's four blind readings, and their equal-weight composite. Equal weights
 * because the app's combined grade does not weight the dimensions either;
 * change them here if the composite should track something else.
 */
async function jevReadings(
  jev: JevAsk,
  testCase: RubricCase,
): Promise<Record<string, Score>> {
  const answers = await askJev(
    jev,
    jevRubricState(testCase.draftText, testCase.brief.answers),
    JEV_RUBRIC_QUESTIONS,
  );
  const scores: Record<string, Score> = {};
  for (const id of Object.keys(JEV_RUBRIC_QUESTIONS)) scores[id] = answers[id];
  scores.jev_quality = jevComposite(
    Object.keys(JEV_RUBRIC_QUESTIONS).map((id) => [answers[id], 1]),
  );
  return scores;
}

export const rubricSuite: Suite<RubricCase> = {
  name: "rubric",
  surface: "MCP twyne_grade_draft",
  load: () => readJsonl<RubricCase>("app/cases/rubric.jsonl"),

  async run({ mcp }, testCase) {
    const raw = await mcp.call("twyne_grade_draft", {
      draftText: testCase.draftText,
      brief: testCase.brief,
    });
    return { raw, output: renderGrade(gradeOf(raw)) };
  },

  async score({ judge, jev }, testCase, raw) {
    const grade = gradeOf(raw);
    const judges = grade.judges ?? [];
    const all: Array<Judgement | undefined> = [
      ...judges,
      ...DIMENSIONS.map((d) => grade[d]),
    ];
    const invalid = all.filter((j) => !validJudgement(j)).length;
    const scores: Record<string, Score> = {
      contract: pass(
        typeof grade.grade === "string" &&
          typeof grade.combined === "number" &&
          judges.length + (grade.unjudged?.length ?? 0) === 5 &&
          invalid === 0,
        invalid ? `${invalid} judgement(s) missing or out of range` : undefined,
      ),
      // Every editor actually read and scored the draft; a gap is reported
      // by the app rather than papered over with a heuristic.
      judged: {
        score: judges.length / 5,
        explanation: grade.unjudged?.length
          ? `unjudged: ${grade.unjudged.join(", ")}`
          : "all five editors scored the draft",
      },
      hosted: {
        score: ratio(
          all.filter((j) => j?.provider && j.provider !== "local").length,
          all.length,
        ),
        explanation:
          "judgements answered by the hosted model, not the local fallback",
      },
      review_present: pass(!!grade.review?.text?.trim()),
    };

    const weaknesses =
      testCase.quality === "weak" && testCase.weaknesses?.length
        ? testCase.weaknesses
        : null;
    // Jev's requests run alongside the judge's, not after them.
    const blind = jev ? jevReadings(jev, testCase) : null;
    const named =
      jev && weaknesses
        ? (async () => {
            const request = jevWeaknessRequest(feedbackText(grade), weaknesses);
            const answers = await askJev(jev, request.state, request.questions);
            return jevShare(answers, request.ids);
          })()
        : null;

    if (judge) {
      const review = grade.review?.text?.trim();
      scores.review_grounded = await judged(async () => {
        if (!review)
          return { score: 0, label: "absent", explanation: "no review" };
        const grounded = await judgeFaithfulness(
          judge,
          testCase.draftText,
          review,
        );
        return {
          score: grounded.score,
          label: grounded.score === null ? "judge-error" : grounded.label,
          explanation: grounded.explanation,
        };
      });
      if (weaknesses) {
        scores.weakness_recall = await judged(() =>
          judgeWeaknessRecall(judge, {
            draft: testCase.draftText,
            weaknesses,
            feedback: feedbackText(grade),
          }),
        );
      }
    }
    if (blind) Object.assign(scores, await blind);
    if (named) scores.jev_weakness_recall = await named;
    return scores;
  },

  scoreAll(results: Array<ScoredCase<RubricCase>>) {
    const pairs = new Map<
      string,
      Partial<Record<"strong" | "weak", ScoredCase<RubricCase>>>
    >();
    for (const result of results) {
      const pair = pairs.get(result.case.pair_id) ?? {};
      pair[result.case.quality] = result;
      pairs.set(result.case.pair_id, pair);
    }
    for (const { strong, weak } of pairs.values()) {
      if (!strong || !weak) continue;
      const a = gradeOf(strong.raw);
      const b = gradeOf(weak.raw);
      // One reading per pair, copied onto both drafts.
      const order = (x?: number | null, y?: number | null): Score =>
        typeof x === "number" && typeof y === "number"
          ? {
              score: x > y ? 1 : x === y ? 0.5 : 0,
              label: x > y ? "ordered" : x === y ? "tied" : "inverted",
              explanation: `strong ${Number(x.toFixed(3))} vs weak ${Number(y.toFixed(3))}`,
              sharedByCluster: true,
            }
          : {
              score: null,
              explanation: "a grade is missing",
              sharedByCluster: true,
            };
      const scores: Record<string, Score> = {
        pair_order: order(a.combined, b.combined),
        evidence_order: order(a.evidence?.score, b.evidence?.score),
        integrity_order: order(a.integrity?.score, b.integrity?.score),
        sufficiency_order: order(a.sufficiency?.score, b.sufficiency?.score),
      };
      if (strong.scores.jev_quality || weak.scores.jev_quality)
        scores.jev_pair_order = order(
          strong.scores.jev_quality?.score,
          weak.scores.jev_quality?.score,
        );
      Object.assign(strong.scores, scores);
      Object.assign(weak.scores, scores);
    }
  },

  example: (testCase) => ({
    case_id: testCase.case_id,
    pair_id: testCase.pair_id,
    quality: testCase.quality,
    draftText: testCase.draftText,
    brief: JSON.stringify(testCase.brief),
    weaknesses: JSON.stringify(testCase.weaknesses ?? []),
  }),
};
