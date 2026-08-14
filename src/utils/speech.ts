/**
 * Reading aloud — the editors get voices.
 *
 * The provider plumbing for this already existed and had no callers:
 * `runClientVoiceSpeech` (BYOK) in `ai-client.ts` and the Pro-gated
 * `voice.synthesizeSpeech` Convex action. This module is the missing middle:
 * a single-playback manager the UI can drive without every button growing its
 * own audio element and cache.
 *
 * Three decisions worth stating:
 *
 *   - **Generated audio only.** BYOK uses the provider and model selected for
 *     Voice Narration. Hosted speech is available only when no BYOK voice
 *     provider is configured. The browser's built-in synthesiser is never
 *     used because its quality is not suitable for editorial narration.
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
import type { AiProviderType, AiSettings, Persona } from "../types";
import { PERSONAS } from "./personas";
import { loadPersonasFromIdb } from "./idb";
import type { AppError } from "../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "./application-errors";
import { resolveFeatureConfig, runClientVoiceSpeech } from "./ai-client";
import { getCachedAiSettings } from "./ai-orchestrator";
import { reportApplicationDiagnostic } from "./application-diagnostics";
import { BROWSER_TTS_VOICES } from "./browser-inference";
import { segmentSpeechText } from "./speech-segments";

/** Cap on cached clips, so a long session doesn't hold every note in memory. */
const MAX_CACHED_CLIPS = 24;

export interface SpeakRequest {
  text: string;
  /** Stable id for the thing being read, so the UI can highlight it. */
  id: string;
  /** Character offset within a larger plain-text source, when reading a selection. */
  sourceOffset?: number;
  /** Fallback voice name, e.g. "onyx". */
  voice?: string;
  /**
   * Per-provider voice overrides. Providers name voices incompatibly — an
   * OpenAI voice names do not identify Fish Audio models, so the right
   * provider-specific id is chosen once the provider is known, not by the
   * caller.
   */
  voices?: Partial<Record<AiProviderType, string>>;
  /** Voice direction — a persona's lore paragraph works well here. */
  instructions?: string;
  /**
   * Display name for a transport that announces what it is reading, e.g.
   * "Marguerite" while stepping through the room. Not used to resolve a voice
   * — that is `author`'s job — because the two differ: the room's verdict is
   * labelled "The Room's Verdict" and has no author in the cast at all.
   */
  label?: string;
  /**
   * Who is speaking, by name. The editor's inline cards read their author out
   * of a DOM attribute and have no persona object to hand, so the voice
   * fields above are filled in from the cast when only a name is known.
   */
  author?: string;
  /** Convex client for the hosted (Pro) path. BYOK does not need it. */
  client?: ConvexClient | null;
  /**
   * Is there an account behind `client`? The hosted path is sign-in *and*
   * Pro gated, so calling it while signed out only ever yields "Not signed
   * in" — a useless thing to show a writer who is reading aloud on their own
   * key and never asked for the hosted path at all.
   */
  signedIn?: boolean;
  /**
   * Split a long passage at semantic boundaries and play its first chunk while
   * later chunks synthesize ahead of playback. Intended for manuscript reads;
   * explicit editorial-room queues retain their one-item-per-editor shape.
   */
  progressive?: boolean;
}

export type SpeechStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface SpeechState {
  status: SpeechStatus;
  /** Which `SpeakRequest.id` is active, when any. */
  id: string | null;
  error: AppError | null;
  /** Seconds played, for a transport that shows progress. */
  currentTime: number;
  /** Clip length in seconds; 0 until the metadata has loaded. */
  duration: number;
  /**
   * Who started this reading, when a whole queue was handed over at once. A
   * transport that owns a queue matches on this instead of `id`, since `id`
   * moves from passage to passage as the queue advances and would otherwise
   * leave the transport looking idle the moment it got past the first one.
   */
  ownerId: string | null;
  /** Position within the queue, 0-based. */
  queueIndex: number;
  /** Passages queued: 1 for a lone reading, 0 when idle. */
  queueLength: number;
  /** Display name of the passage being read, when the caller gave one. */
  label: string | null;
  /** Voice currently selected for this passage, once it is resolved. */
  voice: string | null;
  /** Provider and model serving the active clip, once known. */
  provider: string | null;
  model: string | null;
}

