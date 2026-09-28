import type { RubricCriterionSpec, RubricResult } from "../types";
import type { StaticScore } from "./rubric";
import { weightedCriteriaScore } from "./rubric-criteria";
import { gradeVerdict } from "./rubric-copy";
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
    // The legend reads "Strong — clearly well executed"; the row already
    // shows the word, so keep only the explanation after the dash.
    const legend = mark.legend[String(mark.modal)] || "";
    const feedback = [
      legend.includes("—")
        ? `${legend
            .split("—")[1]
            .trim()
            .replace(/^./, (c) => c.toUpperCase())}.`
        : legend,
      mark.unreliableScalar
        ? "The model couldn't settle on a score here; ask the editors for a second opinion."
        : mark.escalate
          ? "The model was unsure here; a second opinion may help."
          : "",
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
    summary: `${gradeVerdict(overall)} A quick model check of ${criteria.length} criteria; ask the editors for written notes.`,
    timestamp: grade.at,
    judges: [],
    staticScore: input.staticScore,
    targetFit: grade.criteria.targetFit?.score,
    writerScore: weightedCriteriaScore(specs, gradeScores(grade)) ?? undefined,
  };
}
