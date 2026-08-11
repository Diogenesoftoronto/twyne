/**
 * Supertonic — the browser's own voice.
 *
 * Supertonic is a full neural TTS model that runs on-device through
 * transformers.js (WebGPU when available, WASM otherwise). It is the
 * free/offline voice: no API key, no server, no account — the writer
 * downloads the voice pack once and the reading costs nothing after that.
 *
 * Download-and-evict lives in `models-cache.ts`. This module is the thin
 * layer that:
 *
 *   - detects whether the browser can run the model at all,
 *   - reports bundle state (not-downloaded / downloading / ready),
 *   - redirects transformers.js fetches to the downloaded bytes via
 *     `env.fetch`, so synthesis works with no network access,
 *   - turns a passage into a WAV clip, chunked at sentence boundaries.
 *
 * It is only imported by the Supertonic branch of `runClientVoiceSpeech`, so
 * the transformers.js runtime stays out of the main bundle.
 */

import { env, pipeline, type TextToAudioPipeline } from "@huggingface/transformers";
import { encode as encodeWav } from "wav-encoder";
import { createAppError, normalizeApplicationError } from "./application-errors";
import {
  BROWSER_TTS_MANIFEST_FILES,
  BROWSER_TTS_PROVIDER_ID,
  BROWSER_TTS_REMOTE_BASE,
  BROWSER_TTS_VOICES,
  browserTtsDevice,
  isBrowserTtsSupported,
  type BrowserTtsDevice,
} from "./browser-inference";
import {
  downloadModelBundle,
  evictModelBundle,
  isModelBundleDownloaded,
  modelDownloadState,
  readModelBytes,
  type ModelDownloadState,
} from "./models-cache";
import { split } from "./speech-splitter";

/** Stable provider id for the auto-registered browser voice provider. */
export const SUPERTONIC_PROVIDER_ID = BROWSER_TTS_PROVIDER_ID;

/** The model id transformers.js resolves, and the prefix of every file URL. */
export const SUPERTONIC_MODEL_ID = "onnx-community/Supertonic-TTS-ONNX";

const REMOTE_BASE = BROWSER_TTS_REMOTE_BASE;

/** Voices the model ships with. F = female, M = male, number = takes. */
export const SUPERTONIC_VOICES = BROWSER_TTS_VOICES;

export type SupertonicVoice = (typeof SUPERTONIC_VOICES)[number];

/** A known voice id, or the default when the writer named something else. */
export function normalizeSupertonicVoice(voice: string | undefined): SupertonicVoice {
  if (voice && (SUPERTONIC_VOICES as readonly string[]).includes(voice)) {
    return voice as SupertonicVoice;
  }
  return "F1";
}

/**
 * Every file the model loads, with the byte size the CDN reports. The sizes
 * are what the download progress bar counts against, so a stale entry shows
 * a slightly-off total rather than a broken bar.
 *
 * The nine voice embeddings (one per voice the model ships) are included too:
 * they are small (a few KB each) and the synthesis step must read them from
 * disk without a network round-trip.
 */
export const SUPERTONIC_MANIFEST_FILES = BROWSER_TTS_MANIFEST_FILES;

const SUPERTONIC_BUNDLE_ID = SUPERTONIC_PROVIDER_ID;

export type SupertonicDevice = BrowserTtsDevice;

/** Which device this browser can run the model on, if any. */
export const supertonicDevice = browserTtsDevice;

/** Can this browser run the model at all? (Download state is separate.) */
export const isSupertonicAvailable = isBrowserTtsSupported;

export interface SupertonicStatus extends ModelDownloadState {
  device: SupertonicDevice;
}

const statusListeners = new Set<(status: SupertonicStatus) => void>();

function emitStatus(status: SupertonicStatus): void {
  for (const listener of statusListeners) listener(status);
}