export interface SpeechVoiceOption {
  id: string;
  label: string;
}

export interface SpeechVoiceMenu {
  provider: string;
  model: string;
  selected: string;
  options: SpeechVoiceOption[];
  /** Compatible APIs may accept a voice id that is not in their advertised set. */
  allowsCustom: boolean;
}

/** Voices accepted by OpenAI's speech request API. */
export const OPENAI_SPEECH_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

const state: SpeechState = {
  status: "idle",
  id: null,
  error: null,
  currentTime: 0,
  duration: 0,
  ownerId: null,
  queueIndex: 0,
  queueLength: 0,
  label: null,
  voice: null,
  provider: null,
  model: null,
};

let audio: HTMLAudioElement | null = null;
/** Content-addressed clip cache: `${voice}::${text}` → object URL. */
const cache = new Map<string, string>();
/**
 * Synthesis calls in flight, keyed the same way as the cache. Prefetching the
 * next passage means a clip can be half-synthesised at the moment the writer
 * skips to it; without this the same paragraph would be sent to the provider
 * twice and billed twice.
 */
const inFlight = new Map<string, Promise<string>>();
/** Guards against a slow request landing after the writer moved on. */
let generation = 0;
/** The passages to read, in order. A lone reading is a queue of one. */
let queue: SpeakRequest[] = [];
let queueIndex = 0;
let queueOwner: string | null = null;

export function speechState(): SpeechState {
  return { ...state };
}

/** The exact prose handed to the provider for the active queue item. */
export function currentSpeechText(): string | null {
  return queue[queueIndex]?.text.trim() || null;
}

/** Character offset of the active passage inside its marked plain-text source. */
export function currentSpeechSourceOffset(): number | null {
  const offset = queue[queueIndex]?.sourceOffset;
  return typeof offset === "number" && Number.isFinite(offset)
    ? Math.max(0, offset)
    : null;
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
  state.ownerId = queueOwner;
  state.queueIndex = queue.length ? queueIndex : 0;
  state.queueLength = queue.length;
  state.label = queue[queueIndex]?.label ?? queue[queueIndex]?.author ?? null;
  if (status === "idle" || status === "error") {
    state.currentTime = 0;
    state.duration = 0;
  }
  if (status === "idle") {
    state.voice = null;
    state.provider = null;
    state.model = null;
  }
  notify();
}

