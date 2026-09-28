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
import { PERSONAS } from "./personas";
import { gradeVerdict } from "./rubric-copy";

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
  duplicateParagraphRatio: number;
  fillerWordRatio: number;
  vagueWordRatio: number;
  unsupportedUniversalClaimCount: number;
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
    integrity: number;
  };
  /** Weighted mean, 0-10. */
  total: number;
  feedback: string[];
}

const FEATURE_WEIGHTS = {
  length: 0.1,
  structure: 0.15,
  pacing: 0.15,
  evidence: 0.2,
  vocabulary: 0.1,
  paragraphShape: 0.1,
  integrity: 0.2,
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
    integrity: scoreIntegrity(features),
  };
  const total =
    perFeature.length * FEATURE_WEIGHTS.length +
    perFeature.structure * FEATURE_WEIGHTS.structure +
    perFeature.pacing * FEATURE_WEIGHTS.pacing +
    perFeature.evidence * FEATURE_WEIGHTS.evidence +
    perFeature.vocabulary * FEATURE_WEIGHTS.vocabulary +
    perFeature.paragraphShape * FEATURE_WEIGHTS.paragraphShape +
    perFeature.integrity * FEATURE_WEIGHTS.integrity;

  return {
    features,
    perFeature,
    total,
    feedback: buildFeedback(features, perFeature),
  };
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
  const sentenceLengths = sentences.map(
    (s) => s.split(/\s+/).filter(Boolean).length,
  );
  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 0;
  const sentenceLengthStdDev = standardDeviation(sentenceLengths);

  const citationCount = detectCitations(text).length;
  const citationDensity =
    wordCount > 0 ? (citationCount / wordCount) * 1000 : 0;

  const avgWordLength =
    words.length > 0
      ? words.reduce((sum, w) => sum + w.length, 0) / words.length
      : 0;
  const uniqueWordsRatio = movingTypeTokenRatio(words);

  const paragraphLengths = paragraphs.map(
    (p) => p.split(/\s+/).filter(Boolean).length,
  );
  const shortParagraphRatio =
    paragraphLengths.length > 0
      ? paragraphLengths.filter((n) => n < 40).length / paragraphLengths.length
      : 0;
  const longParagraphRatio =
    paragraphLengths.length > 0
      ? paragraphLengths.filter((n) => n > 220).length / paragraphLengths.length
      : 0;
  const normalizedParagraphs = paragraphs
    .map((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p.split(/\s+/).length >= 12);
  const duplicateParagraphRatio =
    normalizedParagraphs.length > 0
      ? (normalizedParagraphs.length - new Set(normalizedParagraphs).size) /
        normalizedParagraphs.length
      : 0;
  const fillerMatches = text.match(FILLER_WORDS) ?? [];
  const vagueMatches = text.match(VAGUE_WORDS) ?? [];
  const fillerWordRatio = wordCount > 0 ? fillerMatches.length / wordCount : 0;
  const vagueWordRatio = wordCount > 0 ? vagueMatches.length / wordCount : 0;
  const unsupportedUniversalClaimCount = sentences.filter(
    (s) =>
      UNIVERSAL_CLAIM.test(s) &&
      !SOURCE_MARKER.test(s) &&
      !SOURCE_CITATION.test(s),
  ).length;

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
    duplicateParagraphRatio,
    fillerWordRatio,
    vagueWordRatio,
    unsupportedUniversalClaimCount,
  };
}

const FILLER_WORDS =
  /\b(very|really|basically|actually|literally|simply|clearly|obviously|undeniably|innovative|robust|leverage|synergy|paradigm|game[- ]changer|cutting[- ]edge|seamless|world[- ]class|transformative)\b/gi;
const VAGUE_WORDS =
  /\b(thing|things|stuff|various|many|some|people|society|important|interesting|significant|impactful|better|worse|good|bad|a lot|kind of|sort of)\b/gi;
const UNIVERSAL_CLAIM =
  /\b(always|never|everyone|no one|all (?:people|writers|readers|users)|none of|proves?|guarantees?|undeniably|obviously|clearly)\b/i;
// Word-boundary assertions only wrap the word alternatives — a leading
// `\b` before `(` or `[` never matches (both are non-word characters),
// which used to make parenthetical citations like "(Smith, 2020)" and
// bracketed refs like "[3]" invisible to this check.
const SOURCE_MARKER =
  /\b(?:according to|study|studies|research|data|survey|report|census|doi:)\b|https?:\/\//i;
