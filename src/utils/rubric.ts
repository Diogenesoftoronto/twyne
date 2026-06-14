/**
 * Static writing-feature scoring for the galley-proof rubric. The room's
 * judges (the personas) do most of the work, but the rubric blends in a
 * deterministic feature score so a draft can't game the judges with
 * eloquent prose over a hollow structure.
 *
 * Each feature returns 0-10. The overall static score is a weighted
 * mean, deliberately hard — a 7 on this scale means the draft is well
 * structured, well-cited, well-paced, and properly scoped.
 */

import { detectCitations } from "./citations";

export interface StaticFeatures {
  wordCount: number;
  paragraphCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  citationCount: number;
  citationDensity: number; // citations per 1000 words
  avgWordLength: number;
  uniqueWordsRatio: number; // type-token ratio
  shortParagraphRatio: number; // paragraphs with < 40 words
  longParagraphRatio: number; // paragraphs with > 220 words
}

export interface StaticScore {
  features: StaticFeatures;
  /** Per-feature scores, 0-10. */
  perFeature: {
    length: number;
    structure: number;
    pacing: number;
    evidence: number;
    vocabulary: number;
    paragraphShape: number;
  };
  /** Weighted mean, 0-10. */
  total: number;
  feedback: string[];
}

const FEATURE_WEIGHTS = {
  length: 0.15,
  structure: 0.2,
  pacing: 0.2,
  evidence: 0.2,
  vocabulary: 0.15,
  paragraphShape: 0.1,
} as const;

export function scoreStaticFeatures(draftText: string): StaticScore {
  const text = draftText.trim();
  const features = computeFeatures(text);
  const perFeature = {
    length: scoreLength(features),
    structure: scoreStructure(features),
    pacing: scorePacing(features),
    evidence: scoreEvidence(features),
    vocabulary: scoreVocabulary(features),
    paragraphShape: scoreParagraphShape(features),
  };
  const total =
    perFeature.length * FEATURE_WEIGHTS.length +
    perFeature.structure * FEATURE_WEIGHTS.structure +
    perFeature.pacing * FEATURE_WEIGHTS.pacing +
    perFeature.evidence * FEATURE_WEIGHTS.evidence +
    perFeature.vocabulary * FEATURE_WEIGHTS.vocabulary +
    perFeature.paragraphShape * FEATURE_WEIGHTS.paragraphShape;

  return { features, perFeature, total, feedback: buildFeedback(features, perFeature) };
}

