/**
 * Build an approximate word timeline for generated narration.
 *
 * Speech providers currently return one audio clip, without word-level
 * alignment data. Character count plus a little punctuation weight gives the
 * UI a stable read-along cue and, importantly, makes the inverse operation
 * possible: a word in the rendered prose can be mapped back to clip time.
 */

export interface SpeechTimelineWord {
  text: string;
  start: number;
  end: number;
  sentenceStart: number;
  sentenceEnd: number;
  weightStart: number;
  weightEnd: number;
}

export interface SpeechTimeline {
  words: SpeechTimelineWord[];
  totalWeight: number;
}

export interface SpeechTimelinePosition {
  wordStart: number;
  wordEnd: number;
  sentenceStart: number;
  sentenceEnd: number;
}

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu;

function pauseWeight(separator: string): number {
  if (/[.!?]/u.test(separator)) return 5;
  if (/\n\s*\n/u.test(separator)) return 4;
  if (/[,;:–—]/u.test(separator)) return 2;
  return 1;
}

function endsSentence(separator: string): boolean {
  return (
    /[.!?](?:["'’”\])}]*)?(?:\s|$)/u.test(separator) ||
    /\n\s*\n/u.test(separator)
  );
}

/** Convert rendered prose into weighted words and sentence ranges. */
export function buildSpeechTimeline(text: string): SpeechTimeline {
  const matches = Array.from(text.matchAll(WORD_PATTERN));
  if (!matches.length) return { words: [], totalWeight: 0 };

  const words: SpeechTimelineWord[] = [];
  let totalWeight = 0;
  let sentenceWordStart = 0;

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const separator = text.slice(end, nextStart);
    const weightStart = totalWeight;
    totalWeight +=
      Math.max(Array.from(value).length, 1) + pauseWeight(separator);

    words.push({
      text: value,
      start,
      end,
      sentenceStart: start,
      sentenceEnd: end,
      weightStart,
      weightEnd: totalWeight,
    });

    if (endsSentence(separator) || index === matches.length - 1) {
      const sentenceStart = words[sentenceWordStart].start;
      const sentenceEnd = end;
      for (
        let wordIndex = sentenceWordStart;
        wordIndex <= index;
        wordIndex += 1
      ) {
        words[wordIndex].sentenceStart = sentenceStart;
        words[wordIndex].sentenceEnd = sentenceEnd;
      }
      sentenceWordStart = index + 1;
    }
  }

  return { words, totalWeight };
}

/** Find the current word and sentence at a normalized clip position. */
export function speechPositionAtProgress(
  timeline: SpeechTimeline,
  progress: number,
): SpeechTimelinePosition | null {
  if (!timeline.words.length || timeline.totalWeight <= 0) return null;
  const normalized = Math.max(0, Math.min(progress, 1));
  const target = normalized * timeline.totalWeight;
  const word =
    timeline.words.find((candidate) => target < candidate.weightEnd) ??
    timeline.words[timeline.words.length - 1];

  return {
    wordStart: word.start,
    wordEnd: word.end,
    sentenceStart: word.sentenceStart,
    sentenceEnd: word.sentenceEnd,
  };
}

/** Map a character offset in rendered prose back to normalized clip time. */
export function speechProgressAtOffset(
  timeline: SpeechTimeline,
  offset: number,
): number {
  if (!timeline.words.length || timeline.totalWeight <= 0) return 0;
  const clamped = Math.max(0, offset);
  const first = timeline.words[0];
  if (clamped <= first.start) return 0;

  for (let index = 0; index < timeline.words.length; index += 1) {
    const word = timeline.words[index];
    if (clamped <= word.end) {
      const wordLength = Math.max(word.end - word.start, 1);
      const withinWord = Math.max(
        0,
        Math.min((clamped - word.start) / wordLength, 1),
      );
      return (
        (word.weightStart + withinWord * (word.weightEnd - word.weightStart)) /
        timeline.totalWeight
      );
    }

    const next = timeline.words[index + 1];
    if (next && clamped < next.start) {
      return next.weightStart / timeline.totalWeight;
    }
  }

  return 1;
}
