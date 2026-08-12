/**
 * Voice notes — recording, storing the audio, and turning it into text.
 *
 * The audio is kept, not discarded after transcription. That is the difference
 * between a voice note and dictation: transcription is lossy about tone,
 * hesitation and emphasis, and a writer replaying their own half-formed thought
 * hears things the transcript does not carry. So the Blob lives in IndexedDB
 * beside the folios, and the transcript is the searchable surface over it.
 *
 * Transcription follows the same provider chain as everything else: the
 * writer's own key first, then the Pro-gated hosted endpoint.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  runClientVoiceTranscribe,
  hasConfiguredVoiceProvider,
} from "./ai-client";
import { getCachedAiSettings } from "./ai-orchestrator";
import { loadVoiceNoteBlob, saveVoiceNoteBlob } from "./idb";
import {
  createAppError,
  normalizeApplicationError,
} from "./application-errors";
import type { AppError } from "../types/application-errors";

/** Recording stops itself here. Long enough for a real thought, short enough
 *  that a forgotten open mic can't fill the disk or the API bill. */
export const MAX_RECORDING_MS = 3 * 60_000;

/** Preferred container. Falls back through what the browser actually supports. */
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function canRecord(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export interface Recording {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface RecorderHandle {
  /** Resolve with the finished recording. */
  stop: () => Promise<Recording>;
  /** Abandon the recording and release the microphone. */
  cancel: () => void;
  /** Pause the recording, keeping the microphone warm. */
  pause: () => void;
  /** Resume a paused recording. */
  resume: () => void;
  /** True while paused mid-recording. */
  paused: () => boolean;
  /** Recording time so far, excluding paused time. */
  elapsed: () => number;
  /** Current input level, 0-1, for a live meter. */
  level: () => number;
}

/**
 * Start recording. Rejects with a structured error when the microphone is
 * unavailable or permission is refused — the caller shows it, and must not
 * treat a refusal as a bug.
 */
export async function startRecording(): Promise<RecorderHandle> {
  if (!canRecord()) {
    throw createAppError("CONFIGURATION_ERROR", {
      source: "application",
      recovery: { action: "none", canRetry: false },
      metadata: {
        feature: "voice-notes",
        operation: "record",
        reason: "no-media-recorder",
      },
    });
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw normalizeApplicationError(err, {
      source: "application",
      metadata: { feature: "voice-notes", operation: "microphone-permission" },
    });
  }

  const mimeType = pickRecordingMimeType();
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // A live level meter, so the writer can see the mic is actually hearing
  // them. Failing to build one is not a reason to fail the recording.
  let analyser: AnalyserNode | null = null;
  let audioContext: AudioContext | null = null;
  let levelData: Uint8Array | null = null;
  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    levelData = new Uint8Array(analyser.frequencyBinCount);
  } catch {
    analyser = null;
  }

  const startedAt = Date.now();
  let totalPausedMs = 0;
  let pausedAt: number | null = null;
  recorder.start();

  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    void audioContext?.close().catch(() => {});
  };

  /** Recorded time so far, excluding pauses. The cap and the labels both
   *  count audio, not wall clock: a long pause before a short thought should
   *  not silently eat the recording budget. */
  const activeTime = (now = Date.now()): number =>
    now - startedAt - totalPausedMs - (pausedAt === null ? 0 : now - pausedAt);

  let autoStop: ReturnType<typeof setTimeout> | null = null;

  const stop = () =>
    new Promise<Recording>((resolve) => {
      if (autoStop) clearTimeout(autoStop);
      const finish = () => {
        release();
        resolve({
          blob: new Blob(chunks, { type: mimeType || "audio/webm" }),
          durationMs: activeTime(),
          mimeType: mimeType || "audio/webm",
        });
      };
      if (recorder.state === "inactive") {
        finish();
        return;
      }
      // A paused recorder keeps its buffer; resume first so nothing already
      // said is dropped when the writer stops.
      if (recorder.state === "paused") recorder.resume();
      recorder.onstop = finish;
      recorder.stop();
    });

  const armAutoStop = () => {
    if (autoStop) clearTimeout(autoStop);
    autoStop = null;
    const remaining = MAX_RECORDING_MS - activeTime();
    if (remaining <= 0) {
      void stop();
      return;
    }
    autoStop = setTimeout(() => void stop(), remaining);
  };
  armAutoStop();

  return {
    stop,
    cancel: () => {
      if (autoStop) clearTimeout(autoStop);
      if (recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
    },
    pause: () => {
      if (recorder.state !== "recording" || pausedAt !== null) return;
      if (autoStop) {
        clearTimeout(autoStop);
        autoStop = null;
      }
      pausedAt = Date.now();
      recorder.pause();
    },
    resume: () => {
      if (recorder.state !== "paused" || pausedAt === null) return;
      totalPausedMs += Date.now() - pausedAt;
      pausedAt = null;
      recorder.resume();
      // The budget counts audio only, so the clock starts again where it left
      // off rather than having run on through the pause.
      armAutoStop();
    },
    paused: () => pausedAt !== null,
    elapsed: activeTime,
    level: () => {
      if (!analyser || !levelData) return 0;
      analyser.getByteFrequencyData(levelData);
      let sum = 0;
      for (const v of levelData) sum += v;
      return Math.min(1, sum / levelData.length / 128);
    },
  };
}

/* ── Persistence ────────────────────────────────────────────────── */

export async function storeVoiceNote(id: string, blob: Blob): Promise<void> {
  await saveVoiceNoteBlob(id, blob);
}

export async function readVoiceNote(id: string): Promise<Blob | null> {
  return loadVoiceNoteBlob(id);
}

/* ── Transcription ──────────────────────────────────────────────── */

export interface TranscriptionOutcome {
  text: string;
  provider: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked so a three-minute recording doesn't blow the argument limit of
  // String.fromCharCode with a single spread.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** A standard AbortError, without assuming DOMException exists (unit tests). */
function createAbortError(): Error {
  try {
    return new DOMException("The transcription was stopped.", "AbortError");
  } catch {
    const err = new Error("The transcription was stopped.");
    err.name = "AbortError";
    return err;
  }
}

/**
 * Let a caller cancel while a non-abortable promise (the Convex action has no
 * signal support) is still in flight. The network call keeps running server
 * side, but the writer is freed the moment they press stop.
 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Turn a recording into text. BYOK first, then the Pro-gated hosted endpoint.
 * Throws a structured {@link AppError} when neither is reachable, so the
 * caller can offer the right recovery instead of a generic failure.
 */
export async function transcribeRecording(args: {
  blob: Blob;
  mimeType: string;
  client?: ConvexClient | null;
  /** Terms likely to appear — the brief's title and audience work well. */
  prompt?: string;
  /** Lets the writer stop an in-flight transcription. */
  signal?: AbortSignal;
  /** Full transcript-so-far, emitted by providers that support streaming. */
  onDelta?: (text: string) => void;
}): Promise<TranscriptionOutcome> {
  if (args.signal?.aborted) throw createAbortError();
  const settings = await getCachedAiSettings();

  // Gate on a voice-capable provider, not a language one: a writer with only
  // Fish Audio configured must still be able to transcribe.
  if (hasConfiguredVoiceProvider(settings)) {
    const result = await runClientVoiceTranscribe(
      { audio: args.blob, prompt: args.prompt },
      settings,
      { signal: args.signal, onDelta: args.onDelta },
    );
    if (result?.text) {
      return { text: result.text, provider: `client-${result.provider}` };
    }
  }

  if (args.client) {
    const res = (await abortable(
      args.client.action(api.voice.transcribeSpeech, {
        audioBase64: await blobToBase64(args.blob),
        mimeType: args.mimeType,
        prompt: args.prompt,
      }),
      args.signal,
    )) as { text: string; provider: string };
    return { text: res.text, provider: res.provider };
  }

  throw createAppError("CONFIGURATION_ERROR", {
    source: "application",
    recovery: { action: "choose-provider", canRetry: false },
    metadata: { feature: "voice-notes", operation: "transcribe" },
  }) as AppError;
}

/** Human-readable duration for a note's label. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
