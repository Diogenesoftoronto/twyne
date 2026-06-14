import { component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { loadProjectBrief } from "../utils/anti-tabula-rasa";

interface LandingStore {
  checked: boolean;
  hasBrief: boolean;
}

/**
 * The landing page. Two behaviours:
 *
 *   1. **Returning writer** (a brief already exists in IndexedDB) —
 *      bounce straight to /editor. We use `window.location.replace`
 *      rather than `<Link>` navigation so the landing URL doesn't
 *      pollute the browser's history stack.
 *
 *   2. **First-time writer** (no brief) — show the marketing copy
 *      with a single "Begin the dossier" CTA that goes to /onboarding.
 *
 * The IDB check runs in `useVisibleTask$` so it only fires in the
 * browser. The server-rendered first paint is the same in both cases
 * (the empty landing card); after hydration we either redirect or
 * reveal the CTA. One frame of flicker at worst.
 */
export default component$(() => {
  const store = useStore<LandingStore>({
    checked: false,
    hasBrief: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const brief = loadProjectBrief();
    store.hasBrief = brief !== null;
    store.checked = true;
    if (brief) {
      // Returning writer — skip the landing entirely.
      window.location.replace("/editor/");
    }
  });

  return (
    <div
      class="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-[var(--color-surface)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-2xl w-full text-center space-y-10">
        <p
          class="text-xs tracking-[0.32em] uppercase text-[var(--color-ink-muted)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          Twyne — The Writer's Room
        </p>

        <h1
          class="text-5xl md:text-6xl leading-[1.05] tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
        >
          Begin with a{" "}
          <em class="text-[var(--color-vermilion)] not-italic">dossier,</em>
          <br />
          not a blank page.
        </h1>

        <p
          class="text-lg md:text-xl leading-relaxed text-[var(--color-ink-light)] max-w-xl mx-auto"
        >
          Before the first paragraph, the room interviews the project: what it
          is, who it is for, what it must do, and what we promise to protect.
          The brief becomes the spine — every editor reads from it.
        </p>

        <div class="pt-4 min-h-[3.5rem] flex items-center justify-center">
          {store.checked && !store.hasBrief && (
            <a
              href="/onboarding/"
              class="inline-flex items-center gap-2 rounded-full bg-[var(--color-vermilion)] text-white px-6 py-3 text-sm font-semibold tracking-wide shadow-sm hover:opacity-90 transition-opacity"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Begin the dossier
              <span aria-hidden="true">→</span>
            </a>
          )}
          {store.checked && store.hasBrief && (
            <p
              class="text-sm text-[var(--color-ink-muted)] italic"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Returning you to the desk…
            </p>
          )}
          {!store.checked && (
            <span
              class="text-xs text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Checking the desk…
            </span>
          )}
        </div>

        <div
          class="pt-12 mt-12 border-t border-[var(--color-surface-3)] flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[0.7rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          <a href="/library/" class="hover:text-[var(--color-ink)]">
            Library
          </a>
          <span aria-hidden="true">·</span>
          <a href="/personas/" class="hover:text-[var(--color-ink)]">
            Editors
          </a>
          <span aria-hidden="true">·</span>
          <a href="/apparatus/" class="hover:text-[var(--color-ink)]">
            Apparatus
          </a>
          <span aria-hidden="true">·</span>
          <a href="/rubric/" class="hover:text-[var(--color-ink)]">
            Galley Proof
          </a>
          <span aria-hidden="true">·</span>
          <a href="/settings/" class="hover:text-[var(--color-ink)]">
            Settings
          </a>
        </div>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Twyne — Begin with a dossier, not a blank page",
  meta: [
    {
      name: "description",
      content:
        "Twyne is an anti-tabula-rasa writing workspace. Start with an interview; a room of editors reads from the brief you build.",
    },
    {
      name: "og:title",
      content: "Twyne — The Writer's Room",
    },
    {
      name: "og:description",
      content:
        "Write with a room full of editors. Twyne starts with an interview, a seeded brief, citation detection, and structured feedback.",
    },
  ],
};
