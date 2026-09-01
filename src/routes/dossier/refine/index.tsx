import { component$, useStore, useVisibleTask$, $ } from "@qwik.dev/core";
import { useNavigate, Link } from "@qwik.dev/router";
import type { DocumentHead } from "@qwik.dev/router";
import { AntiTabulaRasa } from "../../../components/onboarding/anti-tabula-rasa";
import { ConversationalInterview } from "../../../components/onboarding/conversational-interview";
import { ThemedDialog } from "../../../components/ui/themed-dialog";
import { useConvexClient } from "../../../utils/convex-context";
import { useAuth } from "../../../utils/auth-context";
import { api } from "../../../../convex/_generated/api";
import type {
  DossierAttachment,
  DossierProbe,
  DossierCheckResult,
  InterviewStyle,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../../../types";
import {
  hasConfiguredAiProvider,
  runClientDossierCheck,
} from "../../../utils/ai-client";
import {
  loadActiveFolioIdFromIdb,
  loadAiSettingsFromIdb,
  loadFolioContentFromIdb,
  loadWriterSettingsFromIdb,
} from "../../../utils/idb";
import {
  createProjectBrief,
  htmlToPlainText,
  loadDraftHtml,
  loadProjectBriefForFolio,
  saveProjectBriefForFolio,
  saveStartingMaterial,
} from "../../../utils/anti-tabula-rasa";
import { captureProductEvent } from "../../../utils/product-analytics";
import { dossierRouteClass } from "../../../utils/conversation-layout";
import { normalizeApplicationError } from "../../../utils/application-errors";
import {
  dossierCheckUnavailableMessage,
  runDossierCheckWithHostedFallback,
} from "../../../utils/dossier-check";
import {
  waitForDossierFiledFeedback,
  type DossierFilingState,
} from "../../../utils/dossier-filing";

interface RefiningStore {
  brief: ProjectBrief | null;
  draftText: string;
  hydrated: boolean;
  style: InterviewStyle;
  dossierCheck: DossierCheckResult | null;
  dossierCheckLoading: boolean;
  dossierCheckError: string | null;
  formAnswers: Partial<ProjectInterviewAnswers> | null;
  formAttachments: DossierAttachment[];
  folioId: string | null;
  startOverOpen: boolean;
  startOverBusy: boolean;
  filingState: DossierFilingState;
}

/**
 * The brief refinery. Two modes:
 *   - **form** (default) — the existing AntiTabulaRasa with pre-filled answers.
 *   - **conversational** — chat with the AI about which fields have drifted.
 * Draft alignment is part of the live dossier preview: the room compares the
 * current manuscript with all seven fields, and the writer applies or dismisses
 * each proposed change in place.
 */
export default component$(() => {
  const nav = useNavigate();
  const auth = useAuth();
  const clientSig = useConvexClient();
  const store = useStore<RefiningStore>({
    brief: null,
    draftText: "",
    hydrated: false,
    style: "form",
    dossierCheck: null,
    dossierCheckLoading: false,
    dossierCheckError: null,
    formAnswers: null,
    formAttachments: [],
    folioId: null,
    startOverOpen: false,
    startOverBusy: false,
    filingState: "idle",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const activeFolioId = await loadActiveFolioIdFromIdb();
    const requestedFolioId = new URLSearchParams(window.location.search).get(
      "folio",
    );
    store.folioId = requestedFolioId ?? activeFolioId;
    store.brief = await loadProjectBriefForFolio(store.folioId);
    store.draftText = store.folioId
      ? await loadFolioContentFromIdb(store.folioId)
      : await loadDraftHtml();
    const writer = await loadWriterSettingsFromIdb();
    store.style = writer.interviewStyle;
    store.hydrated = true;
  });

  const onFormSubmit = $(
    async (
      answers: ProjectInterviewAnswers,
      _existing?: string,
      _filename?: string,
      attachments?: DossierAttachment[],
      probes?: DossierProbe[],
    ) => {
      if (!store.brief || !store.folioId) return;
      store.filingState = "filing";
      try {
        const next = createProjectBrief(
          answers,
          store.brief,
          attachments,
          probes,
        );
        await saveProjectBriefForFolio(store.folioId, next);
        store.brief = next;
        void captureProductEvent("dossier_completed", { mode: "refine" });
        store.filingState = "filed";
        await waitForDossierFiledFeedback();
        await nav("/editor/");
      } catch (error) {
        store.filingState = "idle";
        throw error;
      }
    },
  );

  const onConversationComplete = $(
    async ({
      answers,
      attachments,
      probes,
    }: {
      answers: ProjectInterviewAnswers;
      attachments: DossierAttachment[];
      probes: DossierProbe[];
    }) => {
      if (!store.brief || !store.folioId) return;
      store.filingState = "filing";
      try {
        const next = createProjectBrief(
          answers,
          store.brief,
          attachments,
          probes,
        );
        await saveProjectBriefForFolio(store.folioId, next);
        store.brief = next;
        void captureProductEvent("dossier_completed", { mode: "refine" });
        store.filingState = "filed";
        await waitForDossierFiledFeedback();
        await nav("/editor/");
      } catch (error) {
        store.filingState = "idle";
        throw error;
      }
    },
  );

  const runDossierCheck = $(async (answers: ProjectInterviewAnswers) => {
    if (!store.brief) return;
    const draftText = htmlToPlainText(store.draftText).trim();
    if (!draftText) {
      store.dossierCheck = null;
      store.dossierCheckError =
        "There is no manuscript text to compare yet. Add some draft material, then try again.";
      return;
    }
    store.dossierCheckLoading = true;
    store.dossierCheckError = null;
    store.dossierCheck = null;
    try {
      const raw = await loadAiSettingsFromIdb();
      const settings = raw ?? {
        advancedMode: false,
        providers: [],
        defaultProviderId: null,
        perFeature: {},
        showProviderTags: false,
      };
      const currentBrief: ProjectBrief = {
        ...store.brief,
        answers,
        updatedAt: Date.now(),
      };
      const hasConfiguredProvider = hasConfiguredAiProvider(settings);
      const hostedClient = auth.value.user ? clientSig.value : null;
      const result = await runDossierCheckWithHostedFallback({
        runClient: hasConfiguredProvider
          ? () =>
              runClientDossierCheck(
                { brief: currentBrief, draftText },
                settings,
              )
          : null,
        runHosted: hostedClient
          ? () =>
              hostedClient.action(api.agents.runDossierCheck, {
                brief: currentBrief,
                draftText,
              })
          : null,
      });
      if (!result) {
        store.dossierCheckError = dossierCheckUnavailableMessage(
          hasConfiguredProvider,
        );
        return;
      }
      store.dossierCheck = result;
    } catch (err) {
      store.dossierCheckError = normalizeApplicationError(err, {
        metadata: { feature: "dossier-check" },
      }).message;
    } finally {
      store.dossierCheckLoading = false;
    }
  });

  const applyObservation = $(
    async (index: number, answers: ProjectInterviewAnswers) => {
      if (!store.brief || !store.folioId) return;
      const observation = store.dossierCheck?.observations[index];
      if (!observation?.suggested) return;
      const remaining =
        store.dossierCheck?.observations.filter(
          (_, observationIndex) => observationIndex !== index,
        ) ?? [];
      const next: ProjectBrief = {
        ...store.brief,
        answers,
        updatedAt: Date.now(),
      };
      await saveProjectBriefForFolio(store.folioId, next);
      store.brief = next;
      store.formAnswers = answers;
      if (store.dossierCheck) {
        store.dossierCheck = {
          ...store.dossierCheck,
          observations: remaining,
        };
      }
    },
  );

  const dismissObservation = $((index: number) => {
    if (!store.dossierCheck) return;
    store.dossierCheck = {
      ...store.dossierCheck,
      observations: store.dossierCheck.observations.filter(
        (_, observationIndex) => observationIndex !== index,
      ),
    };
  });

  // The "Start over" affordance is the only destructive action on this page,
  // so it sits in its own confirm dialog rather than alongside the other top
  // bar buttons. Confirming wipes the dossier's answers (the brief row stays
  // so we don't orphan attachments and notes), stashes the existing manuscript
  // text as the next interview's starting material, and routes to /dossier/
  // create so the writer re-files from a blank slate without losing their draft.
  const confirmStartOver = $(async () => {
    if (!store.brief || !store.folioId) return;
    store.startOverBusy = true;
    try {
      const blank: ProjectInterviewAnswers = {
        workingTitle: "",
        format: "",
        audience: "",
        goal: "",
        tone: "",
        constraints: "",
        successSignal: "",
      };
      const next = createProjectBrief(blank, null, [], []);
      await saveProjectBriefForFolio(store.folioId, next);
      // `store.draftText` is the folio body as HTML (the guard above
      // guarantees a folio). Strip to prose before carrying it across — the
      // form's existing-material textarea and the AI prompt both want text,
      // not markup. `htmlToPlainText` is idempotent on already-plain input.
      const plain = htmlToPlainText(store.draftText).trim();
      if (plain) saveStartingMaterial(plain);
      store.brief = next;
      store.formAnswers = null;
      store.formAttachments = [];
      const query = `?folio=${encodeURIComponent(store.folioId)}`;
      void nav(`/dossier/create/${query}`);
    } finally {
      store.startOverBusy = false;
      store.startOverOpen = false;
    }
  });

  if (!store.hydrated) {
    return (
      <div class="flex h-screen items-center justify-center bg-[var(--color-paper)] text-[var(--color-ink-muted)]">
        <div class="rounded-[3px] border border-[var(--color-paper-3)] bg-[var(--color-paper-2)] px-5 py-4 shadow-sm">
          Loading dossier…
        </div>
      </div>
    );
  }

  if (!store.brief) {
    return (
      <div
        class="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-[var(--color-paper)] text-[var(--color-ink)]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        <div class="max-w-xl w-full text-center space-y-6">
          <h1
            class="text-3xl"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            No dossier on file.
          </h1>
          <p class="text-[var(--color-ink-light)]">
            The refinery needs a brief to refine. Start a fresh one.
          </p>
          <Link
            href={
              store.folioId
                ? `/dossier/create/?folio=${encodeURIComponent(store.folioId)}`
                : "/dossier/create/"
            }
            class="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-vermilion)] text-[var(--color-paper)] px-5 py-2.5 text-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            File this folio's dossier
          </Link>
        </div>
      </div>
    );
  }

  const switchSurface = $(() => {
    store.style = store.style === "form" ? "conversational" : "form";
  });
  const openStartOver = $(() => {
    store.startOverOpen = true;
  });

  // Both surfaces are the same folio, so the route hands each of them the
  // same chrome and lets the folio file it into its own top edge. Switching
  // surfaces swaps a leaf, not the page.
  return (
    <div class={dossierRouteClass(store.style)}>
      {store.style === "form" ? (
        <AntiTabulaRasa
          mode="refine"
          filingState={store.filingState}
          chromeBackHref="/editor/"
          chromeBackLabel="Back to desk"
          chromeShowStartOver
          onSwitchSurface$={switchSurface}
          onStartOver$={openStartOver}
          initialAnswers={
            (store.formAnswers ??
              store.brief.answers) as ProjectInterviewAnswers
          }
          initialAttachments={
            store.formAttachments.length > 0
              ? store.formAttachments
              : store.brief.attachments
          }
          initialProbes={store.brief.probes}
          draftReview={store.dossierCheck}
          draftReviewLoading={store.dossierCheckLoading}
          draftReviewError={store.dossierCheckError}
          onReadDraft$={runDossierCheck}
          onApplyDraftObservation$={applyObservation}
          onDismissDraftObservation$={dismissObservation}
          onSubmit$={onFormSubmit}
        />
      ) : (
        <ConversationalInterview
          mode="refine"
          filingState={store.filingState}
          chromeBackHref="/editor/"
          chromeBackLabel="Back to desk"
          chromeShowStartOver
          onSwitchSurface$={switchSurface}
          onStartOver$={openStartOver}
          initialBrief={store.brief}
          initialAttachments={store.brief.attachments}
          onComplete$={onConversationComplete}
          onUseForm$={({ answers, attachments }) => {
            store.formAnswers = answers;
            store.formAttachments = attachments;
            store.style = "form";
          }}
        />
      )}

      <ThemedDialog
        open={store.startOverOpen}
        title="Start the dossier over?"
        message="The brief, attachments, and probes will be cleared so you can rebuild the dossier from scratch. The manuscript text you've already written is kept — it will be inserted as the starting material when you re-file the dossier."
        confirmLabel="Start over"
        cancelLabel="Keep the dossier"
        tone="danger"
        confirmDisabled={store.startOverBusy}
        busy={store.startOverBusy}
        onCancel$={$(() => {
          store.startOverOpen = false;
        })}
        onConfirm$={confirmStartOver}
      />
    </div>
  );
});

export const head: DocumentHead = {
  title: "Refine the dossier · Twyne",
  meta: [
    {
      name: "description",
      content: "Refine the project brief that anchors the room of editors.",
    },
  ],
};