function cacheKey(
  text: string,
  providerId: string,
  model: string,
  voice: string,
  responseFormat: string,
  speed: number | undefined,
  instructions: string | undefined,
): string {
  return [
    providerId,
    model,
    voice,
    responseFormat,
    speed ?? "",
    instructions ?? "",
    text,
  ].join("::");
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

function resolveVoice(
  req: SpeakRequest,
  settings: AiSettings,
): string | undefined {
  return pickVoiceForProvider(
    req.voices,
    req.voice,
    resolveFeatureConfig(settings, "voice-narration")?.provider.type,
  );
}

function uniqueVoiceOptions(options: SpeechVoiceOption[]): SpeechVoiceOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.id || seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

/**
 * Voices the active narration API can accept.
 *
 * OpenAI-compatible APIs share the standard named set but can also expose
 * custom ids. Fish uses the cast's saved reference ids, while Supertonic uses
 * the voice embeddings already present in its browser bundle.
 */
export async function currentSpeechVoiceMenu(): Promise<SpeechVoiceMenu | null> {
  const req = queue[queueIndex];
  if (!req) return null;

  const spoken = await withPersonaVoice(req);
  const settings = await getCachedAiSettings();
  const resolved = resolveFeatureConfig(settings, "voice-narration");
  const providerType = resolved?.provider.type;
  const selected = resolveVoice(spoken, settings) ?? spoken.voice ?? "alloy";

  if (providerType === "supertonic") {
    return {
      provider: "Browser voice",
      model: resolved?.model ?? "supertonic-tts",
      selected,
      options: BROWSER_TTS_VOICES.map((voice) => ({
        id: voice,
        label: `Voice ${voice}`,
      })),
      allowsCustom: false,
    };
  }

  if (providerType === "fishaudio") {
    let cast: Persona[] = PERSONAS;
    try {
      const custom = await loadPersonasFromIdb();
      if (custom?.length) cast = custom;
    } catch {
      // Default cast still gives the player useful choices.
    }
    const options = uniqueVoiceOptions([
      ...cast.flatMap((persona) => {
        const id = persona.speechVoices?.fishaudio;
        return id ? [{ id, label: persona.name }] : [];
      }),
      { id: selected, label: "Current voice" },
    ]);
    return {
      provider: "Fish Audio",
      model: resolved?.model ?? "s2-pro",
      selected,
      options,
      allowsCustom: true,
    };
  }

  const standard = OPENAI_SPEECH_VOICES.map((voice) => ({
    id: voice,
    label: voice.charAt(0).toUpperCase() + voice.slice(1),
  }));
  return {
    provider:
      resolved?.provider.name ?? (resolved ? "Voice API" : "Twyne voice"),
    model: resolved?.model ?? "hosted",
    selected,
    options: uniqueVoiceOptions([
      ...standard,
      ...(standard.some((option) => option.id === selected)
        ? []
        : [{ id: selected, label: "Current voice" }]),
    ]),
    allowsCustom: Boolean(resolved && resolved.provider.type !== "openai"),
  };
}

/**
 * Fill in the voice fields from the cast when the caller knows only a name.
 *
 * Read fresh rather than memoised: the writer can rename or revoice an editor
 * mid-session, and one IndexedDB read is nothing beside the synthesis call it
 * precedes.
 */
async function withPersonaVoice(req: SpeakRequest): Promise<SpeakRequest> {
  if (!req.author) return req;
  if (req.voice && req.voices && req.instructions) return req;

  const name = req.author.trim().toLowerCase();
  if (!name) return req;

  let cast: Persona[] = PERSONAS;
  try {
    const custom = await loadPersonasFromIdb();
    if (custom && custom.length > 0) cast = custom;
  } catch {
    // The defaults still carry voices; a failed read is not worth a silence.
  }

  const persona = cast.find((p) => p.name.trim().toLowerCase() === name);
  if (!persona) return req;

  return {
    ...req,
    voice: req.voice ?? persona.speechVoice,
    voices: req.voices ?? persona.speechVoices,
    instructions: req.instructions ?? persona.voice,
  };
}

/**
 * A one-sample silent WAV. Playing this costs nothing audible and is the
 * cheapest way to spend a user gesture on the shared audio element.
 */
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/**
 * Claim playback permission for the shared audio element.
 *
 * Autoplay policy grants `play()` only while a user gesture is still "fresh"
 * — about five seconds in Chrome. Synthesising a paragraph routinely takes
 * longer than that, so by the time the clip came back the gesture had expired
 * and `play()` rejected with NotAllowedError. Every press failed, which is
 * indistinguishable from the feature being broken.
 *
 * Once an element has played from within a gesture it stays unlocked for the
 * life of the page, so this runs synchronously on the press — before any
 * await — and never needs to run again.
 */
let unlocked = false;
export function unlockSpeechPlayback(): void {
  if (unlocked || typeof window === "undefined") return;
  audio = audio ?? new Audio();
  audio.muted = true;
  audio.src = SILENCE;
  const started = audio.play();
  if (started && typeof started.then === "function") {
    void started
      .then(() => {
        unlocked = true;
      })
      .catch(() => {
        // Still locked. The play() below will report it properly.
      })
      .finally(() => {
        if (audio) audio.muted = false;
      });
  } else {
    unlocked = true;
    audio.muted = false;
  }
}

/**
 * Silence the element and invalidate anything in flight, without touching the
 * queue. Advancing from one passage to the next needs exactly this: the old
 * clip must stop the instant the new one is asked for, or the writer hears the
 * tail of Marguerite under the first seconds of the next editor.
 */
function haltPlayback(): void {
  generation += 1;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

/** Stop whatever is playing and abandon the queue. Safe to call when idle. */
export function stopSpeech(): void {
  haltPlayback();
  queue = [];
  queueIndex = 0;
  queueOwner = null;
  setState("idle", null);
}

/**
 * Hold the current clip where it is.
 *
 * Distinct from {@link stopSpeech}, which discards the position. A writer who
 * pauses a five-minute reading to answer the door expects to come back to the
 * same sentence, not to the top of the draft — and re-reading from the top
 * would also re-bill the synthesis if the clip had fallen out of the cache.
 */
export function pauseSpeech(): void {
  if (state.status !== "playing" || !audio) return;
  audio.pause();
  setState("paused", state.id);
}

/** Resume a paused clip. Safe to call when nothing is paused. */
export function resumeSpeech(): void {
  if (state.status !== "paused" || !audio) return;
  const id = state.id;
  void audio
    .play()
    .then(() => setState("playing", id))
    .catch(() => {
      // The gesture that paused it has long expired; ask for another.
      setState("error", id, {
        ...createAppError("PERMISSION_DENIED", {
          source: "application",
          recovery: { action: "retry", canRetry: true },
          metadata: { feature: "voice-narration", operation: "playback" },
        }),
        message: "Your browser blocked playback. Press play again to allow it.",
      });
    });
}

/** Play/pause in one control, for a transport that has a single such button. */
export function togglePauseSpeech(): void {
  if (state.status === "playing") pauseSpeech();
  else if (state.status === "paused") resumeSpeech();
}

/**
 * Owner id for a reading of the whole room, so a transport keeps hold of the
 * queue as it moves from one editor's memo to the next. Shared by the two
 * places the analysis is shown — the panel's modal and the full page — which
 * are never on screen at once, and which should behave identically.
 */
export const ANALYSIS_READING_ID = "analysis-room";

/** Is there another passage after the current one? */
export function hasNextSpeech(): boolean {
  return queueIndex < queue.length - 1;
}

/** Skip to the next passage. Ignored at the end of the queue. */
export function nextSpeech(): void {
  if (!hasNextSpeech()) return;
  queueIndex += 1;
  void playCurrent();
}

/**
 * Back to the start of this passage, or to the previous one when barely into
 * it. The three-second grace is the convention every music player uses, and it
 * is what makes the control usable: the common press is "say that again", not
 * "go back an editor".
 */
export function previousSpeech(): void {
  if (!queue.length) return;
  if (state.currentTime > 3 || queueIndex === 0) {
    seekSpeech(0);
    return;
  }
  queueIndex -= 1;
  void playCurrent();
}

/** Jump to a position, in seconds. Ignored when nothing is loaded. */
export function seekSpeech(seconds: number): void {
  if (!audio || !state.duration) return;
  audio.currentTime = Math.max(0, Math.min(seconds, state.duration));
  state.currentTime = audio.currentTime;
  notify();
}

/**
 * Regenerate the active passage with another API voice and start it again.
 * The queue and its position are preserved, so changing a speaker midway
 * through a room reading does not discard the remaining editors.
 */
export async function restartSpeechWithVoice(voice: string): Promise<void> {
  const req = queue[queueIndex];
  const nextVoice = voice.trim();
  if (!req || !nextVoice) return;

  const settings = await getCachedAiSettings();
  const providerType = resolveFeatureConfig(settings, "voice-narration")
    ?.provider.type;
  queue = queue.map((item, index) =>
    index >= queueIndex && item.id === req.id
      ? {
          ...item,
          voice: nextVoice,
          voices: providerType
            ? { ...item.voices, [providerType]: nextVoice }
            : item.voices,
        }
      : item,
  );
  await playCurrent();
}

/** Retry the active queue item after a recoverable provider or playback error. */
export async function retrySpeech(): Promise<void> {
  if (!queue[queueIndex]) return;
  await playCurrent();
}

type Synthesis = {
  audio: Blob;
  provider: string;
  model: string;
  voice: string;
};

/**
 * Get generated audio for a passage.
 *
 * A configured BYOK voice provider is authoritative: its selected provider
 * and model are used, and failures are surfaced rather than silently changing
 * models. Hosted speech is considered only when no BYOK voice provider exists.
 */
async function synthesize(req: SpeakRequest): Promise<Synthesis> {
  const text = req.text.trim();
  const settings = await getCachedAiSettings();

  // Gate on a provider that can *narrate*, not merely one that can do some
  // voice feature. `hasConfiguredVoiceProvider` is true for transcription-only
  // providers too (Google, say), and gating on it stranded any writer running
  // Anthropic for the room and Google for dictation: narration resolved to
  // nothing, this threw, and the hosted path below was never reached.
  const narrator = resolveFeatureConfig(settings, "voice-narration");
  if (narrator) {
    const result = await runClientVoiceSpeech(
      {
        text,
        voice: resolveVoice(req, settings),
        instructions: req.instructions,
      },
      settings,
    );
    if (result) {
      return {
        audio: result.audio,
        provider: result.provider,
        model: result.model,
        voice: result.voice,
      };
    }
    throw createAppError("PROVIDER_ERROR", {
      source: "provider",
      metadata: {
        feature: "voice-narration",
        operation: "synthesize",
        provider: narrator.provider.type,
        model: narrator.model,
      },
    });
  }

  if (req.client && req.signedIn) {
    try {
      const res = (await req.client.action(api.voice.synthesizeSpeech, {
        text,
        voice: req.voice,
        instructions: req.instructions,
      })) as { audioBase64: string; mimeType: string };
      const bytes = Uint8Array.from(atob(res.audioBase64), (c) =>
        c.charCodeAt(0),
      );
      return {
        audio: new Blob([bytes], { type: res.mimeType }),
        provider: "hosted",
        model: "hosted",
        voice: req.voice ?? "alloy",
      };
    } catch (err) {
      reportApplicationDiagnostic("twyne:speech:hosted-declined", err, {
        feature: "voice-narration",
      });
      throw err;
    }
  }

  throw createAppError("CONFIGURATION_ERROR", {
    source: "application",
    recovery: { action: "choose-provider", canRetry: false },
    metadata: { feature: "voice-narration", operation: "synthesize" },
  });
}

/**
 * The object URL for a passage, synthesising it if this is the first ask.
 *
 * Split out of the playback path so the next passage in a queue can be
 * prepared while the current one is still sounding. Both callers go through
 * the same cache and the same in-flight map, which is what keeps a skip
 * during a prefetch from paying for the same paragraph twice.
 */
async function resolveClip(req: SpeakRequest): Promise<string> {
  const text = req.text.trim();
  const spoken = await withPersonaVoice(req);
  // Key the cache on the voice that will actually be used, so two editors
  // sharing a fallback name never collide on one clip.
  const settings = await getCachedAiSettings();
  const resolved = resolveFeatureConfig(settings, "voice-narration");
  const override = settings.perFeature["voice-narration"];
  const voice = resolveVoice(spoken, settings) ?? spoken.voice ?? "alloy";
  const key = cacheKey(
    text,
    resolved?.provider.id ?? "hosted",
    resolved?.model ?? "hosted",
    voice,
    override?.responseFormat ?? "mp3",
    override?.speed,
    spoken.instructions ?? override?.instructions,
  );

  const cached = cache.get(key);
  if (cached) {
    // Re-insert so the clip counts as recently used. Eviction walks insertion
    // order, and without this a long queue could revoke the object URL of the
    // very clip that is playing.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = synthesize({ ...spoken, text })
    .then((result) => {
      const url = URL.createObjectURL(result.audio);
      remember(key, url);
      return url;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, work);
  return work;
}

/**
 * Start synthesising the next passage while this one plays.
 *
 * Without it every editor in the room is followed by a silence the length of a
 * synthesis call, which reads as the queue having finished. A failure here is
 * deliberately swallowed: the passage is synthesised again when it comes
 * round, and *that* attempt reports properly.
 */
function prefetchNext(): void {
  const upcoming = queue[queueIndex + 1];
  if (!upcoming?.text.trim()) return;
  void resolveClip(upcoming).catch(() => {});
}

/**
 * Read a passage aloud. Pressing the same passage again pauses or resumes it
 * (so one button is play and pause); pressing a different one switches over.
 */
export async function speak(req: SpeakRequest): Promise<void> {
  if (typeof window === "undefined") return;

  // Same passage, already sounding → this press means "pause". Not "stop":
  // discarding the position on a second press makes a long reading impossible
  // to interrupt without starting over.
  if (state.id === req.id) {
    if (state.status === "playing") {
      pauseSpeech();
      return;
    }
    if (state.status === "paused") {
      resumeSpeech();
      return;
    }
    if (state.status === "loading") {
      stopSpeech();
      return;
    }
  }

  const segments = req.progressive
    ? segmentSpeechText(req.text).map((segment) => ({
        ...req,
        text: segment.text,
        sourceOffset: (req.sourceOffset ?? 0) + segment.start,
      }))
    : [req];
  await speakQueue(segments, {
    ownerId: segments.length > 1 ? req.id : undefined,
  });
}

/**
 * Read several passages in turn — the room's memos, one editor after another.
 *
 * Each passage keeps its own voice, so the queue is a list of ordinary
 * requests rather than one concatenated blob of text: that is what lets the
 * writer skip an editor, and what keeps five voices from being flattened into
 * one. `ownerId` lets a transport claim the whole queue, since the active id
 * moves on with every passage.
 */
export async function speakQueue(
  requests: SpeakRequest[],
  options: { startIndex?: number; ownerId?: string } = {},
): Promise<void> {
  if (typeof window === "undefined") return;

  const items = requests.filter((r) => r.text.trim());
  if (!items.length) return;

  // Still synchronous, so the press counts as a user gesture. Everything below
  // this line is too late to claim playback permission.
  unlockSpeechPlayback();

  haltPlayback();
  queue = items;
  queueIndex = Math.min(Math.max(options.startIndex ?? 0, 0), items.length - 1);
  queueOwner = options.ownerId ?? null;
  await playCurrent();
}

/** Play whatever `queueIndex` points at, from the top. */
async function playCurrent(): Promise<void> {
  const req = queue[queueIndex];
  if (!req) {
    stopSpeech();
    return;
  }

  haltPlayback();
  const mine = generation;

  // Everything from here is inside the try. Resolving the cast voice and
  // reading the AI settings both used to happen *before* the state was set to
  // loading and outside any catch, so a failure in either — an unreadable
  // IndexedDB, settings that have never been written — rejected this promise
  // with the UI still showing idle. The writer pressed read and got nothing
  // at all, which looks exactly like a broken button.
  setState("loading", req.id);

  try {
    const url = await resolveClip(req);
    if (mine !== generation) return; // the writer moved on

    audio = audio ?? new Audio();
    audio.muted = false;
    audio.src = url;
    audio.onended = () => {
      if (mine !== generation) return;
      // On to the next editor. The queue is abandoned only at the end, so the
      // transport keeps its position and its skip controls throughout.
      if (hasNextSpeech()) {
        queueIndex += 1;
        void playCurrent();
        return;
      }
      stopSpeech();
    };
    audio.onloadedmetadata = () => {
      if (mine !== generation || !audio) return;
      state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      notify();
    };
    audio.ontimeupdate = () => {
      if (mine !== generation || !audio) return;
      state.currentTime = audio.currentTime;
      notify();
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
    if (mine === generation) {
      const menu = await currentSpeechVoiceMenu();
      if (mine !== generation) return;
      state.provider = menu?.provider ?? null;
      state.model = menu?.model ?? null;
      state.voice = menu?.selected ?? null;
      setState("playing", req.id);
      prefetchNext();
    }
  } catch (err) {
    if (mine !== generation) return;
    // A blocked play() is not a provider failure, and telling the writer to
    // check their API key when the browser simply refused to make noise sends
    // them off to fix something that was never wrong.
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      setState("error", req.id, {
        ...createAppError("PERMISSION_DENIED", {
          source: "application",
          recovery: { action: "retry", canRetry: true },
          metadata: { feature: "voice-narration", operation: "playback" },
        }),
        message:
          "Your browser blocked playback. Press read aloud again to allow it.",
      });
      return;
    }
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
