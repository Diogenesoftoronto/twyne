import {
  component$,
  $,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@builder.io/qwik";
import { useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../../components/onboarding/anti-tabula-rasa";
import { ConversationalInterview } from "../../../components/onboarding/conversational-interview";
import { DossierTopBar } from "../../../components/onboarding/dossier-top-bar";
import { AuthPanel } from "../../../components/auth/auth-panel";
import { useAuth } from "../../../utils/auth-context";
import type {
  DossierAttachment,
  DossierProbe,
  Folio,
  InterviewStyle,
  ProjectInterviewAnswers,
} from "../../../types";
import {
  buildImportedMaterialDocument,
  buildStarterDocument,
  clearStartingMaterial,
  createProjectBrief,
  loadStartingMaterial,
  saveProjectBriefForFolio,
} from "../../../utils/anti-tabula-rasa";
import {
  loadActiveFolioIdFromIdb,
  loadFolioContentFromIdb,
  loadFoliosFromIdb,
  loadWriterSettingsFromIdb,
  saveActiveFolioIdToIdb,
  saveFolioContentToIdb,
  saveFoliosToIdb,
} from "../../../utils/idb";
import { markDirty } from "../../../utils/convex-sync";

interface OnboardingStore {
  hydrated: boolean;
  style: InterviewStyle;
  formAnswers: Partial<ProjectInterviewAnswers> | null;
  formAttachments: DossierAttachment[];
  folioId: string | null;
  folioName: string;
  initialMaterial: string;
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
    formAnswers: null,
    formAttachments: [],
    folioId: null,
    folioName: "",
    initialMaterial: "",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const [writer, folios, activeFolioId] = await Promise.all([
      loadWriterSettingsFromIdb(),
      loadFoliosFromIdb(),
      loadActiveFolioIdFromIdb(),
    ]);
    store.style = writer.interviewStyle;
    const requestedFolioId = new URLSearchParams(window.location.search).get(
      "folio",
    );
    const folio =
      folios.find((candidate) => candidate.id === requestedFolioId) ??
      folios.find((candidate) => candidate.id === activeFolioId) ??
      null;
    store.folioId = folio?.id ?? null;
    store.folioName = folio?.name ?? "";
    // Pull the manuscript text the refine page stashed when the writer hit
    // "Start over", then clear it so a subsequent ordinary /dossier/create
    // visit doesn't see a stale carry-over.
    store.initialMaterial = loadStartingMaterial();
    clearStartingMaterial();
    store.hydrated = true;
  });

  const completeOnboarding$ = $(
    async (
      answers: ProjectInterviewAnswers,
      existingMaterial?: string,
      filename?: string,
      attachments?: DossierAttachment[],
      probes?: DossierProbe[],
    ) => {
      const brief = createProjectBrief(answers, null, attachments, probes);
      let folioId = store.folioId;
      let folioName = store.folioName;
      if (!folioId) {
        const folio: Folio = {
          id: crypto.randomUUID(),
          name: answers.workingTitle || "Untitled folio",
          type: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const folios = await loadFoliosFromIdb();
        await saveFoliosToIdb([...folios, folio]);
        await saveActiveFolioIdToIdb(folio.id);
        folioId = folio.id;
        folioName = folio.name;
        store.folioId = folio.id;
        store.folioName = folio.name;
      }

      await saveProjectBriefForFolio(folioId, brief);

      const existingDraft = await loadFolioContentFromIdb(folioId);
      if (!existingDraft.trim()) {
        const material = existingMaterial?.trim();
        await saveFolioContentToIdb(
          folioId,
          material
            ? buildImportedMaterialDocument(answers, material, filename)
            : buildStarterDocument(answers),
        );
      }

      await saveActiveFolioIdToIdb(folioId);
      if (folioName && folioName === "Untitled folio") {
        const folios = await loadFoliosFromIdb();
        await saveFoliosToIdb(
          folios.map((folio) =>
            folio.id === folioId
              ? {
                  ...folio,
                  name: answers.workingTitle || folio.name,
                  updatedAt: Date.now(),
                }
              : folio,
          ),
        );
      }
      markDirty();
      briefDone.value = true;
    },
  );

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
              up this folio anywhere, or head to the desk and do it later.
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
      <div class="min-h-screen bg-[var(--color-paper)]">
        <DossierTopBar
          backHref={store.folioId ? "/editor/" : "/"}
          backLabel={store.folioId ? "Back to desk" : "Back home"}
          mode={store.style}
          switchHref=""
          showStartOver={false}
          onSwitch$={$(() => {
            store.style = "form";
          })}
          onStartOver$={$(() => {})}
        />
        <ConversationalInterview
          mode="first-run"
          initialMaterial={store.initialMaterial}
          onComplete$={({ answers, attachments, probes }) =>
            completeOnboarding$(answers, undefined, undefined, attachments, probes)
          }
          onUseForm$={({ answers, attachments }) => {
            store.formAnswers = answers;
            store.formAttachments = attachments;
            store.style = "form";
          }}
        />
      </div>
    );
  }

  return (
    <div class="min-h-screen bg-[var(--color-paper)]">
      <DossierTopBar
        backHref={store.folioId ? "/editor/" : "/"}
        backLabel={store.folioId ? "Back to desk" : "Back home"}
        mode={store.style}
        switchHref=""
        showStartOver={false}
        onSwitch$={$(() => {
          store.style = "conversational";
        })}
        onStartOver$={$(() => {})}
      />
      <AntiTabulaRasa
        mode="first-run"
        initialAnswers={
          store.formAnswers as ProjectInterviewAnswers | null | undefined
        }
        initialAttachments={store.formAttachments}
        initialMaterial={store.initialMaterial}
        onSubmit$={completeOnboarding$}
      />
    </div>
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
