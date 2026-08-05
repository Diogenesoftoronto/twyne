import { component$, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { useNavigate } from "@builder.io/qwik-city";
import { LandingPage } from "../components/landing/landing-page";
import type { Folio } from "../types";
import { useAuth } from "../utils/auth-context";
import {
  loadFoliosFromIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
} from "../utils/idb";
import {
  captureProductEvent,
  type LandingCtaLocation,
} from "../utils/product-analytics";

/**
 * The landing page. Twyne-style: a magazine broadsheet the writer
 * unfolds before the first interview. Nobody is redirected off it:
 * "Start your brief" sends first-time local writers to /onboarding and
 * signed-in writers to /dossier/create, and returning writers take the
 * header link to the desk when they want it.
 */
export default component$(() => {
  const nav = useNavigate();
  const auth = useAuth();

  // The front page stays the front page. Returning writers used to be bounced
  // straight to /editor the moment a brief existed, which made the landing
  // page — and every link on it — unreachable for anyone who had ever written
  // anything. The desk is one click away in the header instead.

  const startBrief = $((location: LandingCtaLocation) => {
    const signedIn = Boolean(auth.value.user);
    void captureProductEvent("landing_cta_clicked", {
      location,
      destination: signedIn ? "dossier" : "onboarding",
    });
    void nav(signedIn ? "/dossier/create/" : "/onboarding/");
  });

  const skipToEditor = $(async (location: LandingCtaLocation) => {
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
      void captureProductEvent("folio_created", {
        source: "landing",
        folio_type: folio.type,
      });
    }
    void captureProductEvent("landing_cta_clicked", {
      location,
      destination: "editor",
    });
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
