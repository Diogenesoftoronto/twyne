import {
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
  $,
  noSerialize,
  Slot,
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

interface ChatComposerProps {
  /** Current draft. The parent owns it, so a caller can prefill or clear it. */
  value: string;
  onValueChange$: PropFunction<(value: string) => void>;
  onSend$: PropFunction<() => void>;
  placeholder?: string;
  /** Work is in flight: the send key becomes a stop key when `onStop$` exists. */
  busy?: boolean;
  onStop$?: PropFunction<() => void>;
  disabled?: boolean;
  /** Terms likely to appear, to help the transcriber with proper nouns. */
  transcriptionHint?: string;
  /** Hide the microphone where dictation makes no sense. */
  allowVoice?: boolean;
  /** Accessible name for the text box. */
  label?: string;
  /** Names the send key where "Send" is the wrong verb — "Steer", say. */
  sendLabel?: string;
}

interface ComposerStore {
  phase: "idle" | "recording" | "transcribing";
  elapsedMs: number;
  level: number;
  paused: boolean;
  error: AppError | null;
  handle: NoSerialize<RecorderHandle> | null;
  /** Lets the writer stop an in-flight transcription. */
  transcribeAbort: NoSerialize<AbortController> | null;
}

/**
 * The place a writer speaks from — one surface holding the text, the
 * microphone and the send key.
 *
 * Modelled on the composers in modern chat clients, for the ordinary reason
 * that writers already know how those behave: Enter sends, Shift+Enter breaks
 * the line, the box grows with the text instead of scrolling inside three
 * fixed rows, and the controls live inside the field rather than stacked
 * underneath it as separate widgets.
 *
 * Two departures from the recorder it replaces:
 *
 *   - **Dictation lands in the draft, not in a review box.** The old recorder
 *     transcribed into its own textarea with keep/discard buttons. That is the
 *     right shape when the transcript becomes a note directly, but here the
 *     destination is already an editable field the writer is looking at — a
 *     second one asks them to approve their words twice.
 *   - **Recording happens in the toolbar.** Replacing the composer with the
 *     recorder hides whatever was already typed, and dictation is usually
 *     *adding* to a draft rather than starting one.
 */
export const ChatComposer = component$<ChatComposerProps>((props) => {
  const clientSig = useConvexClient();
  const inputRef = useSignal<HTMLTextAreaElement>();
  const canDictate = useSignal(false);
  const store = useStore<ComposerStore>({
    phase: "idle",
    elapsedMs: 0,
    level: 0,
    paused: false,
    error: null,
    handle: null,
    transcribeAbort: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    canDictate.value = props.allowVoice !== false && canRecord();
    track(() => store.phase);
    if (store.phase !== "recording") return;
    // The handle counts active audio, so a pause freezes the elapsed.
    const timer = setInterval(() => {
      store.elapsedMs = store.handle?.elapsed() ?? 0;
      store.level = store.handle?.level() ?? 0;
    }, 100);
    cleanup(() => clearInterval(timer));
  });

  // Grow with the content up to the CSS max-height, then scroll. Driven off
  // the value rather than the input event so a programmatic prefill (a
  // transcript landing, say) resizes too.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const el = track(() => inputRef.value);
    track(() => props.value);
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  const submit = $(async () => {
    if (props.disabled || props.busy) return;
    if (!props.value.trim()) return;
    await props.onSend$();
  });

  const beginRecording = $(async () => {
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

  const pauseRecording = $(() => {
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

  const finishRecording = $(async () => {
    const handle = store.handle;
    if (!handle) return;
    const recording = await handle.stop();
    store.handle = null;
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
      });
      if (store.phase !== "transcribing") return;
      const spoken = text.trim();
      if (spoken) {
        const existing = props.value.trim();
        await props.onValueChange$(existing ? `${existing} ${spoken}` : spoken);
      }
      store.phase = "idle";
      inputRef.value?.focus();
    } catch (err) {
      if (store.phase !== "transcribing" || abort.signal.aborted) return;
      store.error = normalizeApplicationError(err, {
        source: "provider",
        metadata: { feature: "voice-notes", operation: "transcribe" },
      });
      store.phase = "idle";
    } finally {
      store.transcribeAbort = null;
    }
  });

  const discardRecording = $(() => {
    store.handle?.cancel();
    store.handle = null;
    store.transcribeAbort?.abort();
    store.transcribeAbort = null;
    store.phase = "idle";
    store.elapsedMs = 0;
    store.paused = false;
  });

  const recording = store.phase === "recording";
  const sendable = Boolean(props.value.trim()) && !props.disabled;
  const showStop = Boolean(props.busy && props.onStop$);

  return (
    <div class="space-y-2">
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

      <div
        class="composer"
        data-recording={recording ? "true" : "false"}
        data-disabled={props.disabled ? "true" : "false"}
      >
        <textarea
          ref={inputRef}
          class="composer-input"
          rows={1}
          value={props.value}
          placeholder={props.placeholder ?? "Write your answer…"}
          disabled={props.disabled}
          aria-label={props.label ?? "Message"}
          onInput$={(_, el) => {
            void props.onValueChange$(el.value);
          }}
          onKeyDown$={(e, el) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat client shares. ⌘/Ctrl+Enter keeps working for the writers
            // who learned it here first.
            if (e.key !== "Enter") return;
            if (e.shiftKey) return;
            if (e.isComposing) return; // mid-IME candidate selection
            e.preventDefault();
            if (!el.value.trim()) return;
            void submit();
          }}
        />

        <div class="composer-bar">
          <div class="composer-bar-left">
            {recording ? (
              <div class="composer-recording" role="status">
                <span class="composer-rec-dot" aria-hidden="true" />
                <span class="composer-elapsed">
                  {formatDuration(store.elapsedMs)}
                </span>
                <LevelMeter level={store.paused ? 0 : store.level} />
                <button
                  type="button"
                  onClick$={pauseRecording}
                  class="btn-press text-[11px] px-2 py-0.5"
                  title={store.paused ? "Resume recording" : "Pause recording"}
                >
                  {store.paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick$={finishRecording}
                  class="btn-press text-[11px] px-2 py-0.5"
                  title="Stop and transcribe"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick$={discardRecording}
                  class="focus-ring text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Discard
                </button>
              </div>
            ) : store.phase === "transcribing" ? (
              <div class="flex items-center gap-2" role="status">
                <span
                  class="text-[0.65rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Setting down what you said…
                </span>
                <button
                  type="button"
                  onClick$={discardRecording}
                  class="focus-ring text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {canDictate.value && (
                  <button
                    type="button"
                    onClick$={beginRecording}
                    disabled={props.disabled}
                    class="icon-btn p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] disabled:opacity-30"
                    title="Answer out loud"
                    aria-label="Answer out loud"
                  >
                    <MicIcon />
                  </button>
                )}
                {/* Callers hang extra actions here — "show me what you have",
                    a model picker, an attachment. */}
                <Slot name="actions" />
              </>
            )}
          </div>

          {!recording && (
            <span class="composer-hint">⏎ {props.sendLabel ?? "Send"}</span>
          )}

          {showStop ? (
            <button
              type="button"
              onClick$={props.onStop$}
              class="composer-send"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick$={submit}
              disabled={!sendable || props.busy}
              class="composer-send"
              title={props.sendLabel ?? "Send"}
              aria-label={props.sendLabel ?? "Send"}
            >
              {props.busy ? (
                <span
                  class="animate-pulse text-[0.8rem] leading-none"
                  aria-hidden="true"
                  style="font-family: var(--font-display);"
                >
                  ✦
                </span>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

function LevelMeter({ level }: { level: number }) {
  const bars = 5;
  return (
    <span class="flex items-end gap-[2px]" aria-hidden="true">
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
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
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