export function onSupertonicStatus(
  listener: (status: SupertonicStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

async function readStatus(): Promise<SupertonicStatus> {
  const state = await modelDownloadState(SUPERTONIC_BUNDLE_ID, SUPERTONIC_MANIFEST_FILES);
  return { ...state, id: SUPERTONIC_BUNDLE_ID, device: supertonicDevice() };
}

export async function getSupertonicStatus(): Promise<SupertonicStatus> {
  return readStatus();
}

/* ── transformers.js fetch redirection ───────────────────────────── */

let fetchHookInstalled = false;

/**
 * Point transformers.js at the downloaded bytes.
 *
 * transformers.js loads every model file through `env.fetch`. Once the pack
 * is on disk, this hook answers those fetches from IndexedDB instead of the
 * network, so a reading works with no connectivity at all. The redirect is
 * exact per URL, so nothing else is intercepted.
 */
export function installSupertonicFetchHook(): void {
  if (fetchHookInstalled || typeof window === "undefined") return;
  fetchHookInstalled = true;
  const originalFetch = env.fetch.bind(env) as typeof fetch;
  env.fetch = async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith(REMOTE_BASE)) {
      const bytes = await readModelBytes(url);
      if (bytes) {
        return new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }
    }
    return originalFetch(url, init);
  };
}

let pipelinePromise: Promise<TextToAudioPipeline> | null = null;

/** Load the model and compile its shaders once; reused for every reading. */
async function loadPipeline(
  device: "webgpu" | "wasm",
): Promise<TextToAudioPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    installSupertonicFetchHook();
    // The pack must be on disk already — the caller gates on that.
    const tts = (await pipeline("text-to-speech", SUPERTONIC_MODEL_ID, {
      device,
      progress_callback: () => {},
    })) as TextToAudioPipeline;
    // Warm up so the first real reading is not the one that pays for shader
    // compilation. A one-step dummy embedding costs nothing audible.
    await tts("Hello", {
      speaker_embeddings: new Float32Array(1 * 101 * 128),
      num_inference_steps: 1,
      speed: 1.0,
    });
    return tts;
  })();
  pipelinePromise.catch(() => {
    pipelinePromise = null;
  });
  return pipelinePromise;
}

/** Release the in-memory model. The download stays on disk. */
export function disposeSupertonicPipeline(): void {
  pipelinePromise = null;
}

/* ── Download ────────────────────────────────────────────────────── */

/**
 * Fetch the whole voice pack and warm the model. Progress is delivered
 * through `onSupertonicStatus` and the callback. Throws AbortError when the
 * writer stops the download.
 */
