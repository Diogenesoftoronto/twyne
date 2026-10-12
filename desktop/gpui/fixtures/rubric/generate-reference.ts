/** Regenerate offline reference data from the current original pure helpers.
 * No provider or grade-generation call is made. Retained results below are
 * explicitly synthetic DTO fixtures, never an actual manuscript judgement.
 */
import { SPINE_CRITERIA, type RubricCriterionSpec } from "../../../../src/types";
import {
  defaultCriteriaSpecs, reconcileSpecs, weightedCriteriaScore, sparklinePoints,
  scoreDelta, clampWeight, stepWeight,
} from "../../../../src/utils/rubric-criteria";
import { scoreWord, gradeVerdict, nextMoveFor } from "../../../../src/utils/rubric-copy";
import { truncateGalleySummary } from "../../../../src/utils/galley-summary";
import { scoreStaticFeatures } from "../../../../src/utils/rubric";

const root = import.meta.dir;
await Bun.write(`${root}/spine.json`, JSON.stringify(SPINE_CRITERIA, null, 2) + "\n");
const custom: RubricCriterionSpec = {
  id: "custom-second-person", label: "Stay in second person", description: "Keep the reader present.",
  source: "custom", enabled: true, weight: 3,
};
const stored = [
  { id: "pacing", label: "Stale prose", description: "Old wording", source: "spine", enabled: false, weight: 99, future: { keep: true } },
  { id: "pacing", label: "Last matching row", description: "Last wins", source: "spine", enabled: true, weight: .5 },
  { id: "retired", label: "Retired", description: "Retired spine", source: "spine", enabled: true, weight: 2 },
  { ...custom, future: { retained: null } },
  { ...custom, id: "custom-blank", label: "\u00a0\ufeff ", weight: 0 },
] as RubricCriterionSpec[];
const defaults = defaultCriteriaSpecs();
const configured = defaults.map(s => ({ ...s, enabled: ["thesis", "voice", "engagement"].includes(s.id) }));
configured.push(custom);
const histories = [
  { at: 1, overall: 61, grade: "C", perCriterion: { thesis: 6 } },
  { at: 2, overall: 72, grade: "B", perCriterion: { thesis: 7 }, scoringMethod: "judgement" },
  { at: 3, overall: 67, grade: "C+", perCriterion: { thesis: 7 }, scoringMethod: "room" },
  { at: 4, overall: 67, grade: "C+", perCriterion: { thesis: 7 }, scoringMethod: null },
  { at: 5, overall: 69, grade: "C+", perCriterion: { thesis: 7 }, scoringMethod: "future-method" },
];
const comparable = histories.filter(h => (h.scoringMethod ?? "room") === "room");
const visibleCriteria = [
  { id: "thesis", label: "Argument", description: "A clear case", score: 8, maxScore: 10, feedback: "Retained fixture reasoning.", futureCriterion: { keep: null } },
  { id: "custom-second-person", label: custom.label, description: custom.description, score: 5, maxScore: 10, feedback: "Retained custom fixture reasoning." },
];
const rawMark = (id: string, score: number) => ({
  id, score, level: score / 2.5, confidence: .8,
  probabilities: { "0": 0, "1": .1, "2": .15, "3": .75 },
  legend: { "0": "Poor", "1": "Weak", "2": "Adequate", "3": "Strong", future: "Future rating" },
  bimodal: false, modal: 3, futureMark: null,
});
const result = {
  folioId: "row-alias-is-not-scope", criteria: visibleCriteria,
  overallScore: 65, overallGrade: "C+", summary: "Retained synthetic Galley result; this is fixture data, not a provider reading.",
  timestamp: 1770000000000, judges: [], scoringMethod: "judgement",
  draftFingerprint: "0".repeat(64), staticScore: scoreStaticFeatures("A short fixture paragraph.\n\nAnother fixture paragraph."),
  judgementGrade: { at: 1770000000000, model: "fixture-only", criteria: {
    thesis: rawMark("thesis", 8), voice: rawMark("voice", 9),
    "custom-second-person": rawMark("custom-second-person", 5),
  }, usage: { input_tokens: 123, output_tokens: 0, retainedUsage: null }, costUsd: .00006, futureGrade: { untouched: true } },
  review: null, reviewProvider: null, targetFit: null, futureResult: { untouched: true },
};
const liveReview = {
  folioId: "another-row-alias", fingerprint: "retained-live-fingerprint", at: 1770000000000,
  rubric: null, brief: null, coverage: "One retained fixture passage.", lenses: { futureLens: { opaque: true } },
  passages: [{ passage: { id: "passage-1", text: "Retained quoted passage.", from: 0, to: 24 },
    kind: "question", confidence: null, criticality: null, priority: .5, futurePassage: true }],
  notes: [{ id: "note-1", author: "Future editor", verdict: null }], futureLiveReview: null,
};
const weightedCases = [
  { name: "default omitted", specs: defaults, scores: { thesis: 8, voice: 9 }, expected: weightedCriteriaScore(defaults, { thesis: 8, voice: 9 }) },
  { name: "configured missing voice", specs: configured, scores: { thesis: 8, "custom-second-person": 5, engagement: 0 }, expected: weightedCriteriaScore(configured, { thesis: 8, "custom-second-person": 5, engagement: 0 }) },
  { name: "configured all raw marks", specs: configured, scores: { thesis: 8, voice: 9, "custom-second-person": 5, engagement: 10 }, expected: weightedCriteriaScore(configured, { thesis: 8, voice: 9, "custom-second-person": 5, engagement: 10 }) },
  { name: "all missing", specs: configured, scores: {}, expected: weightedCriteriaScore(configured, {}) },
];
const copyScores = [0, 3.99, 4, 5.99, 6, 7.99, 8, 10];
const summaries = ["A short summary.", "word ".repeat(40), "x".repeat(118) + "東京" + "tail"];
await Bun.write(`${root}/source-reference.json`, JSON.stringify({
  provenance: "Executed original pure TypeScript helpers; retained result/live-review data are synthetic DTO fixtures; no provider invoked.",
  defaults, stored, reconciled: reconcileSpecs(stored), configured, weightedCases,
  weights: [-1, 0, .25, 1, 1.5, 3, 99].map(input => ({ input, clamped: clampWeight(input), up: stepWeight(input, 1), down: stepWeight(input, -1) })),
  history: histories, comparable,
  points: sparklinePoints(comparable as any).map(({ x, y }) => ({ x, y })), delta: scoreDelta(comparable as any),
  copy: copyScores.map(score => ({ score, word: scoreWord(score, 10), verdict: gradeVerdict(score * 10) })),
  moves: [...SPINE_CRITERIA.map(s => s.id), "unknown-custom"].map(id => ({ id, move: nextMoveFor(id) })),
  summaries: summaries.map(input => ({ input, expected: truncateGalleySummary(input) })), result, liveReview,
}, null, 2) + "\n");

const artifacts = {
  result, criteria: configured, history: histories, liveReview,
  futureArtifact: { retain: null },
};
await Bun.write(`${root}/retained-native.json`, JSON.stringify({
  format: "twyne-gpui-rubric", version: 1, generation: 0,
  folios: {
    "original/path/folio:café": artifacts,
    "unmounted/foreign": artifacts,
  },
  legacy: { result, criteria: null, futureLegacy: true },
  futureEnvelope: [null, "keep", 23],
}, null, 2) + "\n");
