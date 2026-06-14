import { component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { PersonasPanel } from "../../components/personas/personas-panel";
import type { ProjectBrief } from "../../types";
import { loadProjectBrief } from "../../utils/anti-tabula-rasa";

interface Store {
  brief: ProjectBrief | null;
  hydrated: boolean;
}

/**
 * The full-room view of the editors. The same PersonasPanel that
 * sits in the editor's right rail, but on its own route with a
 * back-link to the desk.
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
        Loading the room…
      </div>
    );
  }

  return (
    <div class="min-h-screen flex flex-col bg-[var(--color-surface)]">
      <header class="h-12 flex items-center justify-between px-4 border-b border-[var(--color-surface-3)] bg-white/90 backdrop-blur-sm">
        <div class="flex items-center gap-3">
          <Link
            href="/editor/"
            class="text-[var(--color-ink-light)] hover:text-[var(--color-ink)] text-sm flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            <span aria-hidden="true">←</span> Back to desk
          </Link>
        </div>
        <p
          class="text-xs tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          Room of Editors
        </p>
        <div class="w-32" />
      </header>

      <div class="flex-1 min-h-0">
        <PersonasPanel brief={store.brief} />
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Room of Editors · Twyne",
  meta: [
    {
      name: "description",
      content:
        "The five editors in residence — The Devil's Advocate, The Patron of Strengths, The Scholar, The Copy Chief, The Target Reader.",
    },
  ],
};
