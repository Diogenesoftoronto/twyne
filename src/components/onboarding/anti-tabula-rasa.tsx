import { component$, $, useStore, type PropFunction } from "@qwik.dev/core";
import type {
  DossierAttachment,
  DossierCheckResult,
  DossierProbe,
  ProjectInterviewAnswers,
} from "../../types";
import { isAnswered, upsertProbe } from "../../utils/dossier-probes";
import { ProbeInput } from "./probe-input";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { loadAiSettingsFromIdb } from "../../utils/idb";
import {
  hasConfiguredAiProvider,
  runClientInterviewTurn,
} from "../../utils/ai-client";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { DEFAULT_INTERVIEW_ANSWERS } from "../../utils/anti-tabula-rasa";
import { DossierAttachmentsEditor } from "./dossier-attachments-editor";
import {
  buildFormProbeMessages,
  buildLocalFormProbes,
  FORM_PROBE_COUNT,
  mergeFormProbesWithLimit,
  mergeProviderFormProbes,
  requireFormProbe,
} from "../../utils/form-probes";
import type { AppError } from "../../types/application-errors";
import { normalizeApplicationError } from "../../utils/application-errors";
import { ApplicationNotice } from "../ui/application-notice";
import { useAuth } from "../../utils/auth-context";
import { DossierPreview } from "../brief/dossier-preview";
import { DossierFolio } from "./dossier-folio";
import { DossierTopBar } from "./dossier-top-bar";
import { WritingFormatInput } from "./writing-format-input";
import type { DossierFilingState } from "../../utils/dossier-filing";

type InterviewMode = "first-run" | "refine";

type StepKind = "input" | "textarea" | "import" | "attachments" | "probes";

interface InterviewStep {
  /** Only set for answer-bearing steps (input/textarea). */
  field?: keyof ProjectInterviewAnswers;
  /** Roman numeral for the masthead — I, II, III… */
  numeral: string;
  /** Department name, like a magazine section header */
  department: string;
  question: string;
  hint: string;
  placeholder: string;
  rows?: number;
  kind: StepKind;
}

const STEPS: InterviewStep[] = [
  {
    field: "workingTitle",
    numeral: "I",
    department: "Dept. of the Working Title",
    question: "What are we calling it, for now?",
    hint: "Give the piece a working name so the room has something to hold onto.",
    placeholder: "A working title — anything you can carry across a desk",
    kind: "input",
  },
  {
    field: "format",
    numeral: "II",
    department: "Dept. of Form",
    question: "What kind of piece is this?",
    hint: "Essay, memo, chapter, dispatch, proposal, profile, polemic — or something stranger.",
    placeholder: "Essay",
    kind: "input",
  },
  {
    field: "audience",
    numeral: "III",
    department: "Dept. of the Reader",
    question: "Who is this for?",
    hint: "Name the actual reader, not just a demographic label. Picture one face.",
    placeholder:
      "A skeptical, smart reader who needs the argument made plainly",
    rows: 4,
    kind: "textarea",
  },
  {
    field: "goal",
    numeral: "IV",
    department: "Dept. of Intent",
    question: "What should the piece accomplish?",
    hint: "This becomes the north star for the draft and the editorial board.",
    placeholder:
      "Convince them, inform them, move them, or change how they think.",
    rows: 4,
    kind: "textarea",
  },
  {
    field: "tone",
    numeral: "V",
    department: "Dept. of Voice",
    question: "What tone should the room protect?",
    hint: "Say how the draft should feel, not just how it should sound.",
    placeholder: "Calm, exact, and a little sharp where it matters",
    kind: "input",
  },
  {
    field: "constraints",
    numeral: "VI",
    department: "Dept. of Non-Negotiables",
    question: "What constraints or non-negotiables matter?",
    hint: "Sources, boundaries, forbidden moves, or must-keep material.",
    placeholder:
      "Keep claims tied to evidence, avoid jargon, preserve the anecdote in the second paragraph.",
    rows: 4,
    kind: "textarea",
  },
  {
    field: "successSignal",
    numeral: "VII",
    department: "Dept. of the Landing",
    question: "How will we know the draft has landed?",
    hint: "Describe the signal of success from the reader's side.",
    placeholder:
      "A reader can state the thesis back to us and knows why it matters.",
    rows: 4,
    kind: "textarea",
  },
  {
    numeral: "VIII",
    department: "Dept. of Particulars",
    question: "A few specifics, drawn from what you just told us.",
    hint: "The room reads your answers and asks the follow-ups that would sharpen them. Skip any that don't fit — they're questions, not a quiz.",
    placeholder: "",
    kind: "probes",
  },
  {
    numeral: "IX",
    department: "Dept. of Prior Material",
    question: "Already have a draft, notes, or sources to bring in?",
    hint: "Paste or upload existing prose so the editor's room reads from your work instead of an empty page. Skip if you're starting from scratch.",
    placeholder:
      "Paste an outline, a stalled draft, research notes, source quotes — whatever the room should hold while you write.",
    rows: 12,
    kind: "import",
  },
  {
    numeral: "X",
    department: "Dept. of References",
    question: "Anything else the room should know about, and why?",
    hint: "Add as many documents or links as you like, each with a one-line note on why it matters. Skip if there's nothing yet.",
    placeholder: "",
    kind: "attachments",
  },
];

