import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@builder.io/qwik";
import { speechState, type SpeechStatus } from "../../utils/speech";

interface SpeechTransportProps {
  /**
   * The id this transport owns, matched against the speech manager's. A
   * transport driving a queue passes the same string as `speakQueue`'s
   * `ownerId`, since the active passage id moves on as the queue advances.
   */
  id: string;
  /** Starts a reading. Called only when nothing of ours is already sounding. */
  onPlay$: PropFunction<() => void>;
  /** Label for the play control when idle. */
  playLabel?: string;
}

/**
 * A local trigger for the application-wide narration player.
 *
 * Once this surface starts a reading, the global player owns every transport
 * action. Keeping this component trigger-only avoids mounting two synchronized
 * play/pause/skip/seek/stop interfaces for the same audio session.
 */
export const SpeechTransport = component$<SpeechTransportProps>((props) => {
  const status = useSignal<SpeechStatus>("idle");

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const sync = () => {
      const s = speechState();
      if (s.id === props.id || (s.ownerId && s.ownerId === props.id)) {
        status.value = s.status;
      } else if (status.value !== "idle") {
        status.value = "idle";
      }
    };
    window.addEventListener("twyne:speech", sync);
    sync();
    cleanup(() => window.removeEventListener("twyne:speech", sync));
  });

  if (status.value !== "idle") {
    const message =
      status.value === "loading"
        ? "Preparing in player"
        : status.value === "paused"
          ? "Paused in player"
          : status.value === "error"
            ? "Narration needs attention in player"
            : "Playing in player";
    return (
      <span
        class="inline-flex items-center text-[0.62rem] text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter);"
        role="status"
      >
        ♪ {message}
      </span>
    );
  }

  return (
    <span class="inline-flex items-center">
      <button
        type="button"
        onClick$={props.onPlay$}
        class="tool-btn"
        title={props.playLabel ?? "Read aloud"}
        aria-label={props.playLabel ?? "Read aloud"}
      >
        ♪ read
      </button>
    </span>
  );
});
