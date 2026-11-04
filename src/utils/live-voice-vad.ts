/** State for 100 ms microphone chunks. Levels use liveVoiceAudio's 0–1 scale. */
export function createLiveVoiceVad({
  speechLevel = 0.08,
  startChunks = 3,
  endChunks = 8,
} = {}) {
  let voiced = 0;
  let silent = 0;
  let active = false;
  return {
    reset() {
      voiced = silent = 0;
      active = false;
    },
    push(level: number): "start" | "end" | null {
      if (Number.isFinite(level) && level >= speechLevel) {
        voiced++;
        silent = 0;
        if (!active && voiced >= startChunks) {
          active = true;
          return "start";
        }
      } else {
        voiced = 0;
        if (active && ++silent >= endChunks) {
          active = false;
          silent = 0;
          return "end";
        }
      }
      return null;
    },
  };
}
