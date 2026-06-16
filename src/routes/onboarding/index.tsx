import { component$, $, useSignal } from "@builder.io/qwik";
import { useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../components/onboarding/anti-tabula-rasa";
import { AuthPanel } from "../../components/auth/auth-panel";
import { useAuth } from "../../utils/auth-context";
import type { ProjectInterviewAnswers } from "../../types";
import {
  buildStarterDocument,
  createProjectBrief,
  loadDraftHtml,
  saveDraftHtml,
  saveProjectBrief,
} from "../../utils/anti-tabula-rasa";

/**
 * The first-run interview. Renders the AntiTabulaRasa component
 * in `first-run` mode, saves the resulting brief to IndexedDB, seeds
 * a starter document if the writer has nothing yet, and then sends
 * the writer to /editor.
 *
 * Replaces the previous `window.dispatchEvent("twyne:submit-interview")`
 * pattern — that needed the root route to be on the page listening.
 * Now that onboarding is its own route, the callback owns the work.
 */
export default component$(() => {
  const nav = useNavigate();
  const auth = useAuth();
  // Once the brief is saved we offer (but never force) sign-up.
  const briefDone = useSignal(false);

  const onSubmit$ = $((answers: ProjectInterviewAnswers) => {
    const brief = createProjectBrief(answers, null);
    saveProjectBrief(brief);

    if (!loadDraftHtml().trim()) {
      saveDraftHtml(buildStarterDocument(answers));
    }

    briefDone.value = true;
  });

  const onCancel$ = $(() => {
    void nav("/");
  });

  if (briefDone.value) {
    // Already signed in by the time the brief lands → straight to the desk.
    if (auth.value.user) {
      void nav("/editor/");
      return null;
    }
    return (
      <div class="min-h-screen flex items-center justify-center bg-[var(--color-paper)] px-5 py-12">
        <div class="w-full max-w-md">
          <div class="text-center">
            <p
              class="dept-label text-[var(--color-ink-light)]"
              style="font-family: var(--font-typewriter);"
            >
              The dossier is filed
            </p>
            <h1
              class="mt-2 text-[1.6rem] text-[var(--color-ink)]"
              style="font-family: var(--font-display);"
            >
              Keep your work across devices
            </h1>
            <p
              class="mt-2 text-[0.95rem] text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif);"
            >
              Your brief is saved on this device. Sign in to back it up and pick
              up the manuscript anywhere — or head to the desk and do it later.
            </p>
          </div>

          <div class="mt-6 border-2 border-[var(--color-ink)] bg-[var(--color-paper)]">
            <AuthPanel />
          </div>

          <button
            onClick$={$(() => {
              void nav("/editor/");
            })}
            class="mt-5 w-full text-center text-[0.85rem] text-[var(--color-ink-light)] underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            Continue to the editor →
          </button>
        </div>
      </div>
    );
  }

  return (
    <AntiTabulaRasa
      mode="first-run"
      initialAnswers={null}
      onSubmit$={onSubmit$}
      onCancel$={onCancel$}
    />
  );
});

export const head: DocumentHead = {
  title: "Begin the dossier · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Twyne's onboarding interview: the dossier the room will read from as you write.",
    },
  ],
};
