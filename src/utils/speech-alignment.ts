export type SpeechAlignmentPrecision = "word" | "segment";

export interface SpeechAlignmentRange {
  /** Character offsets within the exact text sent for this audio clip. */
  sourceStart: number;
  sourceEnd: number;
  audioStart: number;
  audioEnd: number;
  precision: SpeechAlignmentPrecision;
}

export interface SpeechAlignmentSnapshot {
  provider: string;
  ranges: SpeechAlignmentRange[];
}

/** fal returns consecutive character-alignment chunks with absolute clip times. */
export function mapElevenLabsTimestamps(
  source: string,
  value: unknown,
): SpeechAlignmentRange[] {
  if (!Array.isArray(value)) return [];
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let previous = 0;
  for (const chunk of value) {
    if (!chunk || typeof chunk !== "object") return [];
    const {
      characters,
      character_start_times_seconds: from,
      character_end_times_seconds: to,
    } = chunk;
    if (
      !Array.isArray(characters) ||
      !Array.isArray(from) ||
      !Array.isArray(to) ||
      characters.length !== from.length ||
      characters.length !== to.length
    )
      return [];
    for (let i = 0; i < characters.length; i += 1) {
      const char = characters[i];
      const start = from[i];
      const end = to[i];
      if (
        typeof char !== "string" ||
        char.length > 16 ||
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < previous ||
        end < start
      )
        return [];
      text += char;
      // DOM/source offsets use UTF-16, including both halves of an emoji.
      for (let unit = 0; unit < char.length; unit += 1) {
        starts.push(start);
        ends.push(end);
      }
      previous = start;
    }
    if (text.length > 50_000) return [];
  }

  const words = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;
  const sourceWords = [...source.matchAll(words)];
  let cursor = 0;
  const ranges: SpeechAlignmentRange[] = [];
  for (const word of text.matchAll(words)) {
    const matched = sourceWords.findIndex(
      (candidate, index) => index >= cursor && candidate[0] === word[0],
    );
    if (matched < 0) continue;
    const sourceWord = sourceWords[matched];
    const audioStart = starts[word.index];
    const audioEnd = ends[word.index + word[0].length - 1];
    if (audioEnd > audioStart) {
      ranges.push({
        sourceStart: sourceWord.index,
        sourceEnd: sourceWord.index + sourceWord[0].length,
        audioStart,
        audioEnd,
        precision: "word",
      });
    }
    cursor = matched + 1;
  }
  return ranges;
}

export interface FishTimestampEvent {
  content?: string;
  chunk_seq?: number;
  chunk_audio_offset_sec?: number;
  alignment?: {
    segments?: Array<{ text?: string; start?: number; end?: number }>;
  } | null;
}

/** Incremental SSE decoder that tolerates arbitrary network chunk boundaries. */
export class SseJsonDecoder<T> {
  private buffer = "";

  push(chunk: string): T[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: T[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") {
        try {
          events.push(JSON.parse(data) as T);
        } catch {
          // A malformed provider frame is ignored; later complete frames still
          // carry playable audio and superseding alignment snapshots.
        }
      }
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }

  /** Parse a final provider frame even when the stream omits a blank line. */
  finish(): T[] {
    return this.buffer.trim() ? this.push("\n\n") : [];
  }
}

/**
 * Map Fish's cumulative per-chunk timing snapshot back to exact source text.
 * If provider normalization prevents an exact match, omit that range rather
 * than presenting a guessed word boundary as authoritative.
 */
export function mapFishTimestampEvent(
  source: string,
  event: FishTimestampEvent,
  sourceStart: number,
): SpeechAlignmentRange[] {
  const content = event.content ?? "";
  const segments = event.alignment?.segments ?? [];
  const audioOffset = Number(event.chunk_audio_offset_sec) || 0;
  let contentCursor = 0;
  const ranges: SpeechAlignmentRange[] = [];

  for (const segment of segments) {
    const text = segment.text ?? "";
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (
      !text ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      continue;
    }
    const localStart = content.indexOf(text, contentCursor);
    if (localStart < 0) continue;
    const absoluteStart = sourceStart + localStart;
    if (source.slice(absoluteStart, absoluteStart + text.length) !== text)
      continue;
    ranges.push({
      sourceStart: absoluteStart,
      sourceEnd: absoluteStart + text.length,
      audioStart: audioOffset + start,
      audioEnd: audioOffset + end,
      precision: /\s/u.test(text.trim()) ? "segment" : "word",
    });
    contentCursor = localStart + text.length;
  }
  return ranges;
}

export function alignmentRangeAtTime(
  ranges: readonly SpeechAlignmentRange[],
  seconds: number,
): SpeechAlignmentRange | null {
  if (!Number.isFinite(seconds)) return null;
  const active = ranges.find(
    (range) => seconds >= range.audioStart && seconds < range.audioEnd,
  );
  if (active) return active;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    if (seconds >= ranges[index].audioStart) return ranges[index];
  }
  return null;
}

export function alignmentRangeAtSourceOffset(
  ranges: readonly SpeechAlignmentRange[],
  offset: number,
): SpeechAlignmentRange | null {
  if (!Number.isFinite(offset)) return null;
  return (
    ranges.find(
      (range) => offset >= range.sourceStart && offset <= range.sourceEnd,
    ) ?? null
  );
}