const SOURCE_CITATION = /\(\s*[A-Z][A-Za-z-]+,\s*\d{4}\s*\)|\[\d+\]/;

/**
 * Moving-average type-token ratio (MATTR). A raw type-token ratio
 * falls with document length — a 3,000-word essay always looks more
 * "repetitive" than a 300-word note — so we average the ratio over a
 * sliding window instead, which stays comparable across lengths.
 * Texts shorter than the window fall back to the raw ratio.
 */
function movingTypeTokenRatio(words: string[], window = 110): number {
  const norm = words
    .map((w) => w.toLowerCase().replace(/[^a-z']/g, ""))
    .filter(Boolean);
  if (norm.length === 0) return 0;
  if (norm.length <= window) return new Set(norm).size / norm.length;

  const counts = new Map<string, number>();
  let distinct = 0;
  let sum = 0;
  let windows = 0;
  for (let i = 0; i < norm.length; i++) {
    const incoming = norm[i];
    const next = (counts.get(incoming) ?? 0) + 1;
    counts.set(incoming, next);
    if (next === 1) distinct++;
    if (i >= window) {
      const outgoing = norm[i - window];
      const remaining = (counts.get(outgoing) ?? 1) - 1;
      if (remaining === 0) {
        counts.delete(outgoing);
        distinct--;
      } else {
        counts.set(outgoing, remaining);
      }
    }
    if (i >= window - 1) {
      sum += distinct / window;
      windows++;
    }
  }
  return sum / windows;
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
  // Windowed type-token ratio (MATTR, 110-word window): 0.65-0.8 is
  // healthy prose. Below 0.5 reads as heavy repetition; approaching
  // 0.9 every word is used once, which reads as thesaurus abuse.
  if (f.uniqueWordsRatio < 0.45) return 2;
  if (f.uniqueWordsRatio < 0.55) return 4;
  if (f.uniqueWordsRatio < 0.65) return 6.5;
  if (f.uniqueWordsRatio < 0.8) return 8;
  if (f.uniqueWordsRatio < 0.88) return 7;
  return 5;
}

function scoreParagraphShape(f: StaticFeatures): number {
  // Penalize both too-short and too-long paragraph dominance.
  const shortPenalty = clamp(0, 1, f.shortParagraphRatio * 2);
  const longPenalty = clamp(0, 1, f.longParagraphRatio * 2.5);
  const score = 10 - shortPenalty * 4 - longPenalty * 5;
  return clamp(0, 10, score);
}

function scoreIntegrity(f: StaticFeatures): number {
  let score = 10;
  score -= clamp(0, 4, f.duplicateParagraphRatio * 16);
  score -= clamp(0, 2.5, f.fillerWordRatio * 90);
  score -= clamp(0, 2.5, f.vagueWordRatio * 45);
  score -= clamp(0, 4, f.unsupportedUniversalClaimCount * 0.8);
  if (f.wordCount < 220) score = Math.min(score, 4);
  return clamp(0, 10, score);
}

const SUFFICIENCY_STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "will",
  "your",
  "their",
  "about",
  "into",
  "than",
  "then",
  "them",
  "they",
  "what",
  "when",
  "where",
  "which",
  "while",
  "should",
  "would",
  "could",
  "reader",
  "readers",
]);

function scoreLengthAdequacy(wordCount: number): number {
  if (wordCount < 150) return 0;
  if (wordCount < 300) return 0.4;
  if (wordCount < 600) return 0.7;
  return 1;
}

/**
 * Does the draft actually develop enough material, on-topic, to justify
 * reaching the stated thesis/goal? A short or wandering draft can look
 * clean on every other static feature and still fail to earn its claim.
 */
export function scoreSufficiency(
  draftText: string,
  goal: string | null,
): { score: number; feedback: string } {
  const text = draftText.trim();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  if (!goal || !goal.trim()) {
    return {
      score: 5,
      feedback:
        "No stated goal in the brief to measure against — set one so this criterion can judge whether the draft actually earns it.",
    };
  }
  if (wordCount === 0) {
    return {
      score: 0,
      feedback: "There is no draft text yet to weigh against the goal.",
    };
  }

  const keywords = [
    ...new Set(
      goal
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !SUFFICIENCY_STOPWORDS.has(w)),
    ),
  ];
  const lowerText = text.toLowerCase();
  const coveredKeywords = keywords.filter((k) => lowerText.includes(k));
  const coverageRatio =
    keywords.length > 0 ? coveredKeywords.length / keywords.length : 1;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const engagedParagraphs = paragraphs.filter((p) => {
    const lp = p.toLowerCase();
    return coveredKeywords.some((k) => lp.includes(k));
  }).length;
  const engagementRatio =
    paragraphs.length > 0 ? engagedParagraphs / paragraphs.length : 0;

  const score = clamp(
    0,
    10,
    coverageRatio * 4 +
      engagementRatio * 4 +
      scoreLengthAdequacy(wordCount) * 2,
  );

  const feedback = `${coveredKeywords.length}/${keywords.length} key term${
    keywords.length === 1 ? "" : "s"
  } from the stated goal ("${goal}") show up in the draft, developed across ${engagedParagraphs}/${
    paragraphs.length
  } paragraph${paragraphs.length === 1 ? "" : "s"}. ${
    engagementRatio < 0.4
      ? "Too much of the draft wanders away from the goal for a reader to feel it's been earned."
      : "The draft mostly stays in service of the stated goal."
  }`;

  return { score, feedback };
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
      `At ${f.wordCount} words the draft is short. Scores settle down past about 400.`,
    );
  }
  if (s.evidence < 4) {
    out.push(
      `Few claims are backed up: ${f.citationCount} reference${f.citationCount === 1 ? "" : "s"} found.`,
    );
  }
  if (s.pacing < 4) {
    out.push(
      `Sentence lengths don't vary much (about ${Math.round(f.avgSentenceLength)} words each). Mix short sentences with long ones.`,
    );
  }
  if (s.structure < 4) {
    out.push(
      `Only ${f.paragraphCount} paragraph${f.paragraphCount === 1 ? "" : "s"}. Give it a beginning, a turn and an ending.`,
    );
  }
  if (f.shortParagraphRatio > 0.5 && f.paragraphCount >= 4) {
    out.push(
      "Most paragraphs are very short, so it reads in fragments rather than as one argument.",
    );
  }
  if (f.longParagraphRatio > 0.3) {
    out.push(
      "Some paragraphs run long. Split them where the subject changes or the reader needs a breath.",
    );
  }
  if (s.vocabulary < 4) {
    out.push(
      "The same words come back often. Find the ones you lean on and vary or cut them.",
    );
  }
  if (s.integrity < 6) {
    out.push(
      `Some padding: ${f.unsupportedUniversalClaimCount} sweeping claim${
        f.unsupportedUniversalClaimCount === 1 ? "" : "s"
      } with nothing behind ${f.unsupportedUniversalClaimCount === 1 ? "it" : "them"}, and ${Math.round(
        (f.fillerWordRatio + f.vagueWordRatio) * 100,
      )}% filler or vague words.`,
    );
  }
  if (out.length === 0) {
    out.push(
      "Nothing stands out in the measured style, so the editors' scores decide the grade.",
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
  minJudge: number; // 0-10, the harshest judge's score
  staticTotal: number; // 0-10
  combined: number; // 0-100
  grade: string;
  summary: string;
  /** Relevance to the brief's audience/goal, 0-10. 10 when not judged. */
  targetFit: number;
  /**
   * The static score after the relevance cap — what actually fed the grade.
   * Equals {@link RubricCombineResult.staticTotal} when the draft is on-target.
   */
  effectiveStatic: number;
}

const JUDGE_WEIGHT = 0.45;
const MIN_JUDGE_WEIGHT = 0.35;
/** Weight the static-feature score gets when the draft is fully on-target. */
const STATIC_WEIGHT = 0.2;

/**
 * The ceiling a purely shape-derived score may reach at a given target-fit.
 *
 * Static features measure *shape* — sentence-length variance, type-token
 * ratio, paragraph balance. They never read the brief, so fluent prose that
 * has nothing to do with the stated audience or goal scores 10/10 on all of
 * them. That is the single most misleading thing the rubric can do: it tells
 * a writer their off-target draft is excellent at three things.
 *
 * So a shape score is capped by how relevant the content is. At targetFit 10
 * the cap is 10 (no effect); at targetFit 2 nothing shape-derived may exceed
 * 4.4; at 0 the ceiling is 3 — enough to say "the sentences are well formed"
 * and not a word more.
 */
export function shapeCeiling(targetFit: number): number {
  return clamp(0, 10, 3 + clamp(0, 10, targetFit) * 0.7);
}

/**
 * Apply {@link shapeCeiling} to a raw shape score, and report whether the cap
 * actually bit so the UI can explain itself rather than silently deflating a
 * number the writer can see is wrong.
 */
export function capShapeScore(
  rawScore: number,
  targetFit: number,
): { score: number; capped: boolean; ceiling: number } {
  const ceiling = shapeCeiling(targetFit);
  const score = Math.min(rawScore, ceiling);
  return {
    score: Math.round(score * 10) / 10,
    capped: score < rawScore - 0.05,
    ceiling: Math.round(ceiling * 10) / 10,
  };
}

/**
 * When no target-fit judge could run (offline, no provider, draft too short)
 * we must not silently punish the draft — an unjudged draft is treated as
 * on-target, which reproduces the previous behaviour exactly.
 */
export const UNJUDGED_TARGET_FIT = 10;

export function combineJudgesAndStatic(
  judges: JudgeResult[],
  staticScore: StaticScore,
  brief: { answers: { audience: string; goal: string } } | null,
  targetFit: number = UNJUDGED_TARGET_FIT,
): RubricCombineResult {
  // Mean across judges, with a hard penalty for any judge below 4.
  const mean =
    judges.length > 0
      ? judges.reduce((s, j) => s + j.score, 0) / judges.length
      : 5;
  const lowJudges = judges.filter((j) => j.score < 4).length;
  const lowPenalty = lowJudges * 0.4; // each low judge drags the mean
  const judgeMean = clamp(1, 10, mean - lowPenalty);

  // The harshest single judge, weighted heavily on its own — one persona
  // calling the draft broken shouldn't get diluted away by an average.
  const minJudge =
    judges.length > 0
      ? clamp(0, 10, Math.min(...judges.map((j) => j.score)))
      : 5;

  const staticTotal = staticScore.total;
  const fit = clamp(0, 10, targetFit);

  // The gate, applied to the aggregate by exactly the same rule as to each
  // shape criterion: cap the static score by relevance. The weights stay
  // fixed, which matters — reweighting looks tempting but can *raise* the
  // grade whenever the static score happens to sit below the harshest
  // judge's, and a relevance gate that sometimes rewards irrelevance is
  // worse than no gate. Capping can only ever lower the score or leave it
  // alone, and at full target fit the ceiling is 10, so this is a no-op.
  const effectiveStatic = Math.min(staticTotal, shapeCeiling(fit));

  // Combined score on a 0-10 scale, then mapped to 0-100 with a curve
  // designed to be brutal. Most drafts should land in the 40-65 range;
  // a 90+ is reserved for genuinely excellent work.
  const combinedTen =
    judgeMean * JUDGE_WEIGHT +
    minJudge * MIN_JUDGE_WEIGHT +
    effectiveStatic * STATIC_WEIGHT;
  const combinedHundred = brutalCurve(combinedTen * 10);
  const grade = letterGrade(combinedHundred);

  return {
    judgeMean,
    minJudge,
    staticTotal,
    combined: Math.round(combinedHundred),
    grade,
    summary: buildSummary(judges, staticScore, combinedHundred, fit),
    targetFit: fit,
    effectiveStatic: Math.round(effectiveStatic * 100) / 100,
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
  if (rawHundred <= 50) return Math.max(0, rawHundred);
  if (rawHundred >= 95) return Math.min(100, 93 + (rawHundred - 95) * 1.4);
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
  targetFit: number = UNJUDGED_TARGET_FIT,
): string {
  // Short enough to sit whole under the grade in the side panel: the verdict,
  // then the one reason that most explains it. Detail lives in the criteria
  // and the editors' own notes.
  const parts: string[] = [gradeVerdict(final)];
  const harshest = [...judges].sort((a, b) => a.score - b.score)[0];
  if (targetFit < 7) {
    parts.push(
      `It drifts from the brief (${targetFit}/10 on brief), so style scores are held down to ${shapeCeiling(
        targetFit,
      ).toFixed(1)}.`,
    );
  } else if (harshest && harshest.score < 6) {
    const name =
      PERSONAS.find((p) => p.id === harshest.personaId)?.name ?? "One editor";
    parts.push(`${name} is hardest to convince (${harshest.score}/10).`);
  } else if (staticScore.total < 5) {
    parts.push("The editors are fairly happy; the measured style lags.");
  }
  return parts.join(" ");
}
