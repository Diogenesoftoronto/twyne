import { expect, test } from "bun:test";
import { createLocalLiveInput } from "./live-voice-local-input";

test("sustained speech interrupts once and yields a resampled turn after silence", () => {
  let interrupts = 0;
  let turn: Float32Array | null = null;
  const input = createLocalLiveInput({
    interrupt: () => interrupts++,
    turn: (audio) => {
      turn = audio;
    },
  });
  const bytes = new Uint8Array(4800);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 2400; i++) view.setInt16(i * 2, 8192, true);
  const chunk = btoa(String.fromCharCode(...bytes));
  for (let i = 0; i < 3; i++) input.push(chunk, 0.2);
  expect(interrupts).toBe(1);
  for (let i = 0; i < 8; i++) input.push(chunk, 0);
  expect(turn).not.toBeNull();
  expect((turn as unknown as Float32Array).length).toBe(17600);
  expect((turn as unknown as Float32Array)[100]).toBeCloseTo(0.25, 3);
  expect(interrupts).toBe(1);
});
