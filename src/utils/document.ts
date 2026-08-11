import type { DocumentMeta } from "../types";

const WORDS_PER_MINUTE = 238;

/**
 * Count words without materialising the word array.
 *
 * `text.trim().split(/\s+/)` allocates one string per word in the manuscript
 * only to read `.length` off the result. On a long draft that is the single
 * largest allocation in the keystroke path, so we walk the string instead.
 */
export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // space, tab, LF, CR, VT, FF, NBSP
    const isSpace =
      code === 32 ||
      (code >= 9 && code <= 13) ||
      code === 160;
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export function computeDocumentMeta(text: string): DocumentMeta {
  const wordCount = countWords(text);
  return {
    title: extractTitle(text),
    wordCount,
    characterCount: text.length,
    readingTime: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
  };
}

/**
 * Write freshly computed meta into an existing (reactive) meta object,
 * touching only the fields that actually changed.
 *
 * Assigning `store.meta = computeDocumentMeta(...)` replaces the object and so
 * invalidates every subscriber on every keystroke. Mutating in place lets
 * Qwik's per-property tracking do its job: a component reading
 * `store.meta.title` re-renders when the title changes, not when the writer
 * types another character into paragraph nine.
 */
export function applyDocumentMeta(target: DocumentMeta, text: string): void {
  const next = computeDocumentMeta(text);
  if (target.title !== next.title) target.title = next.title;
  if (target.wordCount !== next.wordCount) target.wordCount = next.wordCount;
  if (target.characterCount !== next.characterCount) {
    target.characterCount = next.characterCount;
  }
  if (target.readingTime !== next.readingTime) {
    target.readingTime = next.readingTime;
  }
}

function extractTitle(text: string): string {
  const firstBreak = text.indexOf("\n");
  const firstLine = (
    firstBreak === -1 ? text : text.slice(0, firstBreak)
  ).trim();
  if (firstLine.startsWith("# ")) {
    return firstLine.replace(/^#+\s*/, "");
  }
  const firstSentence = firstLine.split(/[.!?]/)[0] || "";
  return firstSentence.length > 60
    ? firstSentence.slice(0, 57) + "..."
    : firstSentence || "Untitled";
}

export function formatWordCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export function readingTimeLabel(minutes: number): string {
  if (minutes < 1) return "< 1 min read";
  if (minutes === 1) return "1 min read";
  return `${minutes} min read`;
}
