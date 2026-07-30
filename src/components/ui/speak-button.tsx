import { component$, useSignal, useVisibleTask$, $ } from "@builder.io/qwik";
import type { AiProviderType } from "../../types";
import { useConvexClient } from "../../utils/convex-context";
import { speak, speechState, stopSpeech } from "../../utils/speech";

interface SpeakButtonProps {
  /** The prose to read. */
  text: string;
  /** Stable id for this passage, so only one button shows as active. */
  id: string;
  /** Fallback voice name, e.g. a persona's `speechVoice`. */
  voice?: string;
  /** Per-provider voice overrides, e.g. a persona's `speechVoices`. */
  voices?: Partial<Record<AiProviderType, string>>;
  /** Voice direction — a persona's `voice` lore paragraph fits here. */
  instructions?: string;
  /** Who is speaking, for the accessible label. */
  label?: string;
  /** Slightly smaller styling for dense lists. */
  compact?: boolean;
}

/**
 * A play/stop control for reading a passage aloud.
 *
 * Deliberately a single toggle rather than separate play and stop buttons:
 * only one thing can be sounding at a time, so the button that started it is
 * always the right place to look to stop it.
 *
 * Failure is shown as a tooltip and a colour change rather than a notice
 * block — a note that will not read aloud should not push the note itself off
 * the screen, and the writer can always just read it.
 */
export const SpeakButton = component$<SpeakButtonProps>((props) => {
  const clientSig = useConvexClient();
  const status = useSignal<"idle" | "loading" | "playing" | "error">("idle");
  const errorMessage = useSignal("");

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const sync = () => {
      const s = speechState();
      if (s.id === props.id) {
        status.value = s.status;
        errorMessage.value = s.error?.message ?? "";
      } else if (status.value !== "idle") {
        // Another passage took over; this button goes quiet.
        status.value = "idle";
        errorMessage.value = "";
      }
    };
    window.addEventListener("twyne:speech", sync);
    sync();
    cleanup(() => window.removeEventListener("twyne:speech", sync));
  });

  const toggle = $(async () => {
    if (status.value === "playing" || status.value === "loading") {
      stopSpeech();
      return;
    }
    await speak({
      id: props.id,
      text: props.text,
      voice: props.voice,
      voices: props.voices,
      instructions: props.instructions,
      client: clientSig.value ?? null,
    });
  });

  const who = props.label ? ` in ${props.label}'s voice` : "";
  const title =
    status.value === "error"
      ? errorMessage.value || "Could not read this aloud"
      : status.value === "playing"
        ? "Stop reading"
        : `Read aloud${who}`;

  return (
    <button
      onClick$={toggle}
      class={`focus-ring inline-flex items-center justify-center transition-colors ${
        props.compact ? "h-5 w-5" : "h-6 w-6"
      }`}
      style={{
        color:
          status.value === "error"
            ? "var(--color-accent-red)"
            : status.value === "playing"
              ? "var(--color-vermilion)"
              : "var(--color-ink-muted)",
        borderRadius: "2px",
      }}
      title={title}
      aria-label={title}
      aria-pressed={status.value === "playing"}
      disabled={!props.text.trim()}
    >
      {status.value === "loading" ? (
        <span
          class="animate-pulse text-[0.7rem] leading-none"
          aria-hidden="true"
          style="font-family: var(--font-display);"
        >
          ✦
        </span>
      ) : status.value === "playing" ? (
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
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" stroke-linecap="round" />
          <path d="M18.5 6a8 8 0 0 1 0 12" stroke-linecap="round" />
        </svg>
      )}
    </button>
  );
});
