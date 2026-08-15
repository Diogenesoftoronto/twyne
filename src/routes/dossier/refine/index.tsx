import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { useNavigate, Link } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../../components/onboarding/anti-tabula-rasa";
import { ConversationalInterview } from "../../../components/onboarding/conversational-interview";
import { DossierTopBar } from "../../../components/onboarding/dossier-top-bar";
import { ThemedDialog } from "../../../components/ui/themed-dialog";
import type {
  DossierAttachment,
  DossierProbe,
  DossierCheckResult,
  DossierObservation,
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

interface RefiningStore {
  brief: ProjectBrief | null;
  draftText: string;
  hydrated: boolean;
  style: InterviewStyle;
  dossierCheck: DossierCheckResult | null;
  dossierCheckLoading: boolean;
  dossierCheckError: string | null;
  showDossierCheck: boolean;
  formAnswers: Partial<ProjectInterviewAnswers> | null;
  formAttachments: DossierAttachment[];
  folioId: string | null;
  startOverOpen: boolean;
  startOverBusy: boolean;
}

/**
 * The brief refinery. Two modes:
 *   - **form** (default) — the existing AntiTabulaRasa with pre-filled answers.
 *   - **conversational** — chat with the AI about which fields have drifted.
 * Plus the "sideways lift": a "Read my draft" button that asks the AI to
 * cross-reference the current draft against the dossier and surfaces where
 * the draft has outgrown the brief.
 */
export default component$(() => {
  const nav = useNavigate();
  const store = useStore<RefiningStore>({
    brief: null,
    draftText: "",
    hydrated: false,
    style: "form",
    dossierCheck: null,
    dossierCheckLoading: false,
    dossierCheckError: null,
    showDossierCheck: false,
    formAnswers: null,
    formAttachments: [],
    folioId: null,
    startOverOpen: false,
    startOverBusy: false,
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
    (
      answers: ProjectInterviewAnswers,
      _existing?: string,
      _filename?: string,
      attachments?: DossierAttachment[],
      probes?: DossierProbe[],
    ) => {
      if (!store.brief || !store.folioId) return;
      const next = createProjectBrief(
        answers,
        store.brief,
        attachments,
        probes,
      );
      void saveProjectBriefForFolio(store.folioId, next);
      void captureProductEvent("dossier_completed", { mode: "refine" });
      void nav("/editor/");
    },
  );

  const onConversationComplete = $(
    ({
      answers,
      attachments,
      probes,
    }: {
      answers: ProjectInterviewAnswers;
      attachments: DossierAttachment[];
      probes: DossierProbe[];
    }) => {
      if (!store.brief || !store.folioId) return;
      const next = createProjectBrief(
        answers,
        store.brief,
        attachments,
        probes,
      );
      void saveProjectBriefForFolio(store.folioId, next);
      void captureProductEvent("dossier_completed", { mode: "refine" });
      void nav("/editor/");
    },
  );

  const runDossierCheck = $(async () => {
    if (!store.brief) return;
    store.dossierCheckLoading = true;
    store.dossierCheckError = null;
    store.showDossierCheck = true;
    try {
      const raw = await loadAiSettingsFromIdb();
      const settings = raw ?? {
        advancedMode: false,
        providers: [],
        defaultProviderId: null,
        perFeature: {},
        showProviderTags: false,
      };
      if (!hasConfiguredAiProvider(settings)) {
        store.dossierCheckError =
          "Reading the draft needs a configured AI provider. Add one in Settings.";
        store.dossierCheckLoading = false;
        return;
      }
      const result = await runClientDossierCheck(
        { brief: store.brief, draftText: store.draftText || null },
        settings,
      );
      store.dossierCheck = result;
    } catch (err) {
      store.dossierCheckError = (err as Error).message ?? "The check failed.";
    } finally {
      store.dossierCheckLoading = false;
    }
  });

  const applyObservation = $((obs: DossierObservation) => {
    if (!store.brief || !store.folioId || !obs.suggested) return;
    const updated: ProjectInterviewAnswers = {
      ...store.brief.answers,
      [obs.field]: obs.suggested,
    };
    const next: ProjectBrief = {
      ...store.brief,
      answers: updated,
      updatedAt: Date.now(),
    };
    void saveProjectBriefForFolio(store.folioId, next);
    store.brief = next;
    if (store.dossierCheck) {
      store.dossierCheck = {
        ...store.dossierCheck,
        observations: store.dossierCheck.observations.filter((o) => o !== obs),
      };
    }
  });

  const dismissObservation = $((obs: DossierObservation) => {
    if (store.dossierCheck) {
      store.dossierCheck = {
        ...store.dossierCheck,
        observations: store.dossierCheck.observations.filter((o) => o !== obs),
      };
    }
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
            class="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-vermilion)] text-white px-5 py-2.5 text-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            File this folio's dossier
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div class={dossierRouteClass(store.style)}>
      <DossierTopBar
        backHref="/editor/"
        backLabel="Back to desk"
        mode={store.style}
        switchHref=""
        showStartOver
        onSwitch$={$(() => {
          const next = store.style === "form" ? "conversational" : "form";
          store.style = next;
        })}
        onStartOver$={$(() => {
          store.startOverOpen = true;
        })}
      />

      {store.style === "form" && (
        <div class="px-4 py-3 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
          <div class="max-w-2xl mx-auto flex items-center justify-between gap-3">
            <div>
              <p
                class="text-sm"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              >
                Have the room read your draft.
              </p>
              <p
                class="text-[0.7rem] text-[var(--color-ink-muted)] mt-0.5"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Cross-references the dossier against the current draft.
              </p>
            </div>
            <button
              onClick$={runDossierCheck}
              disabled={store.dossierCheckLoading}
              class="rounded-full bg-[var(--color-ink)] text-white px-4 py-1.5 text-sm disabled:opacity-30"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {store.dossierCheckLoading ? "Reading…" : "Read my draft"}
            </button>
          </div>
        </div>
      )}

      {store.showDossierCheck && (
        <section class="px-4 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
          <div class="max-w-2xl mx-auto space-y-3">
            <div class="flex items-center justify-between">
              <p
                class="text-[0.6rem] tracking-[0.24em] uppercase text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Drift report
              </p>
              <button
                onClick$={() => {
                  store.showDossierCheck = false;
                }}
                class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Close
              </button>
            </div>

            {store.dossierCheckError && (
              <div class="bg-[var(--color-vermilion)]/10 border border-[var(--color-vermilion)] rounded p-3 text-sm text-[var(--color-vermilion)]">
                {store.dossierCheckError}
              </div>
            )}

            {store.dossierCheck?.observations.length === 0 && (
              <p class="text-sm text-[var(--color-ink-light)] italic">
                No drift detected. The dossier still matches the draft.
              </p>
            )}

            {store.dossierCheck?.observations.map((obs, i) => (
              <div
                key={i}
                class="bg-[var(--color-paper-2)] border border-[var(--color-paper-3)] rounded p-3 space-y-2"
              >
                <p
                  class="text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {obs.field}
                </p>
                <p
                  class="text-sm leading-relaxed"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {obs.reason}
                </p>
                {obs.suggested && (
                  <p
                    class="text-xs px-2 py-1.5 bg-[var(--color-paper)] border-l-2 border-[var(--color-mustard)] italic"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    <span class="text-[var(--color-ink-muted)] not-italic">
                      Suggested:{" "}
                    </span>
                    {obs.suggested}
                  </p>
                )}
                <div class="flex items-center gap-2 pt-1">
                  {obs.suggested && (
                    <button
                      onClick$={() => applyObservation(obs)}
                      class="text-xs px-3 py-1 rounded bg-[var(--color-vermilion)] text-white"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Apply
                    </button>
                  )}
                  <button
                    onClick$={() => dismissObservation(obs)}
                    class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {store.style === "form" ? (
        <AntiTabulaRasa
          mode="refine"
          initialAnswers={
            (store.formAnswers ??
              store.brief.answers) as ProjectInterviewAnswers
          }
          initialAttachments={
            store.formAttachments.length > 0
              ? store.formAttachments
              : store.brief.attachments
          }
          onSubmit$={onFormSubmit}
        />
      ) : (
        <ConversationalInterview
          mode="refine"
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
