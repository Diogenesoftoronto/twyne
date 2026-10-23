/**
 * The interviewer's DOSSIER and SYNTHESIZE segments, normalised into a
 * partial brief with per-field confidence.
 *
 * A model asked to fill a dossier it has not yet learned will fill it anyway,
 * with "unspecified", "unknown", "n/a" and the like. Those are not answers;
 * filing them would mark a field as settled that the writer never spoke to,
 * so a field whose whole value is such a placeholder is dropped. A value that
 * merely contains a hedge ("unclear — interior myth vs thriller tension")
 * records something real and is kept.
 */

import type { ProjectInterviewAnswers } from "../types";

export type InterviewConfidence = "high" | "medium" | "low";

export const INTERVIEW_FIELDS = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
] as const satisfies ReadonlyArray<keyof ProjectInterviewAnswers>;

export interface InterviewDossierDraft {
  brief: Partial<ProjectInterviewAnswers>;
  confidence: Partial<
    Record<keyof ProjectInterviewAnswers, InterviewConfidence>
  >;
}

/**
 * A value is a placeholder when, stripped of surrounding quotes, brackets,
 * punctuation and case, it is one of the stock non-answers a model writes for
 * a field it has nothing on. The match is against the whole value: "unclear"
 * alone is a placeholder, "unclear — interior myth vs thriller tension" is not.
 */
const PLACEHOLDER_VALUES = new Set([
  "unspecified",
  "unknown",
  "unclear",
  "undetermined",
  "undecided",
  "none",
  "none stated",
  "none given",
  "none specified",
  "none provided",
  "none yet",
  "not specified",
  "not stated",
  "not given",
  "not provided",
  "not known",
  "not yet known",
  "not yet specified",
  "not yet determined",
  "not applicable",
  "not available",
  "not discussed",
  "not mentioned",
  "no answer",
  "n/a",
  "na",
  "tbd",
  "tba",
  "to be determined",
  "to be decided",
  "to be confirmed",
  "pending",
  "null",
  "undefined",
  "?",
  "-",
  "—",
  "–",
]);

export function isPlaceholderAnswer(value: string): boolean {
  const bare = value
    .trim()
    .replace(/^[\s"'“”‘’`([{<]+|[\s"'“”‘’`)\]}>.,;:!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!bare) return true;
  return PLACEHOLDER_VALUES.has(bare);
}

export function normalizeInterviewDossierDraft(
  value: unknown,
): InterviewDossierDraft | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const briefSource =
    obj.brief && typeof obj.brief === "object"
      ? (obj.brief as Record<string, unknown>)
      : obj;
  const confidenceSource =
    obj.confidence && typeof obj.confidence === "object"
      ? (obj.confidence as Record<string, unknown>)
      : {};

  const brief: Partial<ProjectInterviewAnswers> = {};
  const confidence: InterviewDossierDraft["confidence"] = {};
  for (const field of INTERVIEW_FIELDS) {
    const raw = briefSource[field];
    if (typeof raw !== "string" || isPlaceholderAnswer(raw)) continue;
    brief[field] = raw.trim();
    const c = confidenceSource[field];
    if (c === "high" || c === "medium" || c === "low") {
      confidence[field] = c;
    }
  }
  return Object.keys(brief).length > 0 ? { brief, confidence } : null;
}
