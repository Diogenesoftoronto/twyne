import {
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
  $,
  noSerialize,
  type NoSerialize,
  type PropFunction,
} from "@qwik.dev/core";
import { useConvexClient } from "../../utils/convex-context";
import {
  canRecord,
  formatDuration,
  startRecording,
  transcribeRecording,
  type RecorderHandle,
} from "../../utils/voice-notes";
import { ApplicationNotice } from "./application-notice";
import type { AppError } from "../../types/application-errors";
import { normalizeApplicationError } from "../../utils/application-errors";

export interface VoiceCapture {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  transcript: string;
}

interface VoiceRecorderProps {
  /**
   * Fired once the writer accepts the transcript. The audio comes with it —
   * the caller decides whether to keep it.
   */
  onCapture$: PropFunction<(capture: VoiceCapture) => void>;
  /** Optional integration hook for streamed and final transcript updates. */
  onTranscript$?: PropFunction<(transcript: string, final: boolean) => void>;
  /** Terms likely to appear, to help the transcriber with proper nouns. */
  transcriptionHint?: string;
  /** Wording for the idle button. */
  label?: string;
  compact?: boolean;
}

interface RecorderStore {
  phase: "idle" | "recording" | "transcribing" | "review";
  elapsedMs: number;
  level: number;
  paused: boolean;
  transcript: string;
  error: AppError | null;
  handle: NoSerialize<RecorderHandle> | null;
  /** Lets the writer stop an in-flight transcription. */
  transcribeAbort: NoSerialize<AbortController> | null;
  captured: NoSerialize<{
    blob: Blob;
    mimeType: string;
    durationMs: number;
  }> | null;
}

/**
 * Record a voice note, transcribe it, and let the writer fix the words before
 * they land.
 *
 * The review step is not optional politeness. Transcription mishears names,
 * jargon and anything said quickly, and this text is about to become a note in
 * the writer's own document — so they get the last edit. The audio is kept
 * either way, which is what makes it a voice note rather than dictation.
 */
