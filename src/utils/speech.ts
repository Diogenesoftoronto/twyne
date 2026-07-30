/**
 * Reading aloud — the editors get voices.
 *
 * The provider plumbing for this already existed and had no callers:
 * `runClientVoiceSpeech` (BYOK) in `ai-client.ts` and the Pro-gated
 * `voice.synthesizeSpeech` Convex action. This module is the missing middle:
 * a single-playback manager the UI can drive without every button growing its
 * own audio element and cache.
 *
 * Two decisions worth stating:
 *
 *   - **One voice at a time.** Starting a read stops whatever was playing.
 *     Five editors talking over each other is not a feature, and a stray
 *     background voice the writer cannot find the stop button for is the
 *     worst possible failure mode for an audio feature in a writing app.
 *   - **Cache by content, not by note id.** Notes are immutable once filed,
 *     but the same passage can be read from several places (the panel, the
 *     inline modal, the analysis modal). Keying on the text and voice means
 *     replaying costs nothing regardless of which button was pressed.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { AiProviderType, AiSettings } from "../types";
import type { AppError } from "../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "./application-errors";
import {
  hasConfiguredVoiceProvider,
  resolveFeatureConfig,
  runClientVoiceSpeech,
} from "./ai-client";
import { getCachedAiSettings } from "./ai-orchestrator";

/** Cap on cached clips, so a long session doesn't hold every note in memory. */
const MAX_CACHED_CLIPS = 24;

export interface SpeakRequest {
  text: string;
  /** Stable id for the thing being read, so the UI can highlight it. */
  id: string;
  /** Fallback voice name, e.g. "onyx". */
  voice?: string;
  /**
   * Per-provider voice overrides. Providers name voices incompatibly — an
   * OpenAI name sent to Fish Audio selects nothing and every editor comes out
   * in the same default voice — so the right one is chosen once the provider
   * is known, not by the caller.
   */
  voices?: Partial<Record<AiProviderType, string>>;
  /** Voice direction — a persona's lore paragraph works well here. */
  instructions?: string;
  /** Convex client for the hosted (Pro) path. BYOK does not need it. */
  client?: ConvexClient | null;
}

export type SpeechStatus = "idle" | "loading" | "playing" | "error";

export interface SpeechState {
  status: SpeechStatus;
  /** Which `SpeakRequest.id` is active, when any. */
  id: string | null;
  error: AppError | null;
}

const state: SpeechState = { status: "idle", id: null, error: null };

let audio: HTMLAudioElement | null = null;
/** Content-addressed clip cache: `${voice}::${text}` → object URL. */
const cache = new Map<string, string>();
/** Guards against a slow request landing after the writer moved on. */
let generation = 0;

export function speechState(): SpeechState {
  return { ...state };
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("twyne:speech", { detail: speechState() }),
  );
}

function setState(
  status: SpeechStatus,
  id: string | null,
  error: AppError | null = null,
): void {
  state.status = status;
  state.id = id;
  state.error = error;
  notify();
}

function cacheKey(text: string, voice: string): string {
  return `${voice}::${text}`;
}

function remember(key: string, url: string): void {
  cache.set(key, url);
  while (cache.size > MAX_CACHED_CLIPS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const stale = cache.get(oldest);
    if (stale) URL.revokeObjectURL(stale);
    cache.delete(oldest);
  }
}

/**
 * Pick the voice name for whichever provider will actually serve this request.
 * Falls back to the generic name when the provider has no specific entry, and
 * to nothing at all when there is no provider — in which case the synthesis
 * call is about to fail anyway.
 */
export function pickVoiceForProvider(
  voices: Partial<Record<AiProviderType, string>> | undefined,
  fallback: string | undefined,
  providerType: AiProviderType | undefined,
): string | undefined {
  if (providerType && voices?.[providerType]) return voices[providerType];
  return fallback;
}

function resolveVoice(req: SpeakRequest, settings: AiSettings): string | undefined {
  return pickVoiceForProvider(
    req.voices,
    req.voice,
    resolveFeatureConfig(settings, "voice-narration")?.provider.type,
  );
}

/** Stop whatever is playing. Safe to call when nothing is. */
export function stopSpeech(): void {
  generation += 1;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  setState("idle", null);
}

/**
 * Fetch the audio for a passage, BYOK first then the hosted Pro path — the
 * same order every other feature uses, so the writer's configured provider is
 * always what speaks.
 */
async function synthesize(req: SpeakRequest): Promise<Blob> {
  const text = req.text.trim();
  const settings = await getCachedAiSettings();

  // Gate on a *voice-capable* provider, not a language one: a writer may have
  // Fish Audio configured for speech and nothing else, and a writer may have
  // Anthropic configured for the room but nothing that can speak.
  if (hasConfiguredVoiceProvider(settings)) {
    const result = await runClientVoiceSpeech(
      { text, voice: resolveVoice(req, settings), instructions: req.instructions },
      settings,
    );
    if (result) return result.audio;
  }

  if (req.client) {
    const res = (await req.client.action(api.voice.synthesizeSpeech, {
      text,
      voice: req.voice,
      instructions: req.instructions,
    })) as { audioBase64: string; mimeType: string };
    const bytes = Uint8Array.from(atob(res.audioBase64), (c) =>
      c.charCodeAt(0),
    );
    return new Blob([bytes], { type: res.mimeType });
  }

  throw createAppError("CONFIGURATION_ERROR", {
    source: "application",
    recovery: { action: "choose-provider", canRetry: false },
    metadata: { feature: "voice-narration", operation: "synthesize" },
  });
}

/**
 * Read a passage aloud. Pressing the same passage again stops it (so one
 * button is both play and stop); pressing a different one switches over.
 */
export async function speak(req: SpeakRequest): Promise<void> {
  if (typeof window === "undefined") return;

  // Same passage, already sounding → this press means "stop".
  if (state.id === req.id && (state.status === "playing" || state.status === "loading")) {
    stopSpeech();
    return;
  }

  const text = req.text.trim();
  if (!text) return;

  stopSpeech();
  const mine = ++generation;
  // Key the cache on the voice that will actually be used, so two editors
  // sharing a fallback name never collide on one clip.
  const settings = await getCachedAiSettings();
  const voice = resolveVoice(req, settings) ?? req.voice ?? "alloy";
  const key = cacheKey(text, voice);

  setState("loading", req.id);

  try {
    let url = cache.get(key);
    if (!url) {
      const blob = await synthesize({ ...req, text });
      if (mine !== generation) return; // the writer moved on
      url = URL.createObjectURL(blob);
      remember(key, url);
    }
    if (mine !== generation) return;

    audio = audio ?? new Audio();
    audio.src = url;
    audio.onended = () => {
      if (mine === generation) setState("idle", null);
    };
    audio.onerror = () => {
      if (mine !== generation) return;
      setState(
        "error",
        req.id,
        createAppError("PROVIDER_ERROR", {
          source: "provider",
          metadata: { feature: "voice-narration", operation: "playback" },
        }),
      );
    };
    await audio.play();
    if (mine === generation) setState("playing", req.id);
  } catch (err) {
    if (mine !== generation) return;
    setState(
      "error",
      req.id,
      normalizeApplicationError(err, {
        source: "provider",
        metadata: { feature: "voice-narration", operation: "synthesize" },
      }),
    );
  }
}

/** Drop every cached clip and release its object URL. */
export function clearSpeechCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
