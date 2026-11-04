import { expect, test } from "bun:test";
import { localLiveLogMel } from "./live-voice-local-inference";

test("16 kHz silence uses the configured log floor and frame padding", () => {
  const result = localLiveLogMel(new Float32Array(16000));
  expect(result.frames).toBe(99);
  expect(result.data).toHaveLength(128 * 99);
  expect(result.data.every((value) => value === -2)).toBe(true);
});
