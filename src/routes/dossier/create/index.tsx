import { component$, $, useSignal, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../../components/onboarding/anti-tabula-rasa";
import { ConversationalInterview } from "../../../components/onboarding/conversational-interview";
import { AuthPanel } from "../../../components/auth/auth-panel";
import { useAuth } from "../../../utils/auth-context";
import type {
  DossierAttachment,
  InterviewStyle,
  ProjectInterviewAnswers,
} from "../../../types";
import {
  buildImportedMaterialDocument,
  buildStarterDocument,
  createProjectBrief,
  loadDraftHtml,
  saveDraftHtml,
  saveProjectBrief,
} from "../../../utils/anti-tabula-rasa";
import { loadWriterSettingsFromIdb } from "../../../utils/idb";

interface OnboardingStore {
  hydrated: boolean;
  style: InterviewStyle;
}

/**
 * The first-run interview. Renders the AntiTabulaRasa component in `first-run`
 * mode, saves the resulting brief to IndexedDB, seeds a starter document if the
 * writer has nothing yet, and then sends the writer to /editor.
 *
 * The "make an account, or just check things out?" choice and the quick
 * settings live one step earlier in /onboarding; this route is the interview
 * itself. Guests still get a (never forced) sign-up offer once the brief lands.
 */
export default component$(() => {
  const nav = useNavigate();
  const auth = useAuth();
  // Once the brief is saved we offer (but never force) sign-up.
  const briefDone = useSignal(false);
  const store = useStore<OnboardingStore>({
    hydrated: false,
    style: "form",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const writer = await loadWriterSettingsFromIdb();
    store.style = writer.interviewStyle;
    store.hydrated = true;
  });

  const completeOnboarding$ = $(
    (
      answers: ProjectInterviewAnswers,
      existingMaterial?: string,
      filename?: string,
      attachments?: DossierAttachment[],
    ) => {
      const brief = createProjectBrief(answers, null, attachments);
      saveProjectBrief(brief);

      if (!loadDraftHtml().trim()) {
        const material = existingMaterial?.trim();
        saveDraftHtml(
          material
            ? buildImportedMaterialDocument(answers, material, filename)
            : buildStarterDocument(answers),
        );
      }

      briefDone.value = true;
    },
  );

  const onCancel$ = $(() => {
    void nav("/");
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

  if (store.style === "conversational") {
    return (
      <ConversationalInterview
        mode="first-run"
        onComplete$={({ answers, attachments }) =>
          completeOnboarding$(answers, undefined, undefined, attachments)
        }
        onCancel$={$(() => {
          store.style = "form";
        })}
        cancelLabel="Use form"
      />
    );
  }

  return (
    <AntiTabulaRasa
      mode="first-run"
      initialAnswers={null}
      onSubmit$={completeOnboarding$}
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
