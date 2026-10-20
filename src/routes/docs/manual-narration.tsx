import { $, component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import {
  MANUAL_NARRATION,
  NARRATION_ORDER,
  narrationSrc,
} from "./manual-narration-script";
import GENERATED from "./manual-narration.generated.json";

/*
 * One audio element plays every chapter. A chapter's Listen control asks the
 * host for its narration; when a chapter ends, the host carries straight on
 * into the next one, so pressing Listen once reads the manual through. One
 * element also means the browser's permission to play, granted by that first
 * press, holds for every chapter that follows.
 */

const COMMAND = "twyne:manual-narration";
const STATE = "twyne:manual-narration-state";

type NarrationCommand =
  | { action: "toggle"; chapter: string }
  | { action: "seek"; chapter: string; time: number }
  | { action: "pause" };

export interface NarrationState {
  chapter: string | null;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  time: number;
  segment: number;
}

const generated = GENERATED as Record<
  string,
  { duration: number; segments: number[] }
>;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function command(detail: NarrationCommand): void {
  window.dispatchEvent(new CustomEvent(COMMAND, { detail }));
}

/** Which paragraph is being read at `time`. */
function segmentAt(chapter: string, time: number): number {
  const starts = generated[chapter]?.segments ?? [0];
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= time) index = i;
  return index;
}

/** Pause the narration; the page calls this when a film starts. */
export function pauseManualNarration(): void {
  if (typeof window !== "undefined") command({ action: "pause" });
}

/** The page's single narration audio element and its controller. */
export const ManualNarrationHost = component$<{
  titles: Record<string, string>;
}>(({ titles }) => {
  const audioRef = useSignal<HTMLAudioElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      const audio = audioRef.value;
      if (!audio) return;
      let chapter: string | null = null;
      let lastSent = "";

      const publish = (status?: NarrationState["status"]) => {
        const state: NarrationState = {
          chapter,
          status:
            status ?? (!chapter ? "idle" : audio.paused ? "paused" : "playing"),
          time: audio.currentTime,
          segment: chapter ? segmentAt(chapter, audio.currentTime) : 0,
        };
        // Time moves every frame; only whole seconds and segment changes matter.
        const key = `${state.chapter}:${state.status}:${Math.floor(state.time)}:${state.segment}`;
        if (key === lastSent) return;
        lastSent = key;
        window.dispatchEvent(new CustomEvent(STATE, { detail: state }));
      };

      const setMediaSession = (id: string) => {
        if (!("mediaSession" in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: titles[id] ?? "Twyne manual",
          artist: "Morgan Vale · Salt Roads",
          album: "The Twyne manual",
        });
      };

      const load = (id: string, at = 0) => {
        chapter = id;
        audio.src = narrationSrc(id);
        audio.currentTime = at;
        setMediaSession(id);
        publish("loading");
        void audio.play().catch(() => publish("error"));
      };

      const next = (step: 1 | -1) => {
        const order: readonly string[] = NARRATION_ORDER;
        const at = chapter ? order.indexOf(chapter) : -1;
        const id = order[at + step];
        if (!id) return null;
        return id;
      };

      /** Bring the next chapter into view if the listener was following. */
      const follow = (from: string, to: string) => {
        const control = document.querySelector(`[data-narration="${from}"]`);
        const rect = control?.getBoundingClientRect();
        const following =
          rect && rect.bottom > 0 && rect.top < window.innerHeight;
        if (!following) return;
        document.getElementById(to)?.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      };

      const onCommand = (event: Event) => {
        const detail = (event as CustomEvent<NarrationCommand>).detail;
        if (detail.action === "pause") {
          if (!audio.paused) audio.pause();
          return;
        }
        if (detail.chapter !== chapter) {
          load(detail.chapter, detail.action === "seek" ? detail.time : 0);
          return;
        }
        if (detail.action === "seek") {
          audio.currentTime = detail.time;
          if (audio.paused) void audio.play().catch(() => publish("error"));
          publish();
          return;
        }
        if (audio.paused) void audio.play().catch(() => publish("error"));
        else audio.pause();
      };

      const onEnded = () => {
        const from = chapter;
        const id = next(1);
        if (!from || !id) {
          chapter = null;
          publish("idle");
          return;
        }
        follow(from, id);
        load(id);
      };
      const onUpdate = () => publish();
      const onError = () => publish("error");

      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("nexttrack", () => {
          const id = next(1);
          if (id) load(id);
        });
        navigator.mediaSession.setActionHandler("previoustrack", () => {
          const id = next(-1);
          if (id) load(id);
        });
      }

      window.addEventListener(COMMAND, onCommand);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("timeupdate", onUpdate);
      audio.addEventListener("play", onUpdate);
      audio.addEventListener("pause", onUpdate);
      audio.addEventListener("playing", onUpdate);
      audio.addEventListener("error", onError);
      cleanup(() => {
        audio.pause();
        window.removeEventListener(COMMAND, onCommand);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("timeupdate", onUpdate);
        audio.removeEventListener("play", onUpdate);
        audio.removeEventListener("pause", onUpdate);
        audio.removeEventListener("playing", onUpdate);
        audio.removeEventListener("error", onError);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.setActionHandler("nexttrack", null);
          navigator.mediaSession.setActionHandler("previoustrack", null);
        }
      });
      // The audio element has no box, so a visibility trigger would never fire.
    },
    { strategy: "document-ready" },
  );

  return <audio ref={audioRef} preload="none" class="manual-narration-audio" />;
});

