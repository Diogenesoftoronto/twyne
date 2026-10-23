/**
 * The room's grade, assembled outside the panel.
 *
 * This is the hosted path of `src/components/rubric/rubric-panel.tsx`
 * (`runAnalysis`, roughly lines 330-700) with the judges handed in as
 * functions: static features first; the five editors as judges; the
 * sufficiency, evidence, integrity and target-fit judges with the panel's own
 * local fallbacks; the combined grade from `combineJudgesAndStatic`; the
 * writer's criteria judged alongside with a failure dropping the criterion
 * rather than the pass; then the narrative review. The panel keeps its own
 * copy of this sequence because it also drives a store and Qwik signals; the
 * integration API runs this one against the same Convex cores, so a grade
 * from the CLI is the grade the panel would have shown.
 */

import type { ProjectBrief } from "../types";
import {
  combineJudgesAndStatic,
  scoreStaticFeatures,
  scoreSufficiency,
  UNJUDGED_TARGET_FIT,
  type JudgeResult,
} from "./rubric";
import { shapeFeedback } from "./rubric-copy";

export interface RoomJudgement {
  score: number;
  rationale: string;
  provider: string;
}

export interface RubricRoomGrade {
  grade: string;
  combined: number;
  judgeMean: number;
  minJudge: number;
  staticTotal: number;
  staticFeedback: string[];
  judges: JudgeResult[];
  sufficiency: RoomJudgement;
  evidence: RoomJudgement;
  integrity: RoomJudgement;
  targetFit: RoomJudgement;
  custom: Array<RoomJudgement & { label: string }>;
  review: { text: string; provider: string } | null;
  /**
   * Editors the room was asked to seat who gave no judgement: both asks of
   * the hosted model came back empty. They are absent from `judges` and from
   * every average, rather than impersonated by a heuristic.
   */
  unjudged: string[];
}

export interface RubricRoomCriterion {
  label: string;
  description: string;
}

/** What the orchestrator asks of the server; each maps to one `agents` core. */
export interface RubricRoomJudges {
  judgeRoom: () => Promise<JudgeResult[]>;
  judgeSufficiency: () => Promise<RoomJudgement>;
  judgeEvidence: () => Promise<RoomJudgement | null>;
  judgeIntegrity: () => Promise<RoomJudgement | null>;
  judgeTargetFit: () => Promise<RoomJudgement | null>;
  judgeCustomCriterion: (
    criterion: RubricRoomCriterion,
  ) => Promise<RoomJudgement | null>;
  reviewRubric: (summary: {
    combined: number;
    grade: string;
    judgeMean: number;
    minJudge: number;
    staticTotal: number;
    judges: Array<{ personaId: string; score: number; rationale: string }>;
    staticFeedback: string[];
  }) => Promise<{ text: string; provider: string } | null>;
}

/**
 * Thrown when every judge came back local. The panel refuses to show a grade
 * in that case (it reports a provider error instead), because a room of
 * heuristics is not the room.
 */
export class RubricRoomUnavailableError extends Error {
  constructor() {
    super("The editors could not be reached, so there is no grade to report.");
    this.name = "RubricRoomUnavailableError";
  }
}

