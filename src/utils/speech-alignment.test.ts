import { describe, expect, test } from "bun:test";
import {
  SseJsonDecoder,
  alignmentRangeAtSourceOffset,
  alignmentRangeAtTime,
  mapFishTimestampEvent,
  mapElevenLabsTimestamps,
} from "./speech-alignment";

function elevenChunk(text: string, offset = 0) {
  const characters = Array.from(text);
  return {
    characters,
    character_start_times_seconds: characters.map(
      (_, index) => offset + index * 0.1,
    ),
    character_end_times_seconds: characters.map(
      (_, index) => offset + (index + 1) * 0.1,
    ),
  };
}

describe("ElevenLabs character timing", () => {
  test("joins provider chunks into word spans without restarting the audio clock", () => {
    const ranges = mapElevenLabsTimestamps("The light stays on.", [
      elevenChunk("The li"),
      elevenChunk("ght stays on.", 0.6),
    ]);
    expect(ranges.map((range) => [range.sourceStart, range.sourceEnd])).toEqual(
      [
        [0, 3],
        [4, 9],
        [10, 15],
        [16, 18],
      ],
    );
    expect(ranges[1].audioStart).toBeCloseTo(0.4);
    expect(ranges[1].audioEnd).toBeCloseTo(0.9);
    expect(alignmentRangeAtTime(ranges, 1.2)?.sourceStart).toBe(10);
  });

  test("keeps UTF-16 offsets, repeated words and punctuation attached to the exact source", () => {
    const source = "😀 Café, café — don't stop. Stop!";
    const ranges = mapElevenLabsTimestamps(source, [elevenChunk(source)]);
    expect(
      ranges.map((range) => source.slice(range.sourceStart, range.sourceEnd)),
    ).toEqual(["Café", "café", "don't", "stop", "Stop"]);
    expect(ranges[0].sourceStart).toBe(3);
    expect(ranges[1].sourceStart).toBe(9);
  });

  test("normalization mismatches omit unverified words instead of inventing times", () => {
    const source = "Wait 20 minutes, then wait.";
    const ranges = mapElevenLabsTimestamps(source, [
      elevenChunk("Wait twenty minutes then wait"),
    ]);
    expect(
      ranges.map((range) => source.slice(range.sourceStart, range.sourceEnd)),
    ).toEqual(["Wait", "minutes", "then", "wait"]);
  });

  test("missing, malformed and backwards provider timings never become word highlights", () => {
    for (const value of [
      null,
      {},
      [],
      [
        {
          characters: ["a"],
          character_start_times_seconds: [],
          character_end_times_seconds: [1],
        },
      ],
      [
        {
          characters: ["a"],
          character_start_times_seconds: [-1],
          character_end_times_seconds: [0],
        },
      ],
      [
        {
          characters: ["a"],
          character_start_times_seconds: [1],
          character_end_times_seconds: [NaN],
        },
      ],
      [elevenChunk("one", 1), elevenChunk("two", 0)],
    ]) {
      expect(mapElevenLabsTimestamps("a one two", value)).toEqual([]);
    }
  });
});

describe("SseJsonDecoder", () => {
  test("parses frames split across arbitrary network chunks", () => {
    const decoder = new SseJsonDecoder<{ type: string; audio?: string }>();
    expect(decoder.push('data: {"type":"audio","au')).toEqual([]);
    expect(decoder.push('dio":"abc"}\n\ndata: {"type":"done"}\n\n')).toEqual([
      { type: "audio", audio: "abc" },
      { type: "done" },
    ]);
  });

  test("flushes a final frame without a trailing SSE boundary", () => {
    const decoder = new SseJsonDecoder<{ type: string }>();
    expect(decoder.push('data: {"type":"done"}')).toEqual([]);
    expect(decoder.finish()).toEqual([{ type: "done" }]);
  });
});

describe("Fish Audio alignment", () => {
  test("maps native segment timing to exact source offsets", () => {
    const source = "Hello world. Another line.";
    const ranges = mapFishTimestampEvent(
      source,
      {
        content: "Hello world.",
        chunk_seq: 0,
        chunk_audio_offset_sec: 0.25,
        alignment: {
          segments: [
            { text: "Hello", start: 0, end: 0.4 },
            { text: "world", start: 0.4, end: 0.8 },
          ],
        },
      },
      0,
    );
    expect(ranges).toEqual([
      {
        sourceStart: 0,
        sourceEnd: 5,
        audioStart: 0.25,
        audioEnd: 0.65,
        precision: "word",
      },
      {
        sourceStart: 6,
        sourceEnd: 11,
        audioStart: 0.65,
        audioEnd: 1.05,
        precision: "word",
      },
    ]);
  });

  test("drops normalized text that cannot be mapped exactly", () => {
    expect(
      mapFishTimestampEvent(
        "It cost $12.",
        {
          content: "It cost twelve dollars.",
          alignment: {
            segments: [{ text: "twelve", start: 0.2, end: 0.6 }],
          },
        },
        0,
      ),
    ).toEqual([]);
  });

  test("resolves playback time to the native range", () => {
    const ranges = [
      {
        sourceStart: 0,
        sourceEnd: 5,
        audioStart: 0,
        audioEnd: 0.5,
        precision: "word" as const,
      },
      {
        sourceStart: 6,
        sourceEnd: 11,
        audioStart: 0.5,
        audioEnd: 1,
        precision: "word" as const,
      },
    ];
    expect(alignmentRangeAtTime(ranges, 0.75)?.sourceStart).toBe(6);
    expect(alignmentRangeAtSourceOffset(ranges, 8)?.audioStart).toBe(0.5);
    expect(alignmentRangeAtSourceOffset(ranges, 99)).toBeNull();
  });
});