/** A chapter's Listen control, with a transcript that follows the voice. */
export const ManualNarration = component$<{ chapter: string; title: string }>(
  ({ chapter, title }) => {
    const narration = MANUAL_NARRATION[chapter];
    const length = generated[chapter]?.duration ?? 0;
    const state = useSignal<NarrationState>({
      chapter: null,
      status: "idle",
      time: 0,
      segment: 0,
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ cleanup }) => {
        const onState = (event: Event) => {
          const next = (event as CustomEvent<NarrationState>).detail;
          if (next.chapter === chapter) state.value = next;
          else if (state.value.status !== "idle")
            state.value = {
              chapter: null,
              status: "idle",
              time: 0,
              segment: 0,
            };
        };
        window.addEventListener(STATE, onState);
        cleanup(() => window.removeEventListener(STATE, onState));
        // A chapter carried on to off screen still has to show its state.
      },
      { strategy: "document-ready" },
    );

    const toggle = $(() => command({ action: "toggle", chapter }));
    const seek = $((time: number) =>
      command({ action: "seek", chapter, time }),
    );

    if (!narration || !length) return null;
    const status = state.value.status;
    const active = status !== "idle";
    const playing = status === "playing" || status === "loading";
    const label = playing
      ? `Pause Morgan's story: ${title}`
      : status === "paused"
        ? `Resume Morgan's story: ${title}`
        : `Listen to Morgan's story: ${title}`;

    return (
      <div
        class={["manual-narration", { "is-active": active }]}
        data-narration={chapter}
      >
        <div class="manual-narration-bar">
          <button
            type="button"
            class="manual-narration-play focus-ring"
            onClick$={toggle}
            aria-label={label}
            title={label}
          >
            {playing ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
              </svg>
            )}
          </button>
          <span class="manual-narration-listen">
            {status === "loading"
              ? "Opening…"
              : status === "error"
                ? "Narration unavailable"
                : "Listen"}
          </span>
          <span class="manual-narration-name">Morgan's story</span>
          {active ? (
            <input
              type="range"
              class="manual-narration-seek"
              min={0}
              max={Math.ceil(length)}
              step={1}
              value={Math.floor(state.value.time)}
              aria-label={`Position in ${title}`}
              aria-valuetext={`${formatTime(state.value.time)} of ${formatTime(length)}`}
              onChange$={(_, el) => seek(Number(el.value))}
            />
          ) : null}
          <span class="manual-narration-duration">
            {active
              ? `${formatTime(state.value.time)} / ${formatTime(length)}`
              : formatTime(length)}
          </span>
          {status === "error" && (
            <a
              href={narrationSrc(chapter)}
              download
              class="manual-narration-download"
            >
              Download
            </a>
          )}
        </div>
        <details class="manual-narration-transcript">
          <summary>Transcript</summary>
          <div class="manual-narration-lines">
            {narration.script.map((line, i) => (
              <button
                type="button"
                key={i}
                class={[
                  "manual-narration-line",
                  { "is-current": active && state.value.segment === i },
                ]}
                aria-current={
                  active && state.value.segment === i ? "true" : undefined
                }
                onClick$={() => seek(generated[chapter]?.segments[i] ?? 0)}
                title="Listen from here"
              >
                {line}
              </button>
            ))}
          </div>
        </details>
      </div>
    );
  },
);
