import type { SentenceLabProps } from "./catalog";
import { sentenceContext } from "../../utils/sentence-bench";
export const BENCH_SENTENCE =
  "She had not told her brother that the house was sold.";
export const BENCH_PARAGRAPH = `Mara learned about the sale that morning. ${BENCH_SENTENCE} He was already packing for his visit.`;
const from = BENCH_PARAGRAPH.indexOf(BENCH_SENTENCE);
export const OFFLINE_BENCH_FIXTURE: SentenceLabProps = {
  sentence: BENCH_SENTENCE,
  sentenceId: "fixture-house-sale",
  context: sentenceContext(BENCH_PARAGRAPH, from, from + BENCH_SENTENCE.length),
};
export const STALE_BENCH_FIXTURE: SentenceLabProps = {
  ...OFFLINE_BENCH_FIXTURE,
  stale: true,
};
export const TRIAL_BENCH_FIXTURE: SentenceLabProps = {
  ...OFFLINE_BENCH_FIXTURE,
  trial: "She had kept the sale from her brother.",
};
export const REFUSED_BENCH_FIXTURE: SentenceLabProps = {
  sentence: BENCH_PARAGRAPH,
  refusal:
    "The selection covers 2 sentences. Select one sentence to compare a revision.",
};