/**
 * Word count of the pasted starting material.
 *
 * Deliberately a free function called from JSX rather than a value computed at
 * the top of the component: Qwik memoises each prop expression against the
 * reactive values that expression reads. A prop wired to a plain local
 * computed once per mount never re-subscribes, so it silently freezes at its
 * first value while everything around it updates.
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

interface AntiTabulaRasaProps {
  /**
   * The route chrome, filed into the folio's top edge. It arrives as plain
   * props rather than projected content because the bar lives two components
   * deep — inside the folio the form renders — and re-projecting a slot that
   * far is more fragile than handing down five serialisable values.
   */
  chromeBackHref: string;
  chromeBackLabel: string;
  chromeShowStartOver?: boolean;
  onSwitchSurface$: PropFunction<() => void>;
  onStartOver$?: PropFunction<() => void>;
  filingState?: DossierFilingState;
  initialAnswers?: ProjectInterviewAnswers | null;
  initialAttachments?: DossierAttachment[];
  initialProbes?: DossierProbe[];
  /**
   * Existing manuscript text to seed the "starting material" field with. Set
   * by `Start over` so a writer who wipes the dossier does not lose what
   * they already wrote — it travels with them into the next interview.
   */
  initialMaterial?: string;
  mode?: InterviewMode;
  draftReview?: DossierCheckResult | null;
  draftReviewLoading?: boolean;
  draftReviewError?: string | null;
  onReadDraft$?: PropFunction<(answers: ProjectInterviewAnswers) => void>;
  onApplyDraftObservation$?: PropFunction<
    (index: number, answers: ProjectInterviewAnswers) => void
  >;
  onDismissDraftObservation$?: PropFunction<(index: number) => void>;
  /** Preferred submit path. Falls back to the legacy global event if omitted. */
  onSubmit$?: PropFunction<
    (
      answers: ProjectInterviewAnswers,
      existingMaterial?: string,
      filename?: string,
      attachments?: DossierAttachment[],
      probes?: DossierProbe[],
    ) => void
  >;
}

