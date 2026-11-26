/** Measure one short turn with the bundled sample. The microphone is not used. */
export async function profileLocalVoice(
  worker: Worker,
  signal: AbortSignal,
): Promise<"ready" | "slow" | "unknown"> {
  const { default: fixture } = await import(
    "../assets/live-voice-benchmark.wav?inline"
  );
  const response = await fetch(fixture, { signal });
  const bytes = await response.arrayBuffer();
  const view = new DataView(bytes);
  let offset = 12;
  while (
    offset + 8 <= bytes.byteLength &&
    view.getUint32(offset, false) !== 0x64617461
  ) {
    const size = view.getUint32(offset + 4, true);
    offset += 8 + size + (size % 2);
  }
  if (offset + 8 > bytes.byteLength) return "unknown";
  const count = view.getUint32(offset + 4, true) / 2;
  if (!Number.isInteger(count) || offset + 8 + count * 2 > bytes.byteLength)
    return "unknown";
  const audio = Float32Array.from(
    { length: count },
    (_, i) => view.getInt16(offset + 8 + i * 2, true) / 32768,
  );
  if (signal.aborted) return "unknown";

  return new Promise((resolve) => {
    const id = -1;
    const started = performance.now();
    let samples = 0;
    const finish = (result: "ready" | "slow" | "unknown", cancel = false) => {
      clearTimeout(timer);
      worker.removeEventListener("message", message);
      signal.removeEventListener("abort", abort);
      if (cancel) worker.postMessage({ type: "cancel", id });
      resolve(result);
    };
    const abort = () => finish("unknown", true);
    const message = ({ data }: MessageEvent) => {
      if (data?.id !== id) return;
      if (data.type === "audio" && data.samples instanceof Float32Array)
        samples += data.samples.length;
      if (data.type === "error") {
        finish("unknown");
        return;
      }
      if (data.type !== "done" && samples < 24_000) return;
      const seconds = (performance.now() - started) / 1000;
      finish(
        samples === 0
          ? "unknown"
          : samples / 24_000 >= seconds
            ? "ready"
            : "slow",
        data.type !== "done",
      );
    };
    const timer = setTimeout(() => finish("slow", true), 12_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("message", message);
    worker.postMessage({
      type: "turn",
      id,
      audio,
      instructions: "Reply with one short spoken word.",
      mode: "interleaved",
    });
  });
}