export async function gradeWithRoom(
  input: {
    draftText: string;
    brief: ProjectBrief | null;
    /** The editors `judgeRoom` is asked to seat, so the missing can be named. */
    personaIds: string[];
    criteria?: RubricRoomCriterion[];
  },
  judges: RubricRoomJudges,
): Promise<RubricRoomGrade> {
  const { draftText, brief } = input;

  // 1. The static-feature scorer: cheap and deterministic (panel step 1).
  const staticScore = scoreStaticFeatures(draftText);

  // 2. The five personas as judges (panel step 2, hosted branch). A room that
  //    answered entirely from heuristics is a provider failure, not a grade.
  //    An editor who gave no judgement is simply not seated: the averages run
  //    over whoever answered, and the absence is reported by name.
  const judgeResults = await judges.judgeRoom();
  if (
    judgeResults.length === 0 ||
    judgeResults.every((j) => j.provider === "local")
  ) {
    throw new RubricRoomUnavailableError();
  }
  const unjudged = input.personaIds.filter(
    (id) => !judgeResults.some((j) => j.personaId === id),
  );

  // 2b. Sufficiency against the stated goal, keyword heuristic as fallback.
  const localSufficiency = (): RoomJudgement => {
    const s = scoreSufficiency(draftText, brief?.answers.goal ?? null);
    return { score: s.score, rationale: s.feedback, provider: "local" };
  };
  let sufficiency: RoomJudgement;
  try {
    sufficiency = await judges.judgeSufficiency();
  } catch {
    sufficiency = localSufficiency();
  }

  // 2c. Evidence and integrity, with the panel's density/regex fallbacks.
  const localEvidence = (): RoomJudgement => {
    const f = staticScore.features;
    const density = f.citationDensity;
    const score =
      f.citationCount === 0
        ? f.paragraphCount > 0
          ? 3
          : 1
        : density >= 1.5 && density <= 6
          ? 7
          : density < 1.5
            ? 5
            : 4;
    return {
      score,
      rationale: shapeFeedback.evidence(f.citationCount, f.citationDensity),
      provider: "local",
    };
  };
  const localIntegrity = (): RoomJudgement => {
    const f = staticScore.features;
    const deduction =
      f.unsupportedUniversalClaimCount * 0.6 + f.duplicateParagraphRatio * 60;
    return {
      score: deduction > 0 ? Math.max(1, 10 - Math.round(deduction)) : 7,
      rationale: shapeFeedback.integrity(
        f.unsupportedUniversalClaimCount,
        f.fillerWordRatio,
        f.vagueWordRatio,
        f.duplicateParagraphRatio,
      ),
      provider: "local",
    };
  };
  let evidence: RoomJudgement;
  try {
    evidence = (await judges.judgeEvidence()) ?? localEvidence();
  } catch {
    evidence = localEvidence();
  }
  let integrity: RoomJudgement;
  try {
    integrity = (await judges.judgeIntegrity()) ?? localIntegrity();
  } catch {
    integrity = localIntegrity();
  }

  // 2d. The relevance gate. An unjudged draft is treated as on-target
  //     (UNJUDGED_TARGET_FIT) so the absence of a judge never costs a grade.
  let targetFit: RoomJudgement = {
    score: UNJUDGED_TARGET_FIT,
    rationale: shapeFeedback.unjudgedFit,
    provider: "local",
  };
  try {
    const judged = await judges.judgeTargetFit();
    if (judged) targetFit = judged;
  } catch {
    // Diagnostic only in the panel; the unjudged default stands.
  }

  // 3. Combine into the grade, gated on relevance.
  const combined = combineJudgesAndStatic(
    judgeResults,
    staticScore,
    brief,
    targetFit.score,
  );

  // 4. The writer's own criteria, one call each, a failure dropping only that
  //    criterion.
  const custom = (
    await Promise.all(
      (input.criteria ?? []).map(async (criterion) => {
        try {
          const judged = await judges.judgeCustomCriterion(criterion);
          if (!judged) return null;
          return {
            label: criterion.label,
            score: Math.min(10, Math.max(0, judged.score)),
            rationale: judged.rationale,
            provider: judged.provider,
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((c): c is RoomJudgement & { label: string } => c !== null);

  // 5. The full-page review explaining the grade. Hosting may decline.
  const summary = {
    combined: combined.combined,
    grade: combined.grade,
    judgeMean: combined.judgeMean,
    minJudge: combined.minJudge,
    staticTotal: combined.staticTotal,
    judges: judgeResults.map(({ personaId, score, rationale }) => ({
      personaId,
      score,
      rationale,
    })),
    staticFeedback: staticScore.feedback,
  };
  let review: { text: string; provider: string } | null = null;
  try {
    const written = await judges.reviewRubric(summary);
    review = written && written.text.trim() ? written : null;
  } catch {
    review = null;
  }

  return {
    grade: combined.grade,
    combined: combined.combined,
    judgeMean: combined.judgeMean,
    minJudge: combined.minJudge,
    staticTotal: combined.staticTotal,
    staticFeedback: staticScore.feedback,
    judges: judgeResults,
    sufficiency,
    evidence,
    integrity,
    targetFit,
    custom,
    review,
    unjudged,
  };
}
