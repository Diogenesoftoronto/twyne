import type { EditorNote, RubricGrade } from "../src/types.js";

export const note: EditorNote = {
  personaId: "devil",
  personaName: "Mlle. Sceptique",
  text: "What supports this claim?",
  type: "critique",
  provider: "mock",
  anchor: "Everyone agrees.",
  anchors: ["Everyone agrees.", "No one objects."],
};
const score = { score: 4, rationale: "Supported.", provider: "mock" };
export const grade: RubricGrade = {
  grade: "B",
  combined: 4,
  judgeMean: 4,
  minJudge: 4,
  staticTotal: 4,
  staticFeedback: [],
  judges: [{ personaId: "devil", ...score }],
  sufficiency: score,
  evidence: score,
  integrity: score,
  targetFit: score,
  custom: [{ label: "Clarity", ...score }],
  review: { text: "Keep going.", provider: "mock" },
};
export const rewrite = {
  replacement: "Some agree.",
  rationale: "Narrow the claim.",
  provider: "mock",
};
export const interview = {
  kind: "question",
  text: "Who is your reader?",
  provider: "mock",
  model: "test",
};
export const brief = { audience: "Curious readers" };
