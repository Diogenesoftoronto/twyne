import type {
  ResearchTarget,
  ResearchTargetsResult,
  ResearchSourcesResult,
} from "../src/types.js";

export const target: ResearchTarget = {
  id: "target-1",
  kind: "claim",
  anchor: "Everyone agrees.",
  reason: "Check the consensus.",
  query: "survey consensus",
  importance: 4,
};

export const targets: ResearchTargetsResult = {
  strategy: "model",
  provider: "mock",
  mode: "nonfiction",
  targets: [target],
  candidates: [{ anchor: target.anchor, score: 1 }],
};

const source = {
  title: "Survey",
  url: "https://example.com/survey",
  snippet: "Some agree.",
  publisher: "Research Institute",
  date: "2026-10-23",
};
const other = {
  title: "Discussion",
  url: "https://example.com/discussion",
  snippet: "An overview.",
};

export const sources: ResearchSourcesResult = {
  provider: "mock",
  results: [other, source],
  ranked: [source, other],
};
