import type { RubricCriterionSpec, RubricResult } from "../types";
import type { StaticScore } from "./rubric";
import { weightedCriteriaScore } from "./rubric-criteria";
import { gradeScores, viewRubricGrade, type RubricGrade } from "./rubric-grade";

/** Persist a digest, rather than another copy of the manuscript, with a grade. */
export async function rubricDraftFingerprint(draft: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(draft),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Convert typed marks into UI copy; Jev supplies no prose or persona opinions. */
export function judgementRubricResult(input: {
  folioId: string;
  fingerprint: string;
  grade: RubricGrade;
  specs: RubricCriterionSpec[];
  staticScore: StaticScore;
}): RubricResult | null {
  const { grade, specs } = input;
  const enabled = specs.filter(
    (spec) => spec.enabled && spec.id !== "engagement",
  );
  // An incomplete response must not silently inflate an average by dropping a weakness.
  if (
    !enabled.length ||
    enabled.some((spec) => {
      const mark = grade.criteria[spec.id];
      return (
        !mark ||
        !Number.isFinite(mark.score) ||
        mark.score < 0 ||
        mark.score > 10
      );
    })
  )
    return null;
  const views = viewRubricGrade(grade, specs);
  const criteria = enabled.map((spec) => {
    const mark = views.find((view) => view.id === spec.id)!;
    const feedback = [
      `Model mark for ${spec.label.toLowerCase()}: ${mark.score.toFixed(1)}/10.`,
      mark.legend[String(mark.modal)] || "",
      mark.unreliableScalar
        ? "The possible ratings disagree; ask the room for a second opinion."
        : mark.escalate
          ? "The possible ratings are spread out; a second opinion may help."
          : "",
      "This is a judgement, not a verified measurement of writing quality.",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: spec.id,
      label: spec.label,
      description: spec.description,
      score: Math.round(mark.score * 10) / 10,
      maxScore: 10,
      feedback,
    };
  });
  const overall = Math.round(
    (enabled.reduce((sum, spec) => sum + grade.criteria[spec.id].score, 0) /
      enabled.length) *
      10,
  );
  const letters = [
    "A+",
    "A",
    "A-",
    "B+",
    "B",
    "B-",
    "C+",
    "C",
    "C-",
    "D+",
    "D",
    "D-",
  ];
  const letter =
    overall >= 40
      ? letters[Math.min(11, Math.max(0, Math.floor((99 - overall) / 5)))]
      : "F";
  return {
    folioId: input.folioId,
    draftFingerprint: input.fingerprint,
    scoringMethod: "judgement",
    judgementGrade: grade,
    criteria,
    overallScore: overall,
    overallGrade: letter,
    summary: `Judgement marks across ${criteria.length} enabled criteria, weighted equally. The review follows your saved draft; the room offers an independent reading.`,
    timestamp: grade.at,
    judges: [],
    staticScore: input.staticScore,
    targetFit: grade.criteria.targetFit?.score,
    writerScore: weightedCriteriaScore(specs, gradeScores(grade)) ?? undefined,
  };
}
