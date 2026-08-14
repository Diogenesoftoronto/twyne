import { describe, expect, test } from "bun:test";
import {
  SseJsonDecoder,
  alignmentRangeAtSourceOffset,
  alignmentRangeAtTime,
  mapFishTimestampEvent,
} from "./speech-alignment";

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
