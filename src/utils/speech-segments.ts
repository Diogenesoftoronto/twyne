/**
 * Semantic chunks for progressive narration.
 *
 * Providers accept much more text than a useful interactive first request.
 * Keeping the first request around a spoken paragraph lets playback begin
 * while later chunks synthesize in the background. Offsets always point back
 * into the exact source string so follow-along highlighting never has to
 * search for a repeated sentence.
 */

export interface SpeechTextSegment {
  text: string;
  /** Inclusive character offset in the original source. */
  start: number;
  /** Exclusive character offset in the original source. */
  end: number;
}

export interface SpeechSegmentationOptions {
  /** Roughly 20-30 seconds at an ordinary narration pace. */
  targetWords?: number;
  /** Safety cap well below the 4096-character OpenAI speech limit. */
  maxChars?: number;
}

const DEFAULT_TARGET_WORDS = 65;
const DEFAULT_MAX_CHARS = 900;

interface TextSpan {
  start: number;
  end: number;
}

function trimSpan(text: string, start: number, end: number): TextSpan | null {
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function sentenceSpans(text: string): TextSpan[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    return Array.from(segmenter.segment(text)).flatMap((part) => {
      const span = trimSpan(text, part.index, part.index + part.segment.length);
      return span ? [span] : [];
    });
  }

  // Conservative fallback for older browsers. A boundary is punctuation (or
  // a paragraph break) followed by whitespace; punctuation and closing quotes
  // stay with the sentence rather than beginning the next provider request.
  const spans: TextSpan[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const paragraphBreak =
      character === "\n" && /\n/u.test(text.slice(index + 1, index + 3));
    const sentenceEnd = /[.!?\u2026]/u.test(character);
    if (!paragraphBreak && !sentenceEnd) continue;

    let end = index + 1;
    while (end < text.length && /["'\u2019\u201d)\]]/u.test(text[end])) end += 1;
    if (!paragraphBreak && end < text.length && !/\s/u.test(text[end])) continue;

    const span = trimSpan(text, start, end);
    if (span) spans.push(span);
    start = end;
    index = end - 1;
  }
  const tail = trimSpan(text, start, text.length);
  if (tail) spans.push(tail);
  return spans;
}

function splitLongSpan(text: string, span: TextSpan, maxChars: number): TextSpan[] {
  const result: TextSpan[] = [];
  let start = span.start;
  while (span.end - start > maxChars) {
    const limit = start + maxChars;
    const floor = start + Math.floor(maxChars * 0.55);
    let split = -1;

    // Prefer a clause or paragraph boundary, then any whitespace. Searching
    // backwards keeps chunks bounded without cutting through a word.
    for (let index = limit; index >= floor; index -= 1) {
      if (/[;:\u2014\n]/u.test(text[index - 1]) && /\s/u.test(text[index] ?? "")) {
        split = index;
        break;
      }
    }
    if (split < 0) {
      for (let index = limit; index >= floor; index -= 1) {
        if (/\s/u.test(text[index])) {
          split = index;
          break;
        }
      }
    }
    // An unbroken token can exceed the preferred cap. Keep it intact; provider
    // limits are enforced separately and splitting a word would corrupt speech.
    if (split < 0) break;

    const piece = trimSpan(text, start, split);
    if (piece) result.push(piece);
    start = split;
    while (start < span.end && /\s/u.test(text[start])) start += 1;
  }
  const tail = trimSpan(text, start, span.end);
  if (tail) result.push(tail);
  return result;
}

/** Split prose into stable, source-addressable narration chunks. */
export function segmentSpeechText(
  source: string,
  options: SpeechSegmentationOptions = {},
): SpeechTextSegment[] {
  const targetWords = Math.max(1, options.targetWords ?? DEFAULT_TARGET_WORDS);
  const maxChars = Math.max(80, options.maxChars ?? DEFAULT_MAX_CHARS);
  const sentences = sentenceSpans(source).flatMap((span) =>
    splitLongSpan(source, span, maxChars),
  );
  if (!sentences.length) return [];

  const chunks: SpeechTextSegment[] = [];
  let chunkStart = sentences[0].start;
  let chunkEnd = sentences[0].end;
  let chunkWords = wordCount(source.slice(chunkStart, chunkEnd));

  const flush = () => {
    const span = trimSpan(source, chunkStart, chunkEnd);
    if (!span) return;
    chunks.push({
      start: span.start,
      end: span.end,
      text: source.slice(span.start, span.end),
    });
  };

  for (const sentence of sentences.slice(1)) {
    const candidateChars = sentence.end - chunkStart;
    const sentenceWords = wordCount(source.slice(sentence.start, sentence.end));
    if (candidateChars > maxChars || chunkWords >= targetWords) {
      flush();
      chunkStart = sentence.start;
      chunkEnd = sentence.end;
      chunkWords = sentenceWords;
      continue;
    }
    chunkEnd = sentence.end;
    chunkWords += sentenceWords;
  }
  flush();
  return chunks;
}
