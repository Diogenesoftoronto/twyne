/**
 * One substantive folio: enough prose for the room to judge an emerging
 * argument rather than reacting to an opening fragment.
 */
export const WORDS_PER_FOLIO = 500;

export const MIN_EDITOR_WORDS = WORDS_PER_FOLIO;
export const MIN_MARKUP_WORDS = WORDS_PER_FOLIO;
export const MIN_RUBRIC_WORDS = WORDS_PER_FOLIO;

/** Do not round an incomplete folio up across the editorial boundary. */
export function formatFolioCount(wordCount: number): string {
  const hundredths = Math.floor(
    (Math.max(0, wordCount) * 100) / WORDS_PER_FOLIO,
  );
  return (hundredths / 100).toFixed(2);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function draftReadiness(
  text: string,
  minWords: number,
):
  | { ok: true; wordCount: number }
  | { ok: false; wordCount: number; message: string } {
  const wordCount = countWords(text);
  if (wordCount >= minWords) return { ok: true, wordCount };
  return {
    ok: false,
    wordCount,
    message: `Write at least ${minWords} words before asking the room to judge it. Current draft: ${wordCount} words.`,
  };
}
