import { describe, expect, test } from "bun:test";
import { segmentSpeechText } from "./speech-segments";

describe("segmentSpeechText", () => {
  test("keeps a short passage intact with exact source offsets", () => {
    const source = "  A short opening. A clear ending.  ";
    expect(segmentSpeechText(source)).toEqual([
      {
        text: "A short opening. A clear ending.",
        start: 2,
        end: 34,
      },
    ]);
  });

  test("creates semantic chunks before a long document finishes", () => {
    const sentence =
      "The editor reads a deliberate sentence with enough detail to sound natural.";
    const source = Array.from({ length: 18 }, (_, index) =>
      `${sentence.slice(0, -1)} ${index + 1}.`,
    ).join(" ");
    const chunks = segmentSpeechText(source, { targetWords: 35, maxChars: 500 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(source.slice(chunk.start, chunk.end)).toBe(chunk.text);
      expect(chunk.text).toMatch(/[.!?]$/u);
      expect(chunk.text.length).toBeLessThanOrEqual(500);
    }
  });

  test("keeps first-request work constant as the document grows", () => {
    const sentence =
      "A measured sentence gives the narrator enough context to sound natural.";
    const short = Array.from({ length: 12 }, () => sentence).join(" ");
    const long = Array.from({ length: 360 }, () => sentence).join(" ");
    const shortFirst = segmentSpeechText(short)[0];
    const longFirst = segmentSpeechText(long)[0];

    expect(longFirst.text).toBe(shortFirst.text);
    expect(longFirst.text.length).toBeLessThanOrEqual(900);
    expect(longFirst.end).toBe(shortFirst.end);
  });

  test("a same-shape sentence edit invalidates only its owning chunk", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, index) =>
        `Sentence ${index + 1} carries stable wording for the narration cache.`,
    );
    const before = segmentSpeechText(sentences.join(" "));
    sentences[18] = "Sentence 19 carries revised wording for the narration cache.";
    const after = segmentSpeechText(sentences.join(" "));

    expect(after).toHaveLength(before.length);
    expect(
      after.filter((chunk, index) => chunk.text !== before[index].text),
    ).toHaveLength(1);
  });

  test("preserves paragraph punctuation and never splits through a word", () => {
    const longClause = Array.from(
      { length: 80 },
      (_, index) => `word${index}`,
    ).join(" ");
    const source = `First paragraph.\n\n${longClause}; then the sentence ends.`;
    const chunks = segmentSpeechText(source, { targetWords: 20, maxChars: 140 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(source.slice(chunk.start, chunk.end)).toBe(chunk.text);
      expect(chunk.text).not.toMatch(/^\S*word\d*$/u);
      expect(chunk.text.startsWith(" ")).toBe(false);
      expect(chunk.text.endsWith(" ")).toBe(false);
    }
  });

  test("returns no provider work for blank input", () => {
    expect(segmentSpeechText(" \n\t ")).toEqual([]);
  });
});
