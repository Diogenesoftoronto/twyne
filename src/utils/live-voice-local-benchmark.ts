import { LOCAL_LIVE_REVISION } from "./live-voice-local-model";

export interface LocalLiveRate {
  adapter: string;
  revision: string;
  rate: number;
}

const KEY = "twyne.local-live.benchmark.v1";

/** An empty fingerprint cannot establish that the same adapter is still in use. */
export function readLocalLiveRate(adapter: string): LocalLiveRate | null {
  if (!adapter || typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as LocalLiveRate | null;
    return value?.adapter === adapter &&
      value.revision === LOCAL_LIVE_REVISION &&
      Number.isFinite(value.rate) &&
      value.rate > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveLocalLiveRate(adapter: string, rate: number): void {
  if (
    !adapter ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    typeof localStorage === "undefined"
  )
    return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ adapter, revision: LOCAL_LIVE_REVISION, rate }),
    );
  } catch {
    /* benchmark can run again */
  }
}

/** Benchmark a loaded worker using a real fixed 16 kHz speech sample. */
export function benchmarkLocalLive(
  worker: Worker,
  audio: Float32Array,
  id: number,
  timeoutMs = 180_000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let samples = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      const elapsed = (performance.now() - started) / 1000;
      if (error) reject(error);
      else if (!samples || elapsed <= 0)
        reject(new Error("Local Live benchmark produced no audio."));
      else resolve(samples / 24_000 / elapsed);
    };
    const onError = () =>
      finish(new Error("Local Live benchmark worker failed."));
    const onMessage = ({ data }: MessageEvent) => {
      if (data?.id !== id) return;
      if (data.type === "audio" && data.samples instanceof Float32Array)
        samples += data.samples.length;
      if (data.type === "done") finish();
      if (data.type === "error")
        finish(new Error(data.message || "Local Live benchmark failed."));
    };
    const timer = setTimeout(() => {
      worker.postMessage({ type: "cancel", id });
      finish(new Error("Local Live benchmark timed out."));
    }, timeoutMs);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({
      type: "turn",
      id,
      audio,
      instructions: "Respond with interleaved text and audio.",
      mode: "interleaved",
    });
  });
}

/** Prefer hosted when local speech lags and a consented hosted session is available. */
export function localLiveRoute(
  rate: number,
  hostedAvailable: boolean,
): "local" | "hosted" | "local-slow" | "unknown" {
  if (!Number.isFinite(rate) || rate <= 0) return "unknown";
  if (rate >= 1) return "local";
  return hostedAvailable ? "hosted" : "local-slow";
}
