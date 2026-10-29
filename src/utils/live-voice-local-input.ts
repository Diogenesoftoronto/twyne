import { createLiveVoiceVad } from "./live-voice-vad";

/** Collect 24 kHz microphone chunks into 16 kHz turns, with a short pre-roll. */
export function createLocalLiveInput(callbacks: {
  interrupt: () => void;
  turn: (audio: Float32Array) => void;
}) {
  const vad = createLiveVoiceVad();
  let active = false;
  let preRoll: Float32Array[] = [];
  let chunks: Float32Array[] = [];
  let count = 0;
  const reset = () => {
    vad.reset();
    active = false;
    preRoll = [];
    chunks = [];
    count = 0;
  };
  return {
    reset,
    push(base64: string, level: number) {
      const bytes = Uint8Array.from(atob(base64), (character) =>
        character.charCodeAt(0),
      );
      if (bytes.length % 2) throw new Error("Invalid microphone audio.");
      const pcm = new DataView(bytes.buffer);
      const chunk = Float32Array.from(
        { length: bytes.length / 2 },
        (_, i) => pcm.getInt16(i * 2, true) / 32768,
      );
      const event = vad.push(level);
      if (!active) {
        preRoll.push(chunk);
        if (preRoll.length > 3) preRoll.shift();
        if (event === "start") {
          active = true;
          callbacks.interrupt();
          chunks = preRoll;
          count = chunks.reduce((sum, part) => sum + part.length, 0);
          preRoll = [];
        }
        return;
      }
      chunks.push(chunk);
      count += chunk.length;
      if (event !== "end" && count < 24_000 * 60) return;
      const input = new Float32Array(count);
      let offset = 0;
      for (const part of chunks) {
        input.set(part, offset);
        offset += part.length;
      }
      const output = Float32Array.from(
        { length: Math.floor((input.length * 2) / 3) },
        (_, i) => {
          const position = i * 1.5;
          const center = Math.floor(position);
          let sum = 0,
            weight = 0;
          for (let tap = -16; tap <= 16; tap++) {
            const source = center + tap;
            if (source < 0 || source >= input.length) continue;
            const distance = position - source;
            const sinc =
              distance === 0
                ? 0.6
                : Math.sin(Math.PI * 0.6 * distance) / (Math.PI * distance);
            const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / 17);
            const coefficient = sinc * window;
            sum += input[source] * coefficient;
            weight += coefficient;
          }
          return weight ? sum / weight : 0;
        },
      );
      reset();
      callbacks.turn(output);
    },
  };
}