function computeFeatures(text: string): StaticFeatures {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const paragraphCount = paragraphs.length;

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceCount = sentences.length;
  const sentenceLengths = sentences.map((s) =>
    s.split(/\s+/).filter(Boolean).length,
  );
  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 0;
  const sentenceLengthStdDev = standardDeviation(sentenceLengths);

  const citationCount = detectCitations(text).length;
  const citationDensity = wordCount > 0 ? (citationCount / wordCount) * 1000 : 0;

  const avgWordLength =
    words.length > 0
      ? words.reduce((sum, w) => sum + w.length, 0) / words.length
      : 0;
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z']/g, "")));
  const uniqueWordsRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

  const paragraphLengths = paragraphs.map((p) => p.split(/\s+/).filter(Boolean).length);
  const shortParagraphRatio =
    paragraphLengths.length > 0
      ? paragraphLengths.filter((n) => n < 40).length / paragraphLengths.length
      : 0;
  const longParagraphRatio =
    paragraphLengths.length > 0
      ? paragraphLengths.filter((n) => n > 220).length / paragraphLengths.length
      : 0;

  return {
    wordCount,
    paragraphCount,
    sentenceCount,
    avgSentenceLength,
    sentenceLengthStdDev,
    citationCount,
    citationDensity,
    avgWordLength,
    uniqueWordsRatio,
    shortParagraphRatio,
    longParagraphRatio,
  };
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/* ── Per-feature scorers (0-10, hard) ──────────────────────────── */

function scoreLength(f: StaticFeatures): number {
  if (f.wordCount < 80) return 1; // not yet a draft
  if (f.wordCount < 200) return 3;
  if (f.wordCount < 400) return 5;
  if (f.wordCount < 800) return 6.5;
  if (f.wordCount < 1500) return 7.5;
  if (f.wordCount < 3000) return 8;
  if (f.wordCount < 6000) return 7.5;
  return 6.5; // very long without proportional structure starts to drag
}

function scoreStructure(f: StaticFeatures): number {
  if (f.paragraphCount === 0) return 0;
  if (f.paragraphCount < 3) return 3;
  if (f.paragraphCount < 6) return 5.5;
  if (f.paragraphCount < 10) return 7;
  if (f.paragraphCount < 20) return 7.5;
  return 6; // too many short paragraphs suggests fragmented thinking
}

function scorePacing(f: StaticFeatures): number {
  if (f.sentenceCount === 0) return 0;
  // Best rhythm: avg 12-22 words, std dev 5-10.
  const lengthFit = gaussianFit(f.avgSentenceLength, 17, 5);
  const varianceFit = gaussianFit(f.sentenceLengthStdDev, 7, 4);
  return clamp(0, 10, (lengthFit + varianceFit) * 5);
}

function scoreEvidence(f: StaticFeatures): number {
  if (f.wordCount === 0) return 0;
  // Aim for 2-6 citations per 1000 words. Nothing is 0; lots is 9.
  if (f.citationDensity < 0.5) return 1;
  if (f.citationDensity < 1.5) return 3;
  if (f.citationDensity < 3) return 5.5;
  if (f.citationDensity < 6) return 7.5;
  if (f.citationDensity < 10) return 8;
  return 6; // citation stuffing is a smell
}

function scoreVocabulary(f: StaticFeatures): number {
  // Type-token ratio: 0.45-0.6 is healthy; above 0.7 means each word is
  // used once, which is bad. Below 0.3 means repetition.
  if (f.uniqueWordsRatio < 0.25) return 2;
  if (f.uniqueWordsRatio < 0.35) return 4;
  if (f.uniqueWordsRatio < 0.5) return 6.5;
  if (f.uniqueWordsRatio < 0.6) return 8;
  if (f.uniqueWordsRatio < 0.7) return 7;
  return 5;
}

function scoreParagraphShape(f: StaticFeatures): number {
  // Penalize both too-short and too-long paragraph dominance.
  const shortPenalty = clamp(0, 1, f.shortParagraphRatio * 2);
  const longPenalty = clamp(0, 1, f.longParagraphRatio * 2.5);
  const score = 10 - shortPenalty * 4 - longPenalty * 5;
  return clamp(0, 10, score);
}

/* ── Helpers ──────────────────────────────────────────────────── */

function gaussianFit(value: number, mean: number, sigma: number): number {
  return Math.exp(-((value - mean) ** 2) / (2 * sigma ** 2));
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildFeedback(
  f: StaticFeatures,
  s: StaticScore["perFeature"],
): string[] {
  const out: string[] = [];
  if (f.wordCount < 200) {
    out.push(
      `The draft is short (${f.wordCount} words). Most pieces need at least 400 words before the rubric can be honest.`,
    );
  }
  if (s.evidence < 4) {
    out.push(
      `Citations are sparse (${f.citationCount} found, ${f.citationDensity.toFixed(
        1,
      )} per 1,000 words). Claims are not yet supported.`,
    );
  }
  if (s.pacing < 4) {
    out.push(
      `Sentence pacing is uneven. Average sentence is ${f.avgSentenceLength.toFixed(
        1,
      )} words; standard deviation ${f.sentenceLengthStdDev.toFixed(
        1,
      )}. Aim for 12-22 word sentences with healthy variation.`,
    );
  }
  if (s.structure < 4) {
    out.push(
      `The draft has ${f.paragraphCount} paragraph${f.paragraphCount === 1 ? "" : "s"}. Build a beginning, a turn, and a landing before another pass.`,
    );
  }
  if (f.shortParagraphRatio > 0.5 && f.paragraphCount >= 4) {
    out.push(
      `Most paragraphs are short. The piece reads as fragments, not as a single argument.`,
    );
  }
  if (f.longParagraphRatio > 0.3) {
    out.push(
      `Some paragraphs are very long. Split where the topic changes, or where the reader needs a breath.`,
    );
  }
  if (s.vocabulary < 4) {
    out.push(
      `Vocabulary repetition is high. Find a sharper synonym, or cut the repeated word.`,
    );
  }
  if (out.length === 0) {
    out.push(
      "Static features are within the working range. The judges' verdict will dominate the final grade.",
    );
  }
  return out;
}

/* ── Combined rubric ──────────────────────────────────────────── */

export interface JudgeResult {
  personaId: string;
  score: number;
  rationale: string;
  provider: string;
}

export interface RubricCombineResult {
  judgeMean: number; // 0-10
  staticTotal: number; // 0-10
  combined: number; // 0-100
  grade: string;
  summary: string;
}

const JUDGE_WEIGHT = 0.7;
const STATIC_WEIGHT = 0.3;

export function combineJudgesAndStatic(
  judges: JudgeResult[],
  staticScore: StaticScore,
  brief: { answers: { audience: string; goal: string } } | null,
): RubricCombineResult {
  // Mean across judges, with a hard penalty for any judge below 4.
  const mean =
    judges.length > 0
      ? judges.reduce((s, j) => s + j.score, 0) / judges.length
      : 5;
  const lowJudges = judges.filter((j) => j.score < 4).length;
  const lowPenalty = lowJudges * 0.4; // each low judge drags the mean
  const judgeMean = clamp(1, 10, mean - lowPenalty);

  const staticTotal = staticScore.total;

  // Combined score on a 0-10 scale, then mapped to 0-100 with a curve
  // designed to be brutal. Most drafts should land in the 40-65 range;
  // a 90+ is reserved for genuinely excellent work.
  const combinedTen = judgeMean * JUDGE_WEIGHT + staticTotal * STATIC_WEIGHT;
  const combinedHundred = brutalCurve(combinedTen * 10);
  const grade = letterGrade(combinedHundred);

  return {
    judgeMean,
    staticTotal,
    combined: Math.round(combinedHundred),
    grade,
    summary: buildSummary(judges, staticScore, combinedHundred, brief),
  };
}

/**
 * The brutal curve. We compress the 60-80 band and stretch the
 * 90+ band so that only really strong work gets there. This is by
 * design — Twyne is for writers who want editorial pressure, not for
 * a self-esteem mirror.
 */
function brutalCurve(rawHundred: number): number {
  // Anchor the curve at these points:
  //   50 raw  →  50 final (a C-grade draft stays a C)
  //   60 raw  →  58
  //   70 raw  →  67
  //   80 raw  →  76
  //   90 raw  →  86
  //   95 raw  →  93
  //  100 raw  → 100
  if (rawHundred <= 50) return rawHundred;
  if (rawHundred >= 95) return 50 + (rawHundred - 50) * 1.4;
  // Linear in 50-95 band
  return 50 + (rawHundred - 50) * (43 / 45);
}

function letterGrade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 55) return "C-";
  if (score >= 50) return "D+";
  if (score >= 45) return "D";
  if (score >= 40) return "D-";
  return "F";
}

