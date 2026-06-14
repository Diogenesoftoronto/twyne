import { component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { RubricPanel } from "../../components/rubric/rubric-panel";
import type { ProjectBrief } from "../../types";
import { loadProjectBrief } from "../../utils/anti-tabula-rasa";

interface Store {
  brief: ProjectBrief | null;
  hydrated: boolean;
}

/**
 * The galley proof — the rubric the room grades the draft against.
 * Full-page version of the rubric panel that lives in the editor's
 * right rail.
 */
export default component$(() => {
  const store = useStore<Store>({ brief: null, hydrated: false });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    store.brief = loadProjectBrief();
    store.hydrated = true;
  });

  if (!store.hydrated) {
    return (
      <div class="flex h-screen items-center justify-center bg-[var(--color-surface)] text-[var(--color-ink-muted)]">
        Loading the galley…
      </div>
    );
  }

  return (
    <div class="min-h-screen flex flex-col bg-[var(--color-surface)]">
      <header class="h-12 flex items-center justify-between px-4 border-b border-[var(--color-surface-3)] bg-white/90 backdrop-blur-sm">
        <Link
          href="/editor/"
          class="text-[var(--color-ink-light)] hover:text-[var(--color-ink)] text-sm flex items-center gap-1.5"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          <span aria-hidden="true">←</span> Back to desk
        </Link>
        <p
          class="text-xs tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          Galley Proof
        </p>
        <div class="w-32" />
      </header>

      <div class="flex-1 min-h-0">
        <RubricPanel brief={store.brief} />
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Galley Proof · Twyne",
  meta: [
    {
      name: "description",
      content:
        "The brutal-curve rubric the room uses to grade the draft: intention, evidence, voice, structure, and reader-fit.",
    },
  ],
};
