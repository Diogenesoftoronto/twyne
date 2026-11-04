import { expect, test } from "bun:test";
import { createLiveVoiceVad } from "./live-voice-vad";

test("voice activity requires sustained speech and silence", () => {
  const vad = createLiveVoiceVad();
  expect([vad.push(0.2), vad.push(0.2), vad.push(0.01)]).toEqual([
    null,
    null,
    null,
  ]);
  expect([vad.push(0.2), vad.push(0.2), vad.push(0.2)]).toEqual([
    null,
    null,
    "start",
  ]);
  expect(Array.from({ length: 7 }, () => vad.push(0))).toEqual(
    Array(7).fill(null),
  );
  expect(vad.push(0)).toBe("end");
  expect(vad.push(0)).toBeNull();
});

test("reset discards partial speech and active state", () => {
  const vad = createLiveVoiceVad({ startChunks: 1 });
  expect(vad.push(0.2)).toBe("start");
  vad.reset();
  expect(vad.push(0)).toBeNull();
  expect(vad.push(0.2)).toBe("start");
});
