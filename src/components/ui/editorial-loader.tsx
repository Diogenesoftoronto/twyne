import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import type { Persona } from "../../types";
import { editorialWaitLines } from "../../utils/editorial-chatter";

interface EditorialLoaderProps {
  personas: Persona[];
  label: string;
  compact?: boolean;
}

/** A quiet, rotating bit of pressroom theatre for genuinely long waits. */
export const EditorialLoader = component$<EditorialLoaderProps>((props) => {
  const store = useStore({ index: 0 });
  const lines = editorialWaitLines(props.personas);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    if (lines.length < 2) return;
    const timer = window.setInterval(() => {
      store.index = (store.index + 1) % lines.length;
    }, 3200);
    cleanup(() => window.clearInterval(timer));
  });

  return (
    <div
      class={[
        "mx-auto flex max-w-sm flex-col items-center text-center",
        props.compact ? "px-3 py-4" : "px-6 py-10",
      ]}
      role="status"
      aria-live="polite"
    >
      <div class="relative h-10 w-10" aria-hidden="true">
        <span class="absolute inset-0 rounded-full border border-[var(--color-paper-3)]" />
        <span class="absolute inset-1 motion-safe:animate-spin rounded-full border border-transparent border-t-[var(--color-cobalt)]" />
        <span
          class="absolute inset-0 flex items-center justify-center text-lg text-[var(--color-cobalt)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ✦
        </span>
      </div>
      <p
        class="mt-3 text-[0.62rem] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]"
        style={{ fontFamily: "var(--font-typewriter)" }}
      >
        {props.label}
      </p>
      <p
        class="mt-2 min-h-10 text-sm italic leading-5 text-[var(--color-ink-light)]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {lines[store.index % lines.length]}
      </p>
    </div>
  );
});