function buildSummary(
  judges: JudgeResult[],
  staticScore: StaticScore,
  final: number,
  brief: { answers: { audience: string; goal: string } } | null,
): string {
  const harshest = [...judges].sort((a, b) => a.score - b.score)[0];
  const kindest = [...judges].sort((a, b) => b.score - a.score)[0];
  const parts: string[] = [];
  if (harshest) {
    parts.push(
      `Harshest reader: ${harshest.personaId} scored ${harshest.score}/10. "${harshest.rationale}"`,
    );
  }
  if (kindest && kindest !== harshest) {
    parts.push(`Kindest: ${kindest.personaId} at ${kindest.score}/10.`);
  }
  parts.push(
    `Static features land at ${staticScore.total.toFixed(
      1,
    )}/10. ${staticScore.feedback[0] ?? ""}`,
  );
  parts.push(
    `Combined, this draft grades ${Math.round(final)}/100. ${
      final >= 80
        ? "Strong work — keep going."
        : final >= 65
          ? "Real progress, but the room is still asking for more."
          : "The room is being honest with you. The next pass is the important one."
    }`,
  );
  if (brief) {
    parts.push(
      `Remember the brief: the piece is for ${brief.answers.audience} and the goal is ${brief.answers.goal}.`,
    );
  }
  return parts.join(" ");
}