export const VoiceRecorder = component$<VoiceRecorderProps>((props) => {
  const clientSig = useConvexClient();
  const supported = useSignal(true);
  const store = useStore<RecorderStore>({
    phase: "idle",
    elapsedMs: 0,
    level: 0,
    paused: false,
    transcript: "",
    error: null,
    handle: null,
    transcribeAbort: null,
    captured: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    supported.value = canRecord();
    track(() => store.phase);
    if (store.phase !== "recording") return;
    // Drive the timer and the level meter while recording. The handle counts
    // active audio, so a pause freezes the elapsed — wall clock never slips
    // into the label or the recording budget.
    const timer = setInterval(() => {
      store.elapsedMs = store.handle?.elapsed() ?? 0;
      store.level = store.handle?.level() ?? 0;
    }, 100);
    cleanup(() => clearInterval(timer));
  });

  const begin = $(async () => {
    store.error = null;
    try {
      const handle = await startRecording();
      store.handle = noSerialize(handle);
      store.elapsedMs = 0;
      store.paused = false;
      store.phase = "recording";
    } catch (err) {
      store.error = normalizeApplicationError(err, {
        source: "application",
        metadata: { feature: "voice-notes", operation: "record" },
      });
    }
  });

  const pause = $(() => {
    const handle = store.handle;
    if (!handle) return;
    if (store.paused) {
      handle.resume();
      store.paused = false;
    } else {
      handle.pause();
      store.paused = true;
    }
  });

  const finish = $(async () => {
    const handle = store.handle;
    if (!handle) return;
    const recording = await handle.stop();
    store.handle = null;
    store.captured = noSerialize(recording);
    store.transcript = "";
    store.phase = "transcribing";
    const abort = new AbortController();
    store.transcribeAbort = noSerialize(abort);
    try {
      const { text } = await transcribeRecording({
        blob: recording.blob,
        mimeType: recording.mimeType,
        client: clientSig.value ?? null,
        prompt: props.transcriptionHint,
        signal: abort.signal,
        onDelta: (text) => {
          if (store.phase !== "transcribing") return;
          store.transcript = text;
          void props.onTranscript$?.(text, false);
        },
      });
      // The writer pressed Cancel while the words were being set down.
      if (store.phase !== "transcribing") return;
      store.transcript = text;
      await props.onTranscript$?.(text, true);
      store.phase = "review";
    } catch (err) {
      // The recording survives a failed transcription — the writer can still
      // keep the audio, or start again if they stopped it themselves.
      if (store.phase !== "transcribing" || abort.signal.aborted) return;
      store.error = normalizeApplicationError(err, {
        source: "provider",
        metadata: { feature: "voice-notes", operation: "transcribe" },
      });
      store.transcript = "";
      store.phase = "review";
    } finally {
      store.transcribeAbort = null;
    }
  });

  const discard = $(() => {
    store.handle?.cancel();
    store.handle = null;
    store.transcribeAbort?.abort();
    store.transcribeAbort = null;
    store.captured = null;
    store.transcript = "";
    store.error = null;
    store.paused = false;
    store.phase = "idle";
  });

  const accept = $(() => {
    const captured = store.captured;
    if (!captured) return;
    props.onCapture$({
      blob: captured.blob,
      mimeType: captured.mimeType,
      durationMs: captured.durationMs,
      transcript: store.transcript.trim(),
    });
    store.captured = null;
    store.transcript = "";
    store.error = null;
    store.phase = "idle";
  });

  if (!supported.value) return null;

  return (
    <div class="space-y-2">
      {store.phase === "idle" && (
        <button
          onClick$={begin}
          class={
            props.compact
              ? "icon-btn p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
              : "btn-paper text-xs"
          }
          title={props.label ?? "Record a voice note"}
          aria-label={props.label ?? "Record a voice note"}
        >
          {props.compact ? (
            <MicIcon />
          ) : (
            <>
              <MicIcon /> {props.label ?? "Record a note"}
            </>
          )}
        </button>
      )}

      {store.phase === "recording" && (
        <div
          class="flex items-center gap-2 rounded-[3px] border border-[var(--color-vermilion)] bg-[var(--color-paper-soft)] px-2.5 py-1.5"
          role="status"
        >
          <span
            class="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[var(--color-vermilion)]"
            aria-hidden="true"
          />
          <span
            class="text-xs tabular-nums text-[var(--color-ink)]"
            style="font-family: var(--font-typewriter);"
          >
            {formatDuration(store.elapsedMs)}
          </span>
          <LevelMeter level={store.paused ? 0 : store.level} />
          <button
            onClick$={pause}
            class="btn-press text-[11px] px-2 py-0.5"
            title={store.paused ? "Resume recording" : "Pause recording"}
          >
            {store.paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick$={finish}
            class="btn-press text-[11px] px-2 py-0.5"
            title="Stop and transcribe"
          >
            Stop
          </button>
          <button
            onClick$={discard}
            class="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            Discard
          </button>
        </div>
      )}

      {store.phase === "transcribing" && (
        <div
          class="space-y-2 rounded-[3px] border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-2.5"
          role="status"
        >
          <div class="flex items-center justify-between gap-3">
            <p
              class="text-xs text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter); letter-spacing: 0.08em;"
            >
              {store.transcript
                ? "Transcribing as the words arrive…"
                : "Setting down what you said…"}
            </p>
            <button
              onClick$={discard}
              class="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] focus-ring"
              style="font-family: var(--font-typewriter);"
            >
              Cancel
            </button>
          </div>
          {store.transcript && (
            <p
              class="max-h-24 overflow-y-auto text-xs leading-relaxed text-[var(--color-ink)]"
              style="font-family: var(--font-serif);"
              aria-live="polite"
            >
              {store.transcript}
              <span
                class="ml-1 animate-pulse text-[var(--color-vermilion)]"
                aria-hidden="true"
              >
                ▌
              </span>
            </p>
          )}
        </div>
      )}

      {store.phase === "review" && (
        <div class="space-y-2 rounded-[3px] border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-2.5">
          <p
            class="text-[0.6rem] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            {store.captured
              ? `Your words · ${formatDuration(store.captured.durationMs)}`
              : "Your words"}
          </p>
          {store.error && (
            <ApplicationNotice
              error={store.error}
              compact
              recoveryLabel="Open AI settings"
              recoveryHref="/settings/"
              onDismiss$={$(() => {
                store.error = null;
              })}
            />
          )}
          <textarea
            value={store.transcript}
            rows={3}
            placeholder="Type the note — the recording is kept either way."
            onInput$={(_, el) => {
              store.transcript = el.value;
            }}
            class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-vermilion)] focus:outline-none"
            style="font-family: var(--font-serif); border-radius: 2px;"
            aria-label="Transcript, editable before saving"
          />
          <div class="flex items-center gap-2">
            <button
              onClick$={accept}
              disabled={!store.transcript.trim()}
              class="btn-press flex-1 text-xs disabled:opacity-30"
            >
              Keep it
            </button>
            <button onClick$={discard} class="btn-paper flex-1 text-xs">
              Throw it out
            </button>
          </div>
        </div>
      )}

      {store.phase === "idle" && store.error && (
        <ApplicationNotice
          error={store.error}
          compact
          onDismiss$={$(() => {
            store.error = null;
          })}
        />
      )}
    </div>
  );
});

function LevelMeter({ level }: { level: number }) {
  const bars = 5;
  return (
    <span class="flex flex-1 items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const lit = level * bars > i;
        return (
          <span
            key={i}
            class="w-[3px] transition-all"
            style={{
              height: `${4 + i * 2}px`,
              background: lit
                ? "var(--color-vermilion)"
                : "var(--color-paper-3)",
            }}
          />
        );
      })}
    </span>
  );
}

function MicIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
      style="display: inline-block; vertical-align: -2px;"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="12"
        rx="3"
        fill="currentColor"
        stroke="none"
      />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
