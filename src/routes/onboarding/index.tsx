import { component$, $, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { Link, useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AuthPanel } from "../../components/auth/auth-panel";
import { loadProjectBrief } from "../../utils/anti-tabula-rasa";
import { useAuth } from "../../utils/auth-context";
import type { ApparatusCitationStyle, InterviewStyle } from "../../types";
import {
  loadAiSettingsFromIdb,
  loadApparatusSettingsFromIdb,
  loadWriterSettingsFromIdb,
  saveAiSettingsToIdb,
  saveApparatusSettingsToIdb,
  saveWriterSettingsToIdb,
} from "../../utils/idb";
import { normalizeAiSettings } from "../../utils/ai-client";

/**
 * First-run onboarding for writers arriving from the landing page.
 *
 *   choice  — "Want to make an account, or just check things out?" Either path
 *             continues into the room; an account is offered, never required.
 *             Signed-in writers skip this and land on setup.
 *   account — optional sign in / sign up, then back to setup.
 *   setup   — a deliberately small step. The only *basic* setting is "bring
 *             your own key", and it shows up only for unauthenticated,
 *             local-first writers (signed-in writers use the shared server, so
 *             there is nothing to ask). Everything else (interview style,
 *             citation style, full provider/apparatus config) is tucked behind
 *             a "more detail" button so the default path stays minimal.
 *
 * "Begin" hands off to /dossier/create — the interview itself.
 *
 * This route exists so the unauthenticated "Start your brief" CTA has a real
 * place to land: a bare /onboarding path would otherwise be swallowed by the
 * /[handle] profile route ("No writer by that handle.").
 */
type OnboardingPhase = "choice" | "account" | "setup";

interface OnboardingStore {
  hydrated: boolean;
  phase: OnboardingPhase;
  /** Whether the optional "more detail" settings are expanded. */
  showMore: boolean;
  style: InterviewStyle;
  citationStyle: ApparatusCitationStyle;
  byok: boolean;
}

export default component$(() => {
  const auth = useAuth();
  const nav = useNavigate();
  const store = useStore<OnboardingStore>({
    hydrated: false,
    phase: "choice",
    showMore: false,
    style: "form",
    citationStyle: "mla",
    byok: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    const loading = track(() => auth.value.loading);
    const userId = track(() => auth.value.user?.id);
    if (loading) return;

    // Already filed a brief → the writer belongs at the desk, not here.
    if (loadProjectBrief()) {
      void nav("/editor/");
      return;
    }

    const [writer, apparatus, ai] = await Promise.all([
      loadWriterSettingsFromIdb(),
      loadApparatusSettingsFromIdb(),
      loadAiSettingsFromIdb(),
    ]);
    store.style = writer.interviewStyle;
    store.citationStyle = apparatus.defaultCitationStyle;
    store.byok = normalizeAiSettings(ai).advancedMode;

    // Signed-in writers (including anyone who just created an account on the
    // account step) don't need the "make an account?" choice — send them to
    // setup. Only while still on the choice/account phases so we never yank a
    // guest out of a step they're already on.
    if (userId && (store.phase === "choice" || store.phase === "account")) {
      store.phase = "setup";
    }

    store.hydrated = true;
  });

  const goToAccount$ = $(() => {
    store.phase = "account";
  });

  const goToSetup$ = $(() => {
    store.phase = "setup";
  });

  const backToChoice$ = $(() => {
    store.phase = "choice";
  });

  const toggleMore$ = $(() => {
    store.showMore = !store.showMore;
  });

  const setInterviewStyle$ = $(async (style: InterviewStyle) => {
    store.style = style;
    await saveWriterSettingsToIdb({ interviewStyle: style });
  });

  const setCitationStyle$ = $(async (style: ApparatusCitationStyle) => {
    store.citationStyle = style;
    const current = await loadApparatusSettingsFromIdb();
    await saveApparatusSettingsToIdb({
      ...current,
      defaultCitationStyle: style,
    });
  });

  const setByok$ = $(async (enabled: boolean) => {
    store.byok = enabled;
    const current = normalizeAiSettings(await loadAiSettingsFromIdb());
    await saveAiSettingsToIdb({ ...current, advancedMode: enabled });
  });

  if (!store.hydrated) {
    return (
      <div class="flex h-screen items-center justify-center bg-[var(--color-paper)] text-[var(--color-ink-muted)]">
        <div class="rounded-[3px] border border-[var(--color-paper-3)] bg-[var(--color-paper-2)] px-5 py-4 shadow-sm">
          Loading the room…
        </div>
      </div>
    );
  }

  // ── Choice — make an account, or just check things out? ──────
  if (store.phase === "choice") {
    return (
      <div class="min-h-screen flex items-center justify-center bg-[var(--color-paper)] px-5 py-12">
        <div class="w-full max-w-lg text-center">
          <p
            class="dept-label text-[var(--color-ink-light)]"
            style="font-family: var(--font-typewriter);"
          >
            Welcome to the room
          </p>
          <h1
            class="mt-2 text-[1.8rem] text-[var(--color-ink)]"
            style="font-family: var(--font-display);"
          >
            Want to make an account, or just check things out?
          </h1>
          <p
            class="mt-3 text-[0.95rem] text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif);"
          >
            Twyne is local-first: your brief and drafts live in this browser, no
            account needed. Sign in any time to back them up and write across
            devices — you can always do it later.
          </p>

          <div class="mt-8 grid gap-3 sm:grid-cols-2">
            <button
              onClick$={goToAccount$}
              class="btn-press w-full"
              type="button"
            >
              Make an account
            </button>
            <button
              onClick$={goToSetup$}
              class="btn-paper w-full"
              type="button"
            >
              Just check things out
            </button>
          </div>

          <p
            class="mt-5 text-[0.8rem] text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            Already have an account?{" "}
            <button
              type="button"
              onClick$={goToAccount$}
              class="text-[var(--color-vermilion)] underline decoration-1 underline-offset-4 hover:text-[var(--color-ink)] focus-ring"
              style="font-family: var(--font-typewriter);"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ── Account — optional sign in / sign up ─────────────────────
  if (store.phase === "account") {
    return (
      <div class="min-h-screen flex items-center justify-center bg-[var(--color-paper)] px-5 py-12">
        <div class="w-full max-w-md">
          <div class="text-center">
            <p
              class="dept-label text-[var(--color-ink-light)]"
              style="font-family: var(--font-typewriter);"
            >
              The Editor's Office
            </p>
            <h1
              class="mt-2 text-[1.6rem] text-[var(--color-ink)]"
              style="font-family: var(--font-display);"
            >
              Sign in or open an account
            </h1>
            <p
              class="mt-2 text-[0.95rem] text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif);"
            >
              We'll bring you back to set up your first dossier once you're in.
            </p>
          </div>

          <div class="mt-6 border-2 border-[var(--color-ink)] bg-[var(--color-paper)]">
            <AuthPanel />
          </div>

          <button
            onClick$={goToSetup$}
            type="button"
            class="mt-5 w-full text-center text-[0.85rem] text-[var(--color-ink-light)] underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            Skip — just check things out →
          </button>
          <button
            onClick$={backToChoice$}
            type="button"
            class="mt-2 w-full text-center text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── Setup — minimal by default ───────────────────────────────
  // The only basic setting is BYOK, and only for local-first (unauthenticated)
  // writers. Everything else is optional, behind "more detail".
  const isLocalFirst = !auth.value.user;
  return (
    <div class="min-h-screen flex items-center justify-center bg-[var(--color-paper)] px-5 py-12">
      <div class="w-full max-w-lg">
        <div class="text-center">
          <p
            class="dept-label text-[var(--color-ink-light)]"
            style="font-family: var(--font-typewriter);"
          >
            Before we begin
          </p>
          <h1
            class="mt-2 text-[1.6rem] text-[var(--color-ink)]"
            style="font-family: var(--font-display);"
          >
            You're all set
          </h1>
          <p
            class="mt-2 text-[0.95rem] text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif);"
          >
            Defaults are fine — you can change everything later in Preferences.
          </p>
        </div>

        {/* Basic setting: BYOK, local-first writers only. */}
        {isLocalFirst && (
          <div class="folio mt-6 p-5">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2
                  class="text-sm font-semibold text-[var(--color-ink)]"
                  style="font-family: var(--font-display);"
                >
                  Bring your own key
                </h2>
                <p
                  class="mt-1 text-[0.7rem] text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Use your own AI provider instead of the shared server. Your
                  keys stay in this browser.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={store.byok}
                aria-label="Bring your own key"
                onClick$={() => void setByok$(!store.byok)}
                class={`inline-flex h-7 w-12 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                  store.byok
                    ? "justify-end bg-[var(--color-vermilion)]"
                    : "justify-start bg-[var(--color-paper-3)]"
                }`}
              >
                <span class="block h-6 w-6 rounded-full bg-white shadow-sm" />
              </button>
            </div>
          </div>
        )}

        {/* Optional path: "more detail" reveals the fuller settings. */}
        <button
          type="button"
          onClick$={toggleMore$}
          aria-expanded={store.showMore}
          aria-controls="onboarding-more-detail"
          class="mt-4 flex w-full items-center justify-between rounded-[3px] border border-[var(--color-paper-3)] px-4 py-3 text-left transition-colors hover:border-[var(--color-ink-muted)] focus-ring"
        >
          <span>
            <span
              class="block text-sm font-semibold text-[var(--color-ink)]"
              style="font-family: var(--font-display);"
            >
              More detail
            </span>
            <span
              class="mt-0.5 block text-[0.7rem] text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              Interview style, citation style, and full provider settings.
            </span>
          </span>
          <span
            class="ml-3 text-[var(--color-ink-muted)] transition-transform"
            style={{
              transform: store.showMore ? "rotate(180deg)" : "rotate(0deg)",
            }}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>

        {store.showMore && (
          <div id="onboarding-more-detail">
            <div class="folio mt-4 p-5">
              <h2
                class="text-sm font-semibold text-[var(--color-ink)]"
                style="font-family: var(--font-display);"
              >
                Interview style
              </h2>
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                {(["form", "conversational"] as const).map((style) => (
                  <button
                    key={style}
                    onClick$={() => void setInterviewStyle$(style)}
                    class={`text-left rounded-[3px] border p-3 transition-colors ${
                      store.style === style
                        ? "border-[var(--color-vermilion)] bg-[var(--color-vermilion)]/5"
                        : "border-[var(--color-paper-3)] hover:border-[var(--color-ink-muted)]"
                    }`}
                  >
                    <p
                      class="text-sm font-semibold"
                      style="font-family: var(--font-display);"
                    >
                      {style === "form" ? "Form" : "Conversation"}
                    </p>
                    <p
                      class="mt-1 text-[0.7rem] text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      {style === "form"
                        ? "Eight fixed fields. Fast."
                        : "The room interviews you, one question at a time."}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div class="folio mt-4 p-5">
              <h2
                class="text-sm font-semibold text-[var(--color-ink)]"
                style="font-family: var(--font-display);"
              >
                Default citation style
              </h2>
              <div class="mt-3 flex gap-2">
                {(["mla", "apa", "chicago"] as const).map((style) => (
                  <button
                    key={style}
                    onClick$={() => void setCitationStyle$(style)}
                    class={`flex-1 rounded-[3px] border py-1.5 text-sm uppercase ${
                      store.citationStyle === style
                        ? "border-[var(--color-vermilion)] bg-[var(--color-vermilion)]/5"
                        : "border-[var(--color-paper-3)] hover:border-[var(--color-ink-muted)]"
                    }`}
                    style="font-family: var(--font-typewriter);"
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div class="folio mt-4 p-5">
              <Link
                href="/settings/"
                class="inline-block text-[0.8rem] text-[var(--color-ink-light)] underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)] focus-ring"
                style="font-family: var(--font-typewriter);"
              >
                Configure AI providers &amp; Apparatus in full →
              </Link>
            </div>
          </div>
        )}

        <button
          onClick$={() => {
            void nav("/dossier/create/");
          }}
          class="btn-press mt-6 w-full"
        >
          Begin
        </button>

        {isLocalFirst && (
          <button
            onClick$={goToAccount$}
            type="button"
            class="mt-3 w-full text-center text-[0.8rem] text-[var(--color-ink-light)] underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            Actually, let me make an account first →
          </button>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Onboarding · Twyne",
  meta: [
    {
      name: "description",
      content:
        "First-time onboarding before opening a new dossier in Twyne.",
    },
  ],
};
