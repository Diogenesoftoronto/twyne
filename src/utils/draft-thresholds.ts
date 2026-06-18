export const MIN_EDITOR_WORDS = 80;
export const MIN_MARKUP_WORDS = 120;
export const MIN_RUBRIC_WORDS = 220;

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
