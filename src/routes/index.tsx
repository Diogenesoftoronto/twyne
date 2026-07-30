import { component$, useVisibleTask$, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { useNavigate } from "@builder.io/qwik-city";
import { LandingPage } from "../components/landing/landing-page";
import type { Folio } from "../types";
import { loadProjectBrief } from "../utils/anti-tabula-rasa";
import { useAuth } from "../utils/auth-context";
import {
  loadFoliosFromIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
} from "../utils/idb";

/**
 * The landing page. Twyne-style: a magazine broadsheet the writer
 * unfolds before the first interview. Returning writers (already
 * filed a brief) skip past it to the desk; first-time local writers
 * unfold the page and "Start your brief" sends them to /onboarding,
 * while signed-in writers can jump straight to /dossier/create.
 */
export default component$(() => {
  const nav = useNavigate();
  const auth = useAuth();

  // The landing paints immediately — the redirect decision is a synchronous
  // localStorage read that doesn't need the auth check, so we don't gate the
  // first paint on it. Returning writers (with a filed brief) are bounced to
  // the desk as soon as the document is ready; first-time visitors just stay.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    () => {
      if (loadProjectBrief()) {
        window.location.replace("/editor/");
      }
    },
    { strategy: "document-ready" },
  );

  const startBrief = $(() => {
    void nav(auth.value.user ? "/dossier/create/" : "/onboarding/");
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
      <LandingPage onStartBrief$={startBrief} onSkipToEditor$={skipToEditor} />
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