export async function downloadSupertonicPack(opts: {
  signal?: AbortSignal;
  onProgress?: (state: ModelDownloadState) => void;
} = {}): Promise<void> {
  const device = supertonicDevice();
  if (!device) {
    throw createAppError("CONFIGURATION_ERROR", {
      source: "application",
      recovery: { action: "none", canRetry: false },
      metadata: {
        feature: "voice-narration",
        operation: "download",
        reason: "unsupported-browser",
      },
    });
  }
  installSupertonicFetchHook();
  await downloadModelBundle(SUPERTONIC_BUNDLE_ID, SUPERTONIC_MANIFEST_FILES, {
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
  await loadPipeline(device);
  emitStatus(await readStatus());
}

/** Drop the downloaded bytes. The next reading will need a fresh download. */
export async function clearSupertonicPack(): Promise<void> {
  await evictModelBundle(SUPERTONIC_BUNDLE_ID, SUPERTONIC_MANIFEST_FILES);
  disposeSupertonicPipeline();
  emitStatus(await readStatus());
}

/** True when every file of the pack is on disk. */
export async function isSupertonicReady(): Promise<boolean> {
  return isModelBundleDownloaded(SUPERTONIC_BUNDLE_ID, SUPERTONIC_MANIFEST_FILES);
}

/* ── Synthesis ───────────────────────────────────────────────────── */

export interface SupertonicSpeechResult {
  audio: Blob;
  provider: string;
  model: string;
  voice: SupertonicVoice;
  responseFormat: string;
}

/**
 * Turn a passage into speech, entirely in this browser.
 *
 * Throws a structured AppError with `download-required` recovery when the
 * pack has not been downloaded yet, so the UI can point at the download
 * rather than pretending the voice is broken.
 */
export async function synthesizeSupertonic(
  text: string,
  opts: { voice?: string; speed?: number } = {},
): Promise<SupertonicSpeechResult> {
  const device = supertonicDevice();
  if (!device) {
    throw createAppError("CONFIGURATION_ERROR", {
      source: "application",
      recovery: { action: "none", canRetry: false },
      metadata: {
        feature: "voice-narration",
        operation: "synthesize",
        reason: "unsupported-browser",
      },
    });
  }
  const voice = normalizeSupertonicVoice(opts.voice);
  const input = text.trim().slice(0, 4096);
  if (!input) {
    throw createAppError("VALIDATION_FAILED", {
      source: "validation",
      recovery: { action: "fix-input", canRetry: true },
      metadata: { feature: "voice-narration", operation: "synthesize" },
    });
  }

  const ready = await isSupertonicReady();
  if (!ready) {
    throw createAppError("CONFIGURATION_ERROR", {
      source: "application",
      recovery: { action: "download-required", canRetry: true },
      metadata: {
        feature: "voice-narration",
        operation: "synthesize",
        reason: "not-downloaded",
      },
    });
  }

  try {
    installSupertonicFetchHook();
    const tts = await loadPipeline(device);
    const speed = opts.speed ?? 1.0;
    const embeddingBytes = await readModelBytes(
      `${REMOTE_BASE}voices/${voice}.bin`,
    );
    if (!embeddingBytes || embeddingBytes.byteLength % 4 !== 0) {
      throw createAppError("CONFIGURATION_ERROR", {
        source: "application",
        recovery: { action: "download-required", canRetry: true },
        metadata: {
          feature: "voice-narration",
          operation: "synthesize",
          reason: "voice-embedding-missing",
        },
      });
    }
    const speakerEmbeddings = new Float32Array(embeddingBytes);

    const sentences = split(input);
    const chunks: string[] = [];
    let buffer = "";
    for (const sentence of sentences) {
      // The model is happiest around a few hundred characters; sentences
      // longer than that are split at word boundaries.
      if (buffer && buffer.length + sentence.length > 600) {
        chunks.push(buffer.trim());
        buffer = "";
      }
      buffer += (buffer ? " " : "") + sentence;
      if (buffer.length >= 300) {
        chunks.push(buffer.trim());
        buffer = "";
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    if (chunks.length === 0) chunks.push(input);

    const parts: Float32Array[] = [];
    let samplingRate = 24_000;
    for (const chunk of chunks) {
      const output = (await tts(chunk, {
        speaker_embeddings: speakerEmbeddings,
        num_inference_steps: 2,
        speed,
      })) as { audio: Float32Array; sampling_rate: number };
      samplingRate = output.sampling_rate || samplingRate;
      if (output.audio.length > 0) parts.push(output.audio);
    }
    if (parts.length === 0) {
      throw new Error("The voice produced no audio.");
    }

    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const part of parts) {
      audio.set(part, offset);
      offset += part.length;
    }

    const pcm = await encodeWav(
      {
        sampleRate: samplingRate,
        channelData: [audio],
      },
      { floatingPoint: true },
    );
    return {
      audio: new Blob([pcm], { type: "audio/wav" }),
      provider: "supertonic",
      model: "supertonic-tts",
      voice,
      responseFormat: "wav",
    };
  } catch (err) {
    if (err && typeof (err as Error).message === "string" && (err as Error).message.startsWith("Downloading")) {
      throw createAppError("NETWORK_UNAVAILABLE", {
        source: "fetch",
        recovery: { action: "retry", canRetry: true },
        metadata: { feature: "voice-narration", operation: "synthesize" },
      });
    }
    throw normalizeApplicationError(err, {
      source: "provider",
      metadata: { feature: "voice-narration", operation: "synthesize" },
    });
  }
}
