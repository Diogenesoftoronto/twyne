/**
 * Browser-side inference capability — kept dependency-free.
 *
 * `supertonic-tts.ts` pulls in the full transformers.js runtime, which is
 * hundreds of kilobytes the main bundle must not carry. Capability detection
 * and the stable provider id live here instead, in a module the settings
 * normaliser can afford to import on every mount.
 */

/** Stable provider id for the auto-registered browser voice provider. */
export const BROWSER_TTS_PROVIDER_ID = "browser-supertonic";

/** Model id the provider reports; also the transformers.js repo name. */
export const BROWSER_TTS_MODEL_ID = "supertonic-tts";

/** The repo on HuggingFace the voice pack comes from. */
export const BROWSER_TTS_REPO_ID = "onnx-community/Supertonic-TTS-ONNX";

export const BROWSER_TTS_REMOTE_BASE = `https://huggingface.co/${BROWSER_TTS_REPO_ID}/resolve/main/`;

/** Voices the model ships with. F = female, M = male, number = takes. */
export const BROWSER_TTS_VOICES = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "M1",
  "M2",
  "M3",
  "M4",
] as const;

export type BrowserTtsVoice = (typeof BROWSER_TTS_VOICES)[number];

/**
 * Every file the model loads, with the byte size the CDN reports. The sizes
 * feed the download progress bar; a stale entry shows a slightly-off total
 * rather than a broken bar. The voice embeddings are included because the
 * synthesis step reads them from disk.
 */
export const BROWSER_TTS_MANIFEST = [
  ["config.json", 247],
  ["tokenizer.json", 2038],
  ["tokenizer_config.json", 119],
  ["onnx/text_encoder.onnx", 433_169],
  ["onnx/text_encoder.onnx_data", 28_426_752],
  ["onnx/latent_denoiser.onnx", 398_102],
  ["onnx/latent_denoiser.onnx_data", 132_098_880],
  ["onnx/voice_decoder.onnx", 59_921],
  ["onnx/voice_decoder.onnx_data", 101_353_472],
  ...BROWSER_TTS_VOICES.map((voice) => [`voices/${voice}.bin`, 51_712] as const),
] as const;

export const BROWSER_TTS_MANIFEST_FILES = BROWSER_TTS_MANIFEST.map(
  ([file, size]) => ({ url: `${BROWSER_TTS_REMOTE_BASE}${file}`, size }),
);

/** Total pack size in bytes, for the download card. */
export const BROWSER_TTS_BUNDLE_BYTES = BROWSER_TTS_MANIFEST_FILES.reduce(
  (sum, f) => sum + f.size,
  0,
);

export type BrowserTtsDevice = "webgpu" | "wasm" | null;

/**
 * Test seam: lets a test pin the probe result instead of racing the rest of
 * the suite on the shared `navigator`/`indexedDB` globals. `undefined` (the
 * default) means "measure for real".
 */
let capabilityOverride: BrowserTtsDevice | undefined;
export function setBrowserTtsCapabilityOverride(
  device: BrowserTtsDevice | undefined,
): void {
  capabilityOverride = device;
}

/** Which device this browser can run on-device TTS on, if any. */
export function browserTtsDevice(): BrowserTtsDevice {
  if (capabilityOverride !== undefined) return capabilityOverride;
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  if ("gpu" in navigator && navigator.gpu) return "webgpu";
  if (typeof WebAssembly !== "undefined") return "wasm";
  return null;
}

/** True when the browser can run on-device voice at all. */
export function isBrowserTtsSupported(): boolean {
  // A pinned override answers outright — the test globals will never hold the
  // same IndexedDB/navigator pair a capable browser does.
  if (capabilityOverride !== undefined) return capabilityOverride !== null;
  // The model lands in IndexedDB, so a browser without it cannot hold the
  // pack — the download path is the whole point of the browser voice.
  return (
    browserTtsDevice() !== null && typeof indexedDB !== "undefined"
  );
}