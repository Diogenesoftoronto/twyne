import { scoreStaticFeatures } from "../rubric";
import type { RubricResult } from "../../types";
import type {
  Finding,
  LiveScore,
  ScoreCriterion,
} from "../living-desk-contract";

// rubric.ts keeps FEATURE_WEIGHTS private. Mirror its six relevant weights;
// consistency takes the omitted length weight, equal to vocabulary.
export const RULE_WEIGHTS: Record<string, number> = {
  evidence: 0.2,
  pacing: 0.15,
  vocabulary: 0.1,
  integrity: 0.2,
  paragraphShape: 0.1,
  structure: 0.15,
  consistency: 0.1,
};
const LABELS: Record<string, string> = {
  evidence: "Evidence & Support",
  pacing: "Pacing & Rhythm",
  vocabulary: "Vocabulary & Diction",
  integrity: "Bullshit Resistance",
  paragraphShape: "Paragraph Shape",
  structure: "Organization & Flow",
  consistency: "Consistency",
};
export interface Confirmation {
  review: RubricResult;
  at: number;
  rules: Record<string, number>;
}
export const clampScore = (n: number) => Math.max(0, Math.min(10, n));
export function consistencyPenalty(findings: Finding[]): number {
  return Math.min(
    6,
    findings.reduce(
      (sum, f) =>
        sum +
        (f.state === "deliberate"
          ? 0
          : f.count *
            (f.lens === "stance"
              ? 0.3
              : f.lens === "naming"
                ? 0.4
                : f.lens === "style"
                  ? 0.1
                  : 0)),
      0,
    ),
  );
}
export function ruleValues(
  text: string,
  findings: Finding[],
): Record<string, number> {
  const features = scoreStaticFeatures(text).perFeature;
  return {
    evidence: features.evidence,
    pacing: features.pacing,
    vocabulary: features.vocabulary,
    integrity: features.integrity,
    paragraphShape: features.paragraphShape,
    structure: features.structure,
    consistency: 10 - consistencyPenalty(findings),
  };
}
export function buildScore(
  text: string,
  findings: Finding[],
  confirmation: Confirmation | null,
  edits = 0,
  lastChange: LiveScore["lastChange"] = null,
): LiveScore {
  const values = ruleValues(text, findings);
  const totalWeight = Object.values(RULE_WEIGHTS).reduce((a, b) => a + b, 0);
  const confirmed = confirmation
    ? clampScore(confirmation.review.overallScore / 10)
    : null;
  const ruleCriteria: ScoreCriterion[] = Object.entries(values).map(
    ([key, value]) => ({
      key,
      label: LABELS[key],
      value,
      delta: confirmation ? value - (confirmation.rules[key] ?? value) : 0,
      source: "rule",
      scope: "paragraph",
    }),
  );
  const reviewCriteria: ScoreCriterion[] = Object.values(
    confirmation?.review.judgementGrade?.criteria ?? {},
  ).map((c) => ({
    key: `review:${c.id}`,
    label:
      confirmation?.review.criteria.find((r) => r.id === c.id)?.label ?? c.id,
    value: clampScore(c.score),
    delta: 0,
    source: "review",
    scope: "piece",
  }));
  const estimate =
    text.trim().split(/\s+/).filter(Boolean).length < 150
      ? null
      : clampScore(
          confirmed === null
            ? ruleCriteria.reduce(
                (sum, c) => sum + (c.value * RULE_WEIGHTS[c.key]) / totalWeight,
                0,
              )
            : confirmed +
                ruleCriteria.reduce(
                  (sum, c) =>
                    sum + (c.delta * RULE_WEIGHTS[c.key]) / totalWeight,
                  0,
                ),
        );
  return {
    confirmed,
    confirmedAt: confirmation?.at ?? null,
    confirmedLetter: confirmation?.review.overallGrade ?? null,
    estimate,
    editsSinceConfirmed: edits,
    lastChange,
    criteria: [...ruleCriteria, ...reviewCriteria],
  };
}
export function rankFindings(findings: Finding[], estimable = true): Finding[] {
  const penalty = consistencyPenalty(findings);
  const totalWeight = Object.values(RULE_WEIGHTS).reduce((a, b) => a + b, 0);
  const rank = { open: 0, improving: 1, resolved: 2, deliberate: 3 };
  return findings
    .map((f) => ({
      ...f,
      effort: f.count,
      impact:
        f.criterion === "consistency" && estimable && f.state !== "deliberate"
          ? (RULE_WEIGHTS.consistency / totalWeight) *
            (penalty -
              consistencyPenalty(findings.filter((other) => other.id !== f.id)))
          : null,
    }))
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        (a.impact === null ? 1 : 0) - (b.impact === null ? 1 : 0) ||
        (b.impact ?? 0) - (a.impact ?? 0),
    );
}
