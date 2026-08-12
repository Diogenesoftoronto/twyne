import { describe, expect, test } from "bun:test";
import {
  buildSpeechTimeline,
  speechPositionAtProgress,
  speechProgressAtOffset,
} from "./speech-follow-along";

describe("speech follow-along timeline", () => {
  test("keeps apostrophes and hyphens inside words", () => {
    const timeline = buildSpeechTimeline("Don't re-read the well-made line.");

    expect(timeline.words.map((word) => word.text)).toEqual([
      "Don't",
      "re-read",
      "the",
      "well-made",
      "line",
    ]);
  });

  test("groups the active word into its sentence", () => {
    const text = "First sentence. Second sentence, still here! Final thought.";
    const timeline = buildSpeechTimeline(text);
    const second = timeline.words.find((word) => word.text === "still");

    expect(second).toBeDefined();
    const middleOfSecond =
      ((second?.weightStart ?? 0) + (second?.weightEnd ?? 0)) /
      2 /
      timeline.totalWeight;
    const position = speechPositionAtProgress(timeline, middleOfSecond);

    expect(text.slice(position?.wordStart, position?.wordEnd)).toBe("still");
    expect(text.slice(position?.sentenceStart, position?.sentenceEnd)).toBe(
      "Second sentence, still here",
    );
  });

  test("maps a chosen word back to clip progress", () => {
    const text = "Alpha beta, gamma. Delta epsilon.";
    const timeline = buildSpeechTimeline(text);
    const deltaOffset = text.indexOf("Delta") + 2;
    const progress = speechProgressAtOffset(timeline, deltaOffset);
    const position = speechPositionAtProgress(timeline, progress);

    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
    expect(text.slice(position?.wordStart, position?.wordEnd)).toBe("Delta");
  });

  test("clamps offsets and progress at both ends", () => {
    const timeline = buildSpeechTimeline("One two three");

    expect(speechProgressAtOffset(timeline, -10)).toBe(0);
    expect(speechProgressAtOffset(timeline, 10_000)).toBe(1);
    expect(speechPositionAtProgress(timeline, -1)?.wordStart).toBe(0);
    expect(speechPositionAtProgress(timeline, 2)?.wordEnd).toBe(13);
  });
});
