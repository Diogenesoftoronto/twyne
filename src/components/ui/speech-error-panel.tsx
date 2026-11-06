import { component$, useStore, useTask$, type PropFunction } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { AppError } from "../../types/application-errors";
import {
  copyStatusMessage,
  describeSpeechError,
  type CopyStatus,
} from "./speech-error-model";

interface SpeechErrorPanelProps {
  error: AppError | null;
  label: string;
  queueIndex: number;
  queueLength: number;
  canGoNext: boolean;
  onRetry$: PropFunction<() => void>;
  onNext$: PropFunction<() => void>;
  onClose$: PropFunction<() => void>;
}

/** Full-width, readable failure state for the global narration player. */
export const SpeechErrorPanel = component$((props: SpeechErrorPanelProps) => {
  const view = describeSpeechError(props.error);
  const local = useStore<{ copy: CopyStatus }>({ copy: "idle" });
  const ref = props.error?.referenceId;
  useTask$(({ track }) => {
    track(() => props.error?.referenceId);
    local.copy = "idle";
  });

  return (
    <div
      class="max-h-[min(70vh,28rem)] overflow-y-auto p-3"
      role="alert"
      aria-live="assertive"
      data-speech-error={props.error?.code ?? "UNKNOWN"}
    >
      <div class="flex items-start gap-3">
        <span
          class="mt-0.5 text-base leading-none text-[var(--color-vermilion)]"
          style={{ fontFamily: "var(--font-display)" }}
          aria-hidden="true"
        >
          !
        </span>
        <div class="min-w-0 flex-1">
          <p
            class="text-sm font-semibold text-[var(--color-ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {view.title}
          </p>
          <p
            class="mt-0.5 text-[0.65rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {props.label || "Read aloud"}
            {props.queueLength > 1 &&
              ` · ${props.queueIndex + 1} of ${props.queueLength}`}
          </p>
          <p
            class="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--color-ink-light)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {view.message}
            {view.suggestVoiceChange && " Trying another voice may help."}
          </p>
          {view.retryAfterSeconds !== undefined && (
            <p
              class="mt-1 text-[0.65rem] text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Try again in about {view.retryAfterSeconds} seconds.
            </p>
          )}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            {view.recovery && view.primaryRecovery && (
              <Link class="btn-press text-xs" href={view.recovery.href}>
                {view.recovery.label}
              </Link>
            )}
            {view.retry && (
              <button
                type="button"
                class="btn-press text-xs"
                onClick$={props.onRetry$}
              >
                Try again
              </button>
            )}
            {view.recovery && !view.primaryRecovery && (
              <Link class="btn-paper text-xs" href={view.recovery.href}>
                {view.recovery.label}
              </Link>
            )}
            {props.canGoNext && (
              <button
                type="button"
                class="btn-paper text-xs"
                onClick$={props.onNext$}
              >
                Skip to next
              </button>
            )}
          </div>
          {ref && (
            <p
              class="mt-2 flex flex-wrap items-center gap-2 text-[0.6rem] tracking-[0.08em] text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              <span class="select-all break-all">Reference {ref}</span>
              <button
                type="button"
                class="focus-ring underline"
                onClick$={async () => {
                  try {
                    await navigator.clipboard.writeText(ref);
                    local.copy = "copied";
                  } catch {
                    local.copy = "failed";
                  }
                }}
                aria-label="Copy error reference"
              >
                {local.copy === "copied" ? "Copied" : "Copy"}
              </button>
            </p>
          )}
          <p
            role="status"
            aria-live="polite"
            class="mt-1 text-[0.65rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {copyStatusMessage(local.copy)}
          </p>
        </div>
        <button
          type="button"
          class="tool-btn shrink-0"
          aria-label="Stop narration and close player"
          title="Close"
          onClick$={props.onClose$}
        >
          ×
        </button>
      </div>
    </div>
  );
});
