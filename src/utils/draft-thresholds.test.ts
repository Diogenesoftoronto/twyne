import { describe, expect, test } from "bun:test";
import {
  MIN_EDITOR_WORDS,
  MIN_MARKUP_WORDS,
  MIN_RUBRIC_WORDS,
  WORDS_PER_FOLIO,
  draftReadiness,
  formatFolioCount,
} from "./draft-thresholds";

const words = (count: number) => "word ".repeat(count).trim();

describe("the substantive folio boundary", () => {
  test("uses one 500-word boundary for the counter and editorial gates", () => {
    expect(WORDS_PER_FOLIO).toBe(500);
    expect(MIN_EDITOR_WORDS).toBe(WORDS_PER_FOLIO);
    expect(MIN_MARKUP_WORDS).toBe(WORDS_PER_FOLIO);
    expect(MIN_RUBRIC_WORDS).toBe(WORDS_PER_FOLIO);
  });

  test("blocks an opening fragment and opens the room at 500 words", () => {
    const fragment = draftReadiness(words(499), WORDS_PER_FOLIO);
    expect(fragment.ok).toBe(false);
    if (!fragment.ok) {
      expect(fragment.wordCount).toBe(499);
      expect(fragment.message).toContain("at least 500 words");
    }

    expect(draftReadiness(words(500), WORDS_PER_FOLIO)).toEqual({
      ok: true,
      wordCount: 500,
    });
  });

  test("shows a complete folio only when the draft reaches the boundary", () => {
    expect(formatFolioCount(0)).toBe("0.00");
    expect(formatFolioCount(499)).toBe("0.99");
    expect(formatFolioCount(500)).toBe("1.00");
    expect(formatFolioCount(999)).toBe("1.99");
    expect(formatFolioCount(1_000)).toBe("2.00");
  });
});
