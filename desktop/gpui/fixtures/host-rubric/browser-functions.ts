// Pure original computations, executed in Chrome for the offline bridge fixture.
export { htmlToPlainText } from "../../tools/semantic-starter.generated";
export { rubricDraftFingerprint } from "../../tools/semantic-rubric.generated";
export { draftReadiness, MIN_RUBRIC_WORDS } from "../../../../src/utils/draft-thresholds";
export {
  scoreStaticFeatures, combineJudgesAndStatic, UNJUDGED_TARGET_FIT,
} from "../../../../src/utils/rubric";