export const AntiTabulaRasa = component$(
  ({
    chromeBackHref,
    chromeBackLabel,
    chromeShowStartOver,
    onSwitchSurface$,
    onStartOver$,
    filingState = "idle",
    initialAnswers,
    initialAttachments,
    initialProbes,
    initialMaterial,
    mode = "first-run",
    draftReview,
    draftReviewLoading,
    draftReviewError,
    onReadDraft$,
    onApplyDraftObservation$,
    onDismissDraftObservation$,
    onSubmit$,
  }: AntiTabulaRasaProps) => {
    const store = useStore<{
      step: number;
      answers: ProjectInterviewAnswers;
      attachments: DossierAttachment[];
      existingMaterial: string;
      importedFilename: string;
      submitting: boolean;
      submitError: string;
      /** Generated follow-ups for the Particulars step. */
      probes: DossierProbe[];
      probesLoading: boolean;
      probesError: AppError | null;
      probesSource: "local" | "provider" | null;
      probesAnswersKey: string;
      /** True once we've tried, so re-entering the step doesn't re-ask. */
      probesRequested: boolean;
    }>({
      step: 0,
      answers: {
        ...DEFAULT_INTERVIEW_ANSWERS,
        ...initialAnswers,
      } as ProjectInterviewAnswers,
      attachments: initialAttachments ?? [],
      existingMaterial: initialMaterial ?? "",
      importedFilename: "",
      submitting: false,
      submitError: "",
      probes: initialProbes ?? [],
      probesLoading: false,
      probesError: null,
      probesSource: null,
      probesAnswersKey: "",
      probesRequested: false,
    });
    const clientSig = useConvexClient();
    const auth = useAuth();

    /**
     * Ask the interviewer for follow-ups based on the answers filled in so far.
     *
     * The interview turn endpoint is reused rather than adding a bespoke one:
     * feeding it the form's answers as a transcript is exactly the situation it
     * already handles, and it means the form and the conversation generate
     * probes by the same rules.
     *
     * The form is local-first, so deterministic questions are installed before
     * any provider request starts. A configured provider may replace the
     * unanswered fallbacks with sharper questions, but failure is visible and
     * retryable rather than leaving the Particulars department empty.
     */
    const loadProbes = $(async (force: boolean) => {
      const answersKey = JSON.stringify(store.answers);
      if (
        !force &&
        store.probesRequested &&
        store.probesAnswersKey === answersKey
      ) {
        return;
      }

      const answered = store.probes.filter(isAnswered);
      const localFallback = buildLocalFormProbes(store.answers);
      const visibleQuestionLimit = Math.max(FORM_PROBE_COUNT, answered.length);
      store.probes = mergeFormProbesWithLimit(
        visibleQuestionLimit,
        answered,
        localFallback,
      );
      store.probesRequested = true;
      store.probesAnswersKey = answersKey;
      store.probesLoading = true;
      store.probesError = null;
      store.probesSource = "local";

      try {
        const collected: DossierProbe[] = [];
        const settings = await loadAiSettingsFromIdb();
        const useByok = hasConfiguredAiProvider(settings) ? settings : null;
        const useHosted = !useByok && auth.value.user && clientSig.value;

        // Local-only writers already have useful questions. Do not call an
        // authenticated hosted action merely because a Convex client exists.
        if (!useByok && !useHosted) return;

        // Three sequential turns, each seeing the ones before, so the
        // interviewer doesn't ask the same question three ways.
        for (let i = 0; i < FORM_PROBE_COUNT; i++) {
          const messages = buildFormProbeMessages(store.answers, collected);
          if (useByok) {
            const client = await runClientInterviewTurn(
              { messages, mode: "first-run", currentBrief: null },
              useByok,
            );
            if (!client.ok) {
              store.probesError = client.error;
              break;
            }
            const checked = requireFormProbe(client.value);
            if (!checked.ok) {
              store.probesError = checked.error;
              break;
            }
            collected.push(checked.value);
          } else if (useHosted) {
            try {
              const result = await useHosted.action(
                api.agents.runInterviewTurn,
                { messages, mode: "first-run", currentBrief: null },
              );
              const checked = requireFormProbe(result);
              if (!checked.ok) {
                store.probesError = checked.error;
                break;
              }
              collected.push(checked.value);
            } catch (error) {
              store.probesError = normalizeApplicationError(error, {
                source: "convex",
                metadata: {
                  feature: "interview",
                  operation: "form-probes",
                },
              });
              break;
            }
          }
        }

        if (collected.length > 0) {
          store.probes = mergeProviderFormProbes(
            store.probes,
            collected,
            localFallback,
          );
          store.probesSource = "provider";
        }
      } catch (err) {
        reportApplicationDiagnostic("twyne:form:load-probes", err, {
          feature: "interview",
          operation: "form-probes",
        });
        store.probesError = normalizeApplicationError(err, {
          metadata: {
            feature: "interview",
            operation: "form-probes",
          },
        });
      } finally {
        store.probesLoading = false;
      }
    });

    const step = STEPS[store.step];
    if (!step) return null;
    const progress = Math.round(((store.step + 1) / STEPS.length) * 100);

    const goNext = $(async () => {
      // Read step from the reactive store at CALL time, not captured value
      const currentStep = store.step;
      const lastStep = currentStep === STEPS.length - 1;

      store.submitError = "";
      if (lastStep) {
        store.submitting = true;

        if (onSubmit$) {
          try {
            await onSubmit$(
              store.answers,
              store.existingMaterial,
              store.importedFilename,
              store.attachments,
              store.probes.filter((p) => p.answer !== undefined),
            );
          } catch (err) {
            store.submitError =
              (err as Error).message || "The dossier could not be saved.";
            store.submitting = false;
          }
          return;
        }

        window.dispatchEvent(
          new CustomEvent("twyne:submit-interview", {
            detail: {
              answers: store.answers,
              existingMaterial: store.existingMaterial,
              filename: store.importedFilename,
              attachments: store.attachments,
              probes: store.probes.filter((p) => p.answer !== undefined),
            },
          }),
        );
        return;
      }
      const next = currentStep + 1;
      store.step = next;
      // Fetch the follow-ups as the writer arrives, not on mount — they are
      // derived from answers that don't exist until this point.
      if (STEPS[next]?.kind === "probes") {
        void loadProbes(false);
      }
    });

    const handleFile = $(async (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      const file = input?.files?.[0];
      if (!file) return;
      const raw = await file.text();
      store.existingMaterial = raw;
      store.importedFilename = file.name;
      if (input) input.value = "";
    });

    const clearMaterial = $(() => {
      store.existingMaterial = "";
      store.importedFilename = "";
    });

    const goBack = $(() => {
      if (store.step > 0) {
        store.step -= 1;
      }
    });

    /**
     * Jump straight to a department. The folio's bottom rail and every card in
     * the live dossier are jump targets, which is what makes a ten-step form
     * bearable on one screen: a writer who spots a weak line in the preview
     * fixes it where they saw it instead of walking the form back to it.
     */
    const goToStep = $((index: number) => {
      if (index < 0 || index >= STEPS.length || index === store.step) return;
      store.step = index;
      if (STEPS[index]?.kind === "probes") {
        void loadProbes(false);
      }
    });

    const jumpToField = $((field: keyof ProjectInterviewAnswers) => {
      const index = STEPS.findIndex((entry) => entry.field === field);
      if (index >= 0) store.step = index;
    });

    /** A department is "filed" once it holds something worth carrying. */
    const isStepFiled = (index: number): boolean => {
      const entry = STEPS[index];
      if (!entry) return false;
      if (entry.field) return store.answers[entry.field].trim().length > 0;
      if (entry.kind === "probes") return store.probes.some(isAnswered);
      if (entry.kind === "import")
        return store.existingMaterial.trim().length > 0;
      if (entry.kind === "attachments") return store.attachments.length > 0;
      return false;
    };

    const retryProbes = $(async () => {
      await loadProbes(true);
    });

    const answerFormProbe = $((answered: DossierProbe) => {
      store.probes = upsertProbe(store.probes, answered);
    });

    const readDraft = $(async () => {
      await onReadDraft$?.(store.answers);
    });

    const applyDraftObservation = $(async (index: number) => {
      const observation = draftReview?.observations[index];
      if (!observation?.suggested) return;
      const previous = store.answers;
      const next: ProjectInterviewAnswers = {
        ...previous,
        [observation.field]: observation.suggested,
      };
      store.answers = next;
      store.submitError = "";
      try {
        await onApplyDraftObservation$?.(index, next);
      } catch (error) {
        store.answers = previous;
        store.submitError =
          (error as Error).message ||
          "The dossier change could not be saved. Your form is still open.";
      }
    });

    const dismissDraftObservation = $(async (index: number) => {
      await onDismissDraftObservation$?.(index);
    });

    // The masthead only earns its space on a first run. Someone refining an
    // existing dossier already knows what a dossier is — they get the live
    // sheet from the first step instead of a pitch.
    const showMasthead = mode === "first-run" && store.step === 0;

    return (
      <DossierFolio
        surface="form"
        filingState={
          filingState === "filed"
            ? "filed"
            : store.submitting
              ? "filing"
              : filingState
        }
        chrome={
          <DossierTopBar
            backHref={chromeBackHref}
            backLabel={chromeBackLabel}
            mode="form"
            switchHref=""
            showStartOver={chromeShowStartOver ?? false}
            variant="inset"
            onSwitch$={onSwitchSurface$}
            onStartOver$={onStartOver$ ?? $(() => {})}
          />
        }
        overlays={
          <>
            {store.submitting && (
              <div
                class="fixed top-4 right-4 flex items-center gap-2 rounded-full px-2.5 py-1"
                style="z-index: 60; background: var(--color-paper-2); border: 1px solid var(--color-paper-3);"
              >
                <span
                  class="block h-2 w-2 rounded-full"
                  style="background: var(--color-vermilion); animation: pulse 1.5s ease-in-out infinite;"
                />
                <span
                  class="text-[10px] tracking-wider text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter); text-transform: uppercase;"
                >
                  Sending
                </span>
              </div>
            )}

            {store.submitError && (
              <div
                class="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded"
                style="z-index: 60; background: var(--color-vermilion); color: var(--color-paper-soft); font-family: var(--font-mono); font-size: 0.875rem;"
              >
                ⚠ {store.submitError}
              </div>
            )}
          </>
        }
        dossier={
          <div class="flex min-h-full flex-col">
            {showMasthead ? (
              <div class="flex min-h-full flex-col justify-center">
                <div class="flex items-center gap-3">
                  <span class="stamp">Anti-Tabula Rasa</span>
                </div>

                <h1
                  id="atr-title"
                  class="mt-5 leading-[1.05] text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 700; font-size: 2.4rem; letter-spacing: -0.015em;"
                >
                  Begin with a{" "}
                  <em style="color: var(--color-vermilion); font-style: italic;">
                    dossier,
                  </em>
                  <br />
                  not a blank page.
                </h1>

                <p
                  class="mt-4 max-w-xl text-[0.95rem] leading-7 text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                >
                  Tell the room what you are making. Each answer becomes a field
                  in the dossier, follows this folio into the editor, and gives
                  every review the same point of reference.
                </p>

                <div
                  class="ornament-divider mt-6"
                  style="font-family: var(--font-display);"
                >
                  ❦
                </div>

                <div class="mt-5 grid gap-3 sm:grid-cols-3">
                  <BriefStat
                    label="Section"
                    value={`${store.step + 1} / ${STEPS.length}`}
                  />
                  <BriefStat
                    label="Edition"
                    value={mode === "first-run" ? "First press" : "Revising"}
                  />
                  <BriefStat label="Outcome" value="Filed brief" />
                </div>
              </div>
            ) : (
              <DossierPreview
                answers={store.answers}
                probes={store.probes}
                attachments={store.attachments}
                activeField={STEPS[store.step]?.field}
                existingMaterialWords={countWords(store.existingMaterial)}
                mode={mode}
                reviewedFieldCount={
                  mode === "refine" ? 7 : Math.min(store.step, 7)
                }
                draftReview={draftReview}
                draftReviewLoading={draftReviewLoading}
                draftReviewError={draftReviewError}
                onJumpToField$={jumpToField}
                onReadDraft$={onReadDraft$ ? readDraft : undefined}
                onApplyObservation$={
                  onApplyDraftObservation$ ? applyDraftObservation : undefined
                }
                onDismissObservation$={
                  onDismissDraftObservation$
                    ? dismissDraftObservation
                    : undefined
                }
              />
            )}
          </div>
        }
        leaf={
          <>
            {/* ── RIGHT LEAF: the interview itself ───────────────────────── */}
            <div class="shrink-0 px-5 pt-3">
              <div class="flex items-baseline justify-between gap-3">
                <p class="dept-label truncate">{step.department}</p>
                <p class="dept-label shrink-0">
                  Folio {store.step + 1} of {STEPS.length}
                </p>
              </div>
              <div
                class="mt-1.5 h-[3px] w-full overflow-hidden bg-[var(--color-paper-2)]"
                role="progressbar"
                aria-label="Interview progress"
                aria-valuemin={1}
                aria-valuemax={STEPS.length}
                aria-valuenow={store.step + 1}
              >
                <div
                  class="h-full transition-[width] duration-300"
                  style={{
                    width: `${progress}%`,
                    background:
                      "linear-gradient(90deg, var(--color-vermilion) 0%, var(--color-mustard) 100%)",
                  }}
                />
              </div>
            </div>

            {/*
                  The question sits on the vertical centre of its leaf. A short
                  answer used to leave half a column of dead paper below it;
                  centring turns that into margin on both sides, and a long
                  step (Particulars, prior material) simply grows and scrolls
                  inside this frame instead of pushing the page.
                */}
            <div class="folio-column flex-1">
              <div
                key={store.step}
                class="folio-shift flex min-h-full flex-col justify-between px-5 py-4"
              >
                {/*
                  The sheet above, curling out of the platen: the answer you
                  just gave, greyed back and clickable. It is what turns the
                  empty half of this column into the rest of the document
                  rather than a hole.
                */}
                <GhostSheet
                  position="above"
                  step={STEPS[store.step - 1]}
                  value={
                    STEPS[store.step - 1]?.field
                      ? store.answers[STEPS[store.step - 1]!.field!]
                      : ""
                  }
                  onJump$={$(() => goToStep(store.step - 1))}
                />

                {/* The sheet actually in the platen, floated between them. */}
                <div class="my-auto">
                  <div class="flex items-baseline gap-3">
                    <span
                      class="leading-none ink-bleed"
                      style="font-family: var(--font-display); font-weight: 700; font-size: 2.5rem; color: var(--color-vermilion); font-style: italic;"
                    >
                      {step.numeral}.
                    </span>
                    <p
                      id="atr-question"
                      class="text-[1.4rem] leading-tight text-[var(--color-ink)]"
                      style="font-family: var(--font-display); font-weight: 600;"
                    >
                      {step.question}
                    </p>
                  </div>
                  <p
                    id="atr-hint"
                    class="mt-1.5 ml-[3rem] text-[0.85rem] leading-6 text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif); font-style: italic;"
                  >
                    {step.hint}
                  </p>

                  <div class="mt-4">
                    {step.kind === "input" && step.field === "format" && (
                      <WritingFormatInput
                        value={store.answers.format}
                        labelledBy="atr-question"
                        describedBy="atr-hint"
                        onValueChange$={$((value: string) => {
                          store.answers = {
                            ...store.answers,
                            format: value,
                          };
                        })}
                        onCommit$={goNext}
                      />
                    )}
                    {step.kind === "input" &&
                      step.field &&
                      step.field !== "format" && (
                        <input
                          key={step.field}
                          value={store.answers[step.field]}
                          aria-labelledby="atr-question"
                          aria-describedby="atr-hint"
                          autoFocus
                          onInput$={(e) => {
                            const field = step.field!;
                            store.answers = {
                              ...store.answers,
                              [field]: (e.target as HTMLInputElement).value,
                            };
                          }}
                          onKeyDown$={(e) => {
                            if (e.key === "Enter") goNext();
                          }}
                          placeholder={step.placeholder}
                          class="carriage-input w-full border-b-2 border-[var(--color-ink)] bg-transparent px-1 py-2 text-lg text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:outline-none"
                          style="font-family: var(--font-display); font-weight: 500;"
                        />
                      )}
                    {step.kind === "textarea" && step.field && (
                      <textarea
                        key={step.field}
                        value={store.answers[step.field]}
                        aria-labelledby="atr-question"
                        aria-describedby="atr-hint"
                        autoFocus
                        onKeyDown$={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            goNext();
                          }
                        }}
                        onInput$={(e) => {
                          const field = step.field!;
                          store.answers = {
                            ...store.answers,
                            [field]: (e.target as HTMLTextAreaElement).value,
                          };
                        }}
                        placeholder={step.placeholder}
                        rows={step.rows || 4}
                        class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-3 text-base leading-7 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:border-[var(--color-vermilion)] focus:outline-none"
                        style="font-family: var(--font-serif); border-radius: 2px;"
                      />
                    )}
                    {step.kind === "import" && (
                      <div>
                        <textarea
                          value={store.existingMaterial}
                          aria-labelledby="atr-question"
                          aria-describedby="atr-hint"
                          onInput$={(e) => {
                            store.existingMaterial = (
                              e.target as HTMLTextAreaElement
                            ).value;
                            if (store.importedFilename) {
                              store.importedFilename = "";
                            }
                          }}
                          placeholder={step.placeholder}
                          rows={8}
                          class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-3 text-base leading-7 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:border-[var(--color-vermilion)] focus:outline-none"
                          style="font-family: var(--font-serif); border-radius: 2px;"
                        />

                        <div class="mt-3 flex flex-wrap items-center gap-3">
                          <label
                            class="btn-paper cursor-pointer"
                            title="Upload a .txt, .md, or .html file"
                          >
                            ⇪ Upload a file
                            <input
                              type="file"
                              accept=".txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html"
                              onChange$={handleFile}
                              class="hidden"
                            />
                          </label>

                          {store.existingMaterial && (
                            <>
                              <span
                                class="text-xs text-[var(--color-ink-muted)]"
                                style="font-family: var(--font-typewriter); letter-spacing: 0.12em;"
                              >
                                {store.importedFilename
                                  ? `Filed · ${store.importedFilename}`
                                  : "Pasted"}
                                {" · "}
                                {
                                  store.existingMaterial.trim().split(/\s+/)
                                    .length
                                }{" "}
                                words
                              </span>
                              <button
                                onClick$={clearMaterial}
                                class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] underline"
                                style="font-family: var(--font-typewriter); letter-spacing: 0.12em;"
                              >
                                Clear
                              </button>
                            </>
                          )}

                          {!store.existingMaterial && (
                            <span
                              class="text-xs text-[var(--color-ink-muted)] italic"
                              style="font-family: var(--font-serif);"
                            >
                              .txt, .md, .html accepted — optional
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {step.kind === "probes" && (
                      <div class="space-y-3">
                        {store.probesLoading && (
                          <div
                            class="flex items-center gap-2 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
                            style="font-family: var(--font-typewriter);"
                            role="status"
                          >
                            <span
                              class="h-2 w-2 rounded-full bg-[var(--color-mustard)] interview-stream-pulse"
                              aria-hidden="true"
                            />
                            The room is sharpening the questions. Local
                            questions are ready while it reads.
                          </div>
                        )}
                        {store.probesError && (
                          <ApplicationNotice
                            error={store.probesError}
                            variant="warning"
                            compact
                            busy={store.probesLoading}
                            onRetry$={retryProbes}
                            recoveryLabel="Use local questions"
                            onRecovery$={$(() => {
                              store.probesError = null;
                              store.probesSource = "local";
                            })}
                            showReference={false}
                          />
                        )}
                        {!store.probesLoading &&
                          !store.probesError &&
                          store.probesSource === "local" && (
                            <p
                              class="text-sm text-[var(--color-ink-muted)]"
                              style="font-family: var(--font-serif);"
                              role="status"
                            >
                              These questions were prepared on this device from
                              the brief above. They work without an account or
                              provider.
                            </p>
                          )}
                        {store.probes.map((probe) => (
                          <div key={probe.id}>
                            <p
                              class="text-sm text-[var(--color-ink)]"
                              style="font-family: var(--font-serif);"
                            >
                              {probe.prompt}
                            </p>
                            <ProbeInput
                              probe={probe}
                              onAnswer$={answerFormProbe}
                            />
                          </div>
                        ))}
                        {store.probes.length === 0 && (
                          <button
                            type="button"
                            onClick$={retryProbes}
                            class="btn-paper"
                          >
                            Prepare questions
                          </button>
                        )}
                      </div>
                    )}
                    {step.kind === "attachments" && (
                      <DossierAttachmentsEditor
                        attachments={store.attachments}
                        onChange$={(next) => {
                          store.attachments = next;
                        }}
                      />
                    )}
                  </div>
                </div>

                <GhostSheet
                  position="below"
                  step={STEPS[store.step + 1]}
                  value=""
                  onJump$={$(() => goToStep(store.step + 1))}
                />
              </div>
            </div>

            {/*
                  The old footer spent its middle on ten anonymous dots. The
                  same width now carries the department index: it shows which
                  sections are filed and jumps to any of them.
                */}
            <div class="shrink-0 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-2)]/50 px-5 py-2.5">
              <div class="flex items-center justify-between gap-3">
                <button
                  onClick$={goBack}
                  disabled={store.step === 0}
                  class="btn-paper shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Back
                </button>

                <nav
                  class="flex min-w-0 items-center justify-center gap-0.5 overflow-x-auto"
                  aria-label="Folio sections"
                >
                  {STEPS.map((entry, i) => (
                    <button
                      key={entry.numeral}
                      type="button"
                      class="folio-rail-step shrink-0"
                      data-filled={isStepFiled(i) ? "true" : "false"}
                      aria-current={i === store.step ? "step" : undefined}
                      title={`${entry.numeral} · ${entry.department}`}
                      onClick$={() => goToStep(i)}
                    >
                      {entry.numeral}
                    </button>
                  ))}
                </nav>

                <button
                  onClick$={goNext}
                  class="btn-press shrink-0"
                  disabled={store.submitting}
                >
                  {store.submitting
                    ? "Sending…"
                    : store.step === STEPS.length - 1
                      ? "Send to press"
                      : "Next"}
                </button>
              </div>
            </div>
          </>
        }
      />
    );
  },
);

/**
 * The sheet before or after the one in the platen.
 *
 * The interview column used to end at the input, leaving most of its height
 * blank on any step whose answer is one line. Rather than pad that out or
 * shrink the folio, the neighbouring departments show at the edges: the
 * previous question with the answer you gave it, and the next question waiting
 * its turn. Both are jump targets, so the space carries navigation as well as
 * context — and the stack reads as paper moving through a machine, which is
 * the conceit of the whole surface.
 */
function GhostSheet({
  position,
  step,
  value,
  onJump$,
}: {
  position: "above" | "below";
  step: InterviewStep | undefined;
  value: string;
  onJump$: PropFunction<() => void>;
}) {
  // No neighbour on the first and last sheets — hold the space anyway so the
  // question does not jump vertically as the writer walks the folio.
  if (!step) return <div class="h-5" aria-hidden="true" />;

  return (
    <button
      type="button"
      onClick$={onJump$}
      class={`block w-full truncate text-left text-[0.7rem] leading-5 text-[var(--color-ink-muted)] transition-opacity hover:opacity-100 ${
        position === "above" ? "mb-6 opacity-60" : "mt-6 opacity-50"
      }`}
      style="font-family: var(--font-typewriter);"
      title={`${step.numeral} · ${step.department}`}
    >
      <span class="text-[var(--color-vermilion)]">
        {position === "above" ? "↑" : "↓"} {step.numeral}.
      </span>{" "}
      <span
        class="text-[var(--color-ink-light)]"
        style="font-family: var(--font-serif);"
      >
        {step.question}
      </span>
      {value.trim() && (
        <span style="font-family: var(--font-serif);">
          {" — "}
          <span class="text-[var(--color-ink)]">{value.trim()}</span>
        </span>
      )}
    </button>
  );
}

function BriefStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-3"
      style="border-radius: 2px;"
    >
      <p class="dept-label">{label}</p>
      <p
        class="mt-1 text-sm text-[var(--color-ink)]"
        style="font-family: var(--font-display); font-weight: 600;"
      >
        {value}
      </p>
    </div>
  );
}
