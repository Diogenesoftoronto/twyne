import {
  component$,
  useSignal,
  useVisibleTask$,
  $,
  type PropFunction,
} from "@builder.io/qwik";
import {
  nextSpeech,
  previousSpeech,
  seekSpeech,
  speechState,
  stopSpeech,
  togglePauseSpeech,
  type SpeechStatus,
} from "../../utils/speech";

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

function mmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Play / pause / stop for reading the manuscript aloud, with progress.
 *
 * The toolbar previously had a bare "read" button that called the speech
 * manager and then showed nothing at all — no spinner while a paragraph was
 * being synthesised, no indication it was playing, and, most damagingly, no
 * error when synthesis failed. A writer with no voice provider configured
 * pressed it and got silence, which is indistinguishable from a broken button.
 * Everything this component adds exists to make the state visible.
 *
 * The controls collapse when idle: one play button, and the transport only
 * unfolds once there is something to control. Skip and the "3/5 Marguerite"
 * readout appear only for a queue — reading one passage has nowhere to skip
 * to, and a transport that shows "1/1" is just noise.
 */
export const SpeechTransport = component$<SpeechTransportProps>((props) => {
  const status = useSignal<SpeechStatus>("idle");
  const errorMessage = useSignal("");
  const current = useSignal(0);
  const total = useSignal(0);
  const position = useSignal(0);
  const count = useSignal(0);
  const nowReading = useSignal("");

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const sync = () => {
      const s = speechState();
      if (s.id === props.id || (s.ownerId && s.ownerId === props.id)) {
        status.value = s.status;
        errorMessage.value = s.error?.message ?? "";
        current.value = s.currentTime;
        total.value = s.duration;
        position.value = s.queueIndex;
        count.value = s.queueLength;
        nowReading.value = s.label ?? "";
      } else if (status.value !== "idle") {
        // Another passage took over; this transport goes quiet.
        status.value = "idle";
        errorMessage.value = "";
        current.value = 0;
        total.value = 0;
        position.value = 0;
        count.value = 0;
        nowReading.value = "";
      }
    };
    window.addEventListener("twyne:speech", sync);
    sync();
    cleanup(() => window.removeEventListener("twyne:speech", sync));
  });

  const primary = $(() => {
    if (status.value === "playing" || status.value === "paused") {
      togglePauseSpeech();
      return;
    }
    props.onPlay$();
  });

  const active =
    status.value === "playing" ||
    status.value === "paused" ||
    status.value === "loading";

  // Skip controls only earn their space when there is somewhere to skip to.
  const queued = count.value > 1;

  const primaryLabel =
    status.value === "playing"
      ? "Pause reading"
      : status.value === "paused"
        ? "Resume reading"
        : status.value === "loading"
          ? "Preparing the reading — press to cancel"
          : (props.playLabel ?? "Read aloud");

  return (
    <span class="inline-flex items-center gap-1">
      {active && queued && (
        <button
          type="button"
          onClick$={() => previousSpeech()}
          class="tool-btn"
          title="Back to the start of this one, or to the one before"
          aria-label="Previous passage"
        >
          ⏮
        </button>
      )}

      <button
        type="button"
        onClick$={primary}
        class="tool-btn"
        title={
          status.value === "error"
            ? errorMessage.value || "Could not read this aloud"
            : primaryLabel
        }
        aria-label={primaryLabel}
        aria-pressed={status.value === "playing"}
        style={{
          color:
            status.value === "error"
              ? "var(--color-accent-red)"
              : status.value === "playing" || status.value === "paused"
                ? "var(--color-vermilion)"
                : undefined,
        }}
      >
        {status.value === "loading"
          ? "◌ read"
          : status.value === "playing"
            ? "❚❚ pause"
            : status.value === "paused"
              ? "▶ resume"
              : "♪ read"}
      </button>

      {active && queued && (
        <button
          type="button"
          onClick$={() => nextSpeech()}
          class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
          title="Skip to the next one"
          aria-label="Next passage"
          disabled={position.value >= count.value - 1}
        >
          ⏭
        </button>
      )}

      {active && (
        <>
          <button
            type="button"
            onClick$={() => stopSpeech()}
            class="tool-btn"
            title="Stop reading"
            aria-label="Stop reading"
          >
            ■
          </button>
          {queued && (
            <span
              class="text-[0.62rem] text-[var(--color-ink-muted)] max-w-[10rem] truncate"
              style="font-family: var(--font-typewriter);"
              role="status"
              title={
                nowReading.value
                  ? `Reading ${nowReading.value} — ${position.value + 1} of ${count.value}`
                  : undefined
              }
            >
              {position.value + 1}/{count.value}
              {nowReading.value ? ` ${nowReading.value}` : ""}
            </span>
          )}
          {total.value > 0 && (
            <label
              class="inline-flex items-center gap-1 text-[0.62rem] text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              <span class="sr-only">Reading position</span>
              <input
                type="range"
                class="margin-slider"
                style="width: 5rem;"
                min={0}
                max={total.value}
                step={0.1}
                value={current.value}
                onInput$={(_, el) => seekSpeech(Number(el.value))}
                aria-label="Reading position"
              />
              <span class="tabular-nums">
                {mmss(current.value)}/{mmss(total.value)}
              </span>
            </label>
          )}
        </>
      )}

      {/* The whole point of the rebuild: a failure the writer can actually
          see. Kept inline and terse so it does not shove the toolbar around.
          Falls back to generic wording rather than rendering an empty box —
          "something went wrong" still beats the silence this replaced. */}
      {status.value === "error" && (
        <span
          role="status"
          class="text-[0.62rem] text-[var(--color-accent-red)] max-w-[16rem] truncate"
          style="font-family: var(--font-typewriter);"
          title={errorMessage.value || "Could not read this aloud"}
        >
          {errorMessage.value || "Could not read this aloud"}
        </span>
      )}
    </span>
  );
});
