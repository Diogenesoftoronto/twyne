import type { SentenceLabProps } from "./catalog";
import {
  localSentenceCandidates,
  sentenceContext,
  sentencePlacementChoices,
} from "../../utils/sentence-bench";
export const BENCH_SENTENCE =
  "We made a decision to leave in order to find a very quiet room.";
export const BENCH_PARAGRAPH = `The old map remained. ${BENCH_SENTENCE} We followed the river.`;
const from = BENCH_PARAGRAPH.indexOf(BENCH_SENTENCE);
export const OFFLINE_BENCH_FIXTURE: SentenceLabProps = {
  sentence: BENCH_SENTENCE,
  sentenceId: "fixture-map-room",
  attempts: [],
  variants: [],
  candidates: localSentenceCandidates(BENCH_SENTENCE),
  context: sentenceContext(BENCH_PARAGRAPH, from, from + BENCH_SENTENCE.length),
  placements: sentencePlacementChoices(
    BENCH_PARAGRAPH,
    from,
    from + BENCH_SENTENCE.length,
  ),
};
export const STALE_BENCH_FIXTURE: SentenceLabProps = {
  ...OFFLINE_BENCH_FIXTURE,
  stale: true,
};
export const SETTLED_BENCH_FIXTURE: SentenceLabProps = {
  ...OFFLINE_BENCH_FIXTURE,
  attempts: ["We chose a quieter room before setting out."],
  candidates: localSentenceCandidates(BENCH_SENTENCE, [
    {
      text: "We chose a quieter room before setting out.",
      at: 1770000000000,
      source: "yours",
    },
  ]),
};
