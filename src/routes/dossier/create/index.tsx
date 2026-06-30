import {
  component$,
  $,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@builder.io/qwik";
import { Link, useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../../components/onboarding/anti-tabula-rasa";
import { ConversationalInterview } from "../../../components/onboarding/conversational-interview";
import { AuthPanel } from "../../../components/auth/auth-panel";
import { useAuth } from "../../../utils/auth-context";
import type {
  ApparatusCitationStyle,
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
import {
  loadAiSettingsFromIdb,
  loadApparatusSettingsFromIdb,
  loadWriterSettingsFromIdb,
  saveAiSettingsToIdb,
  saveApparatusSettingsToIdb,
  saveWriterSettingsToIdb,
} from "../../../utils/idb";
import { normalizeAiSettings } from "../../../utils/ai-client";

type OnboardingPhase = "setup" | "interview";

interface OnboardingStore {
  hydrated: boolean;
  phase: OnboardingPhase;
  style: InterviewStyle;
  citationStyle: ApparatusCitationStyle;
  byok: boolean;
}

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
  const store = useStore<OnboardingStore>({
    hydrated: false,
    phase: "setup",
    style: "form",
    citationStyle: "mla",
    byok: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const [writer, apparatus, ai] = await Promise.all([
      loadWriterSettingsFromIdb(),
      loadApparatusSettingsFromIdb(),
      loadAiSettingsFromIdb(),
    ]);
    store.style = writer.interviewStyle;
    store.citationStyle = apparatus.defaultCitationStyle;
    store.byok = normalizeAiSettings(ai).advancedMode;
    store.hydrated = true;
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

  if (store.phase === "setup") {
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
              A few quick settings
            </h1>
            <p
              class="mt-2 text-[0.95rem] text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif);"
            >
              Defaults are fine — change any of this later in Preferences.
            </p>
          </div>

          <div class="folio mt-6 p-5">
            <h2
              class="text-sm font-semibold text-[var(--color-ink)]"
              style="font-family: var(--font-display);"
            >
              Interview style
            </h2>
            <div class="mt-3 grid sm:grid-cols-2 gap-3">
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
                    class="text-[0.7rem] text-[var(--color-ink-muted)] mt-1"
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
            <div class="flex items-center justify-between">
              <div>
                <h2
                  class="text-sm font-semibold text-[var(--color-ink)]"
                  style="font-family: var(--font-display);"
                >
                  Bring your own key
                </h2>
                <p
                  class="text-[0.7rem] text-[var(--color-ink-muted)] mt-1"
                  style="font-family: var(--font-typewriter);"
                >
                  Use your own AI provider instead of the shared server.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={store.byok}
                onClick$={() => void setByok$(!store.byok)}
                class={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  store.byok ? "bg-[var(--color-vermilion)]" : "bg-[var(--color-paper-3)]"
                }`}
              >
                <span
                  class={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    store.byok ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <Link
              href="/settings/"
              class="mt-3 inline-block text-[0.8rem] text-[var(--color-ink-light)] underline decoration-[var(--color-vermilion)] decoration-1 underline-offset-4 hover:text-[var(--color-ink)] focus-ring"
              style="font-family: var(--font-typewriter);"
            >
              Configure AI providers &amp; Apparatus in full →
            </Link>
          </div>

          <button
            onClick$={() => {
              store.phase = "interview";
            }}
            class="btn-press mt-6 w-full"
          >
            Begin
          </button>
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
