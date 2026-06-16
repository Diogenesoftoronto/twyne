import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { useNavigate } from "@builder.io/qwik-city";
import { LandingPage } from "../components/landing/landing-page";
import type { Folio } from "../types";
import { loadProjectBrief } from "../utils/anti-tabula-rasa";
import {
  loadFoliosFromIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
} from "../utils/idb";

/**
 * The landing page. Twyne-style: a magazine broadsheet the writer
 * unfolds before the first interview. Returning writers (already
 * filed a brief) skip past it to the desk; first-time writers
 * unfold the page and "Open a Dossier" sends them to /onboarding.
 */
export default component$(() => {
  const nav = useNavigate();
  const store = useStore<{ checked: boolean; hasBrief: boolean }>({
    checked: false,
    hasBrief: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const brief = loadProjectBrief();
    store.hasBrief = brief !== null;
    store.checked = true;
    if (brief) {
      window.location.replace("/editor/");
    }
  });

  const startBrief = $(() => {
    void nav("/onboarding/");
  });

  const skipToEditor = $(async () => {
    // Going straight to the desk without an interview: make sure there's a
    // folio to write into so /editor doesn't bounce back to onboarding.
    const folios = await loadFoliosFromIdb();
    if (folios.length === 0) {
      const folio: Folio = {
        id: crypto.randomUUID(),
        name: "Current draft",
        type: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveFoliosToIdb([folio]);
      await saveActiveFolioIdToIdb(folio.id);
    }
    void nav("/editor/");
  });

  return (
    <main class="paper-fade-in">
      {store.checked && !store.hasBrief && (
        <LandingPage
          onStartBrief$={startBrief}
          onSkipToEditor$={skipToEditor}
        />
      )}
      {store.checked && store.hasBrief && (
        <div class="min-h-screen flex items-center justify-center bg-[var(--color-paper)] text-[var(--color-ink-muted)]">
          <p
            class="text-sm tracking-[0.24em] uppercase"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Returning you to the desk…
          </p>
        </div>
      )}
      {!store.checked && (
        <div class="min-h-screen flex items-center justify-center bg-[var(--color-paper)] text-[var(--color-ink-muted)]">
          <p
            class="text-xs tracking-[0.32em] uppercase"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Unfolding the broadsheet…
          </p>
        </div>
      )}
    </main>
  );
});

export const head: DocumentHead = {
  title: "Twyne — An Editorial Room for Writers",
  meta: [
    {
      name: "description",
      content:
        "Twyne is an anti-tabula-rasa writing workspace. Start with an interview; a room of editors reads from the brief you build.",
    },
    {
      property: "og:title",
      content: "Twyne — The Writer's Room",
    },
    {
      property: "og:description",
      content:
        "Write with a room full of editors. Twyne starts with an interview, a seeded brief, citation detection, and structured feedback.",
    },
  ],
};
