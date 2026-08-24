import {
  component$,
  useStore,
  useSignal,
  $,
  type PropFunction,
  useVisibleTask$,
} from "@builder.io/qwik";
import {
  type InterviewMessage,
  type InterviewTurnResult,
  type InterviewConfidence,
  type InterviewDossierDraft,
  type InterviewStreamUpdate,
  hasConfiguredAiProvider,
  runClientInterviewTurn,
} from "../../utils/ai-client";
import { loadAiSettingsFromIdb } from "../../utils/idb";
import type {
  DossierAttachment,
  DossierProbe,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../../types";
import { probeAnswerText, upsertProbe } from "../../utils/dossier-probes";
import { ProbeInput } from "./probe-input";
import { SpeakButton } from "../ui/speak-button";
import { ChatComposer } from "../ui/chat-composer";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { DossierAttachmentsEditor } from "./dossier-attachments-editor";
import { DossierFolio } from "./dossier-folio";
import { DossierTopBar } from "./dossier-top-bar";
import type { DossierFilingState } from "../../utils/dossier-filing";
import { DossierPreview } from "../brief/dossier-preview";
import { ApplicationNotice } from "../ui/application-notice";
import type { AppError } from "../../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";

/**
 * The conversational interview. A chat-style replacement for the
 * form: the AI asks one question at a time, the writer answers in
 * free text, the AI asks the next question, and when it has enough
 * the AI synthesises a dossier the writer can review and accept.
 *
 * Two modes:
 *   - "first-run" — no prior brief. The conversation starts from
 *     scratch.
 *   - "refine"    — the writer has a dossier already; the AI
 *     cross-references it during the conversation.
 *
 * Model output is rendered as separate reasoning and answer parts. This
 * follows the same content-part model as assistant-ui without importing a
 * React runtime into Qwik: reasoning can begin first, then the visible answer
 * streams into the same turn while the tagged dossier contract stays hidden.
 */

const FIELD_LABELS: Record<keyof ProjectInterviewAnswers, string> = {
  workingTitle: "Working title",
  format: "Format",
  audience: "Audience",
  goal: "Goal",
  tone: "Tone",
  constraints: "Constraints",
  successSignal: "Success signal",
};

const FIELD_ORDER: Array<keyof ProjectInterviewAnswers> = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

const OPENING_QUESTION =
  "Tell me the piece in one sentence — the way you'd describe it to a friend at lunch.";

const REFINE_OPENING_QUESTION =
  "Reading your current brief back to you, what feels off, or what has the draft outgrown?";

interface ConversationalInterviewProps {
  mode: "first-run" | "refine";
  initialBrief?: ProjectBrief;
  initialAttachments?: DossierAttachment[];
  /**
   * Manuscript text carried over from the dossier refinery's "Start over"
   * flow. When present, the opening turn reads it as starting context so the
   * AI orients its first question around what the writer has already drafted
   * rather than starting cold.
   */
  initialMaterial?: string;
  /**
   * Route chrome, filed into the folio's top edge. Same five values the form
   * takes, because the two surfaces are now the same folio and the writer
   * should not be able to tell which one is drawing the bar.
   */
  chromeBackHref: string;
  chromeBackLabel: string;
  chromeShowStartOver?: boolean;
  onSwitchSurface$: PropFunction<() => void>;
  onStartOver$?: PropFunction<() => void>;
  onComplete$: PropFunction<
    (payload: {
      answers: ProjectInterviewAnswers;
      attachments: DossierAttachment[];
      probes: DossierProbe[];
    }) => void
  >;
  filingState?: DossierFilingState;
  onUseForm$?: PropFunction<
    (payload: {
      answers: Partial<ProjectInterviewAnswers>;
      attachments: DossierAttachment[];
    }) => void
  >;
}

interface Synthesis {
  brief: ProjectInterviewAnswers;
  confidence: Partial<
    Record<keyof ProjectInterviewAnswers, InterviewConfidence>
  >;
}

interface ComponentStore {
  messages: InterviewMessage[];
  loading: boolean;
  error: AppError | null;
  pendingWriterText: string | null;
  synthesis: Synthesis | null;
  liveDraft: InterviewDossierDraft | null;
  /** When the writer edits a field of the synthesis before accepting. */
  editingField: keyof ProjectInterviewAnswers | null;
  draft: string;
  initialized: boolean;
  attachments: DossierAttachment[];
  requestVersion: number;
  /** The typed follow-up attached to the latest question, if any. */
  activeProbe: DossierProbe | null;
  /** Probes the writer has answered, carried into the finished dossier. */
  answeredProbes: DossierProbe[];
  /** The in-flight assistant turn, kept separate from committed transcript. */
  streaming: InterviewStreamUpdate | null;
  /** Reasoning panels the writer explicitly opened, keyed by turn index. */
  openReasoning: Record<number, boolean>;
  filing: boolean;
}

function confidenceTone(c: InterviewConfidence | undefined): string {
  if (c === "high") return "bg-[var(--color-accent-green)]";
  if (c === "low") return "bg-[var(--color-vermilion)]";
  return "bg-[var(--color-mustard)]";
}

function confidenceLabel(c: InterviewConfidence | undefined): string {
  if (c === "high") return "high confidence";
  if (c === "low") return "low confidence";
  return "inferred";
}

function mergeDossierDraft(
  current: InterviewDossierDraft | null,
  next: InterviewDossierDraft | undefined,
): InterviewDossierDraft | null {
  if (!next) return current;
  return {
    brief: { ...(current?.brief ?? {}), ...next.brief },
    confidence: { ...(current?.confidence ?? {}), ...next.confidence },
  };
}

interface ReasoningPartProps {
  text: string;
  streaming: boolean;
  open: boolean;
  onToggle$: PropFunction<() => void>;
}

const ReasoningPart = component$((props: ReasoningPartProps) => (
  <section class="interview-reasoning border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
    <button
      type="button"
      onClick$={props.onToggle$}
      aria-expanded={props.open}
      class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[0.65rem] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-vermilion)]"
      style={{ fontFamily: "var(--font-typewriter)" }}
    >
      <span class="flex items-center gap-2">
        <span
          class={`h-1.5 w-1.5 rounded-full ${
            props.streaming
              ? "bg-[var(--color-mustard)] interview-stream-pulse"
              : "bg-[var(--color-ink-muted)]"
          }`}
          aria-hidden="true"
        />
        {props.streaming ? "Reasoning…" : "Reasoning"}
      </span>
      <span aria-hidden="true">{props.open ? "Hide" : "Show"}</span>
    </button>
    {props.open && (
      <div
        aria-live="polite"
        class="border-t border-[var(--color-paper-3)] px-3 py-2.5 text-[0.78rem] leading-5 text-[var(--color-ink-light)] whitespace-pre-wrap"
        style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
      >
        {props.text}
      </div>
    )}
  </section>
));

/**
 * Per-field confidence dots for the folio's left leaf.
 *
 * A free function called from JSX, not a value computed at the top of the
 * component: Qwik memoises each child-prop expression against the reactive
 * values that expression reads, so a prop wired to a plain local freezes at
 * whatever it held on the first render.
 */
/**
 * A dossier the room has not extracted anything into yet.
 *
 * Deliberately *not* DEFAULT_INTERVIEW_ANSWERS: those are the form's seed
 * values, and pouring them into the conversation's live sheet would show the
 * writer seven fields the room has not actually heard them say.
 */
/** How many of the seven fields the room has actually filled in. */
function countFilledFields(
  panel: { brief: Partial<ProjectInterviewAnswers> } | null,
): number {
  return FIELD_ORDER.filter((field) => panel?.brief[field]?.trim()).length;
}

const EMPTY_ANSWERS: ProjectInterviewAnswers = {
  workingTitle: "",
  format: "",
  audience: "",
  goal: "",
  tone: "",
  constraints: "",
  successSignal: "",
};

function buildFieldTone(
  panel: {
    brief: Partial<ProjectInterviewAnswers>;
    confidence: Partial<
      Record<keyof ProjectInterviewAnswers, InterviewConfidence>
    >;
  } | null,
): Partial<Record<keyof ProjectInterviewAnswers, string>> {
  return Object.fromEntries(
    FIELD_ORDER.map((field) => [
      field,
      panel?.brief[field]
        ? confidenceTone(panel.confidence[field])
        : "bg-[var(--color-paper-3)]",
    ]),
  ) as Partial<Record<keyof ProjectInterviewAnswers, string>>;
}

export const ConversationalInterview = component$(
  (props: ConversationalInterviewProps) => {
    const store = useStore<ComponentStore>({
      messages: [],
      loading: false,
      error: null,
      pendingWriterText: null,
      synthesis: null,
      liveDraft: props.initialBrief
        ? { brief: props.initialBrief.answers, confidence: {} }
        : null,
      editingField: null,
      draft: "",
      initialized: false,
      attachments: props.initialAttachments ?? [],
      requestVersion: 0,
      activeProbe: null,
      answeredProbes: props.initialBrief?.probes ?? [],
      streaming: null,
      openReasoning: {},
      filing: false,
    });
    const inputRef = useSignal<HTMLTextAreaElement>();
    const scrollerRef = useSignal<HTMLDivElement>();
    const clientSig = useConvexClient();

    /**
     * Kick the conversation off with the AI's opening question.
     * The AI may answer with a question (normal) or with a synthesis
     * (rare — the writer has nothing yet, so this would only happen
     * if the writer said "synthesize" with no prior turns; we handle
     * it anyway).
     */
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      if (store.initialized) return;
      store.initialized = true;

      const opening =
        props.mode === "refine" ? REFINE_OPENING_QUESTION : OPENING_QUESTION;

      // Seed the writer side with an empty reply slot for the AI
      // to fill. The interview always starts with the AI asking.
      store.messages = [{ author: "interviewer", text: opening }];
      // (The opening question is hard-coded — no AI call needed for
      // the first turn.)
    });

    /**
     * Auto-scroll the message thread to the bottom when a new
     * message lands. Cheap because the thread is bounded.
     */
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track }) => {
      track(() => store.messages.length);
      track(() => store.synthesis);
      const el = scrollerRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });

    const runTurn = $(async (writerText: string, appendWriter = true) => {
      const requestVersion = ++store.requestVersion;
      if (appendWriter) {
        store.messages = [
          ...store.messages,
          { author: "writer", text: writerText },
        ];
      }
      store.pendingWriterText = writerText;
      store.loading = true;
      store.error = null;
      store.streaming = {
        text: "",
        reasoning: "",
        phase: "reasoning",
      };

      try {
        const settings = await loadAiSettingsFromIdb();
        let result: InterviewTurnResult | null = null;
        const hasByok = hasConfiguredAiProvider(settings);

        if (hasByok && settings) {
          const clientResult = await runClientInterviewTurn(
            {
              messages: store.messages,
              mode: props.mode,
              currentBrief: props.initialBrief ?? null,
              startingMaterial: props.initialMaterial ?? null,
            },
            settings,
            (update) => {
              if (requestVersion !== store.requestVersion) return;
              store.streaming = update;
            },
          );
          if (!clientResult.ok) {
            store.error = clientResult.error;
            return;
          }
          result = clientResult.value;
        }

        if (requestVersion !== store.requestVersion) return;

        if (!result && !hasByok && clientSig.value) {
          const streamId = crypto.randomUUID();
          const unsubscribe = clientSig.value.onUpdate(
            (api as any).interviewStreams.get,
            { streamId },
            (update: InterviewStreamUpdate | null) => {
              if (requestVersion !== store.requestVersion || !update) return;
              store.streaming = {
                text: update.text,
                reasoning: update.reasoning,
                phase: update.phase,
              };
            },
            () => undefined,
          );
          try {
            result = (await clientSig.value.action(
              (api as any).agents.runInterviewTurn,
              {
                messages: store.messages,
                mode: props.mode,
                currentBrief: props.initialBrief ?? null,
                startingMaterial: props.initialMaterial ?? null,
                streamId,
              },
            )) as InterviewTurnResult | null;
          } catch (error) {
            store.error = normalizeApplicationError(error, {
              source: "convex",
              metadata: { feature: "interview-turn" },
            });
            return;
          } finally {
            unsubscribe();
            void clientSig.value
              ?.mutation((api as any).interviewStreams.clear, { streamId })
              .catch(() => undefined);
          }
        }

        if (requestVersion !== store.requestVersion) return;

        if (!result) {
          store.error = createAppError(
            clientSig.value ? "AUTHENTICATION_REQUIRED" : "CONFIGURATION_ERROR",
            {
              recovery: {
                action: clientSig.value ? "sign-in" : "choose-provider",
                canRetry: false,
              },
              metadata: { feature: "interview-turn" },
            },
          );
          return;
        }

        if (result.kind === "question") {
          store.liveDraft = mergeDossierDraft(store.liveDraft, result.draft);
          const reasoning = store.streaming?.reasoning.trim() || undefined;
          store.messages = [
            ...store.messages,
            { author: "interviewer", text: result.text, reasoning },
          ];
          // A typed follow-up, when the interviewer offered one. The question
          // itself is always asked in prose above, so the writer can ignore
          // the control and just type.
          store.activeProbe = result.probe ?? null;
        } else {
          // Synthesis — fill any missing field with the writer's
          // own current answer so the dossier is never empty.
          const current = props.initialBrief?.answers;
          const brief: ProjectInterviewAnswers = {
            workingTitle:
              result.brief.workingTitle || current?.workingTitle || "",
            format: result.brief.format || current?.format || "",
            audience: result.brief.audience || current?.audience || "",
            goal: result.brief.goal || current?.goal || "",
            tone: result.brief.tone || current?.tone || "",
            constraints: result.brief.constraints || current?.constraints || "",
            successSignal:
              result.brief.successSignal || current?.successSignal || "",
          };
          store.synthesis = { brief, confidence: result.confidence };
          store.liveDraft = { brief, confidence: result.confidence };
        }
        store.pendingWriterText = null;
        store.streaming = null;
      } catch (error) {
        store.error = normalizeApplicationError(error, {
          metadata: { feature: "interview-turn" },
        });
      } finally {
        if (requestVersion === store.requestVersion) {
          store.loading = false;
          store.streaming = null;
        }
      }
    });

    const send = $(async () => {
      if (store.loading || store.synthesis) return;
      const text = store.draft.trim();
      if (!text) return;
      // Typing past a probe is a legitimate answer to the question; retire it.
      store.activeProbe = null;
      await runTurn(text);
      if (!store.error) store.draft = "";
    });

    /**
     * The writer answered a typed follow-up. Two things happen: the structured
     * answer is kept for the dossier (that is the whole point — the judges get
     * data, not prose), and a readable sentence goes into the transcript so
     * the conversation still reads as a conversation after a tap.
     */
    const answerProbe = $(async (answered: DossierProbe) => {
      if (store.loading) return;
      store.answeredProbes = upsertProbe(store.answeredProbes, answered);
      store.activeProbe = null;
      await runTurn(probeAnswerText(answered));
    });

    const skipProbe = $(() => {
      store.activeProbe = null;
      inputRef.value?.focus();
    });

    const retryTurn = $(async () => {
      const pending = store.pendingWriterText;
      if (!pending || store.loading) return;
      await runTurn(pending, false);
    });

    const useForm = $(() => {
      store.requestVersion += 1;
      props.onUseForm$?.({
        answers:
          store.synthesis?.brief ??
          store.liveDraft?.brief ??
          props.initialBrief?.answers ??
          {},
        attachments: store.attachments,
      });
    });

    const dismissError = $(() => {
      store.error = null;
    });

    const requestSynthesis = $(async () => {
      if (store.loading) return;
      // The writer can ask for the dossier at any point. We just
      // send an empty-ish nudge so the model knows to synthesise
      // rather than ask another question.
      await runTurn(
        "(the writer is ready to see the dossier — please synthesise now)",
        false,
      );
    });

    const acceptSynthesis = $(async () => {
      if (!store.synthesis) return;
      store.filing = true;
      try {
        await props.onComplete$({
          answers: store.synthesis.brief,
          attachments: store.attachments,
          probes: store.answeredProbes,
        });
      } catch (error) {
        store.error = normalizeApplicationError(error, {
          metadata: { feature: "interview", operation: "file-dossier" },
        });
        store.filing = false;
      }
    });

    const applyEdit = $((field: keyof ProjectInterviewAnswers) => {
      if (!store.synthesis || !store.editingField) return;
      const value = store.draft.trim();
      if (!value) return;
      store.synthesis = {
        ...store.synthesis,
        brief: { ...store.synthesis.brief, [field]: value },
        confidence: { ...store.synthesis.confidence, [field]: "high" },
      };
      store.draft = "";
      store.editingField = null;
    });

    const startEditing = $((field: keyof ProjectInterviewAnswers) => {
      if (!store.synthesis) return;
      store.editingField = field;
      store.draft = store.synthesis.brief[field] ?? "";
      // Focus the input next tick
      setTimeout(() => inputRef.value?.focus(), 0);
    });

    const dismissSynthesis = $(() => {
      // The writer wants to keep talking. Drop the synthesis and
      // resume the conversation.
      store.synthesis = null;
      store.editingField = null;
      store.draft = "";
    });

    const livePanel = store.synthesis
      ? { brief: store.synthesis.brief, confidence: store.synthesis.confidence }
      : store.liveDraft;

    // The left leaf is the shared DossierPreview, so the conversation's own
    // signal — how sure the room is about a field it inferred rather than was
    // told — travels as a per-field marker class instead of a bespoke panel.
    const filledFieldCount = countFilledFields(livePanel);

    return (
      <DossierFolio
        surface="conversational"
        filingState={
          props.filingState === "filed"
            ? "filed"
            : store.filing
              ? "filing"
              : (props.filingState ?? "idle")
        }
        chrome={
          <DossierTopBar
            backHref={props.chromeBackHref}
            backLabel={props.chromeBackLabel}
            mode="conversational"
            switchHref=""
            showStartOver={props.chromeShowStartOver ?? false}
            variant="inset"
            onSwitch$={props.onSwitchSurface$}
            onStartOver$={props.onStartOver$ ?? $(() => {})}
          />
        }
        dossier={
          <>
            <DossierPreview
              answers={
                {
                  ...EMPTY_ANSWERS,
                  ...(store.synthesis
                    ? store.synthesis.brief
                    : (store.liveDraft?.brief ?? {})),
                } as ProjectInterviewAnswers
              }
              probes={store.answeredProbes}
              attachments={store.attachments}
              mode={props.mode === "refine" ? "refine" : "first-run"}
              reviewedFieldCount={countFilledFields(
                store.synthesis ?? store.liveDraft,
              )}
              headline={
                store.synthesis ? "Ready for review" : "Filling as you talk"
              }
              fieldTone={buildFieldTone(store.synthesis ?? store.liveDraft)}
            />
            <p
              class="mt-2.5 border-t border-[var(--color-paper-3)] pt-2 text-[0.68rem] leading-5 text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              When the room has enough, it will ask you to review before opening
              the editor.
            </p>
          </>
        }
        leaf={
          <>
            {/* ── RIGHT LEAF: the transcript ──────────────────────────────── */}
            <div class="shrink-0 px-5 pt-3">
              <div class="flex items-baseline justify-between gap-3">
                <p class="dept-label truncate">
                  {props.mode === "refine"
                    ? "Refine the dossier"
                    : "The interview"}
                </p>
                <p class="dept-label shrink-0">
                  {filledFieldCount} of 7 filled
                </p>
              </div>
              <div
                class="mt-1.5 h-[3px] w-full overflow-hidden bg-[var(--color-paper-2)]"
                aria-hidden="true"
              >
                <div
                  class="h-full transition-[width] duration-300"
                  style={{
                    width: `${Math.round((filledFieldCount / 7) * 100)}%`,
                    background:
                      "linear-gradient(90deg, var(--color-vermilion) 0%, var(--color-mustard) 100%)",
                  }}
                />
              </div>
            </div>

            <div
              ref={scrollerRef}
              class="folio-column flex-1 px-5 py-4"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <div class="grid gap-5">
                <div class="space-y-4">
                  {store.messages.map((m, i) => (
                    <div
                      key={i}
                      class={`flex ${m.author === "writer" ? "justify-end" : "justify-start"}`}
                    >
                      <div class="max-w-[80%] space-y-2">
                        {m.author === "interviewer" && m.reasoning && (
                          <ReasoningPart
                            text={m.reasoning}
                            streaming={false}
                            open={store.openReasoning[i] ?? false}
                            onToggle$={$(() => {
                              store.openReasoning = {
                                ...store.openReasoning,
                                [i]: !(store.openReasoning[i] ?? false),
                              };
                            })}
                          />
                        )}
                        <div
                          class={`rounded-[3px] px-4 py-2.5 leading-relaxed text-[0.95rem] ${
                            m.author === "writer"
                              ? "bg-[var(--color-vermilion)] text-white"
                              : "bg-[var(--color-paper-2)] border border-[var(--color-paper-3)] text-[var(--color-ink)]"
                          }`}
                          style={{
                            fontFamily:
                              m.author === "writer"
                                ? "var(--font-serif)"
                                : "var(--font-display)",
                          }}
                        >
                          {m.author === "interviewer" && (
                            <div class="flex items-center justify-between gap-2 mb-1">
                              <p
                                class="text-[0.55rem] tracking-[0.24em] uppercase text-[var(--color-ink-muted)]"
                                style={{ fontFamily: "var(--font-typewriter)" }}
                              >
                                The room
                              </p>
                              <SpeakButton
                                compact
                                id={`interview-${i}`}
                                text={m.text}
                                label="the room"
                              />
                            </div>
                          )}
                          <span
                            data-speech-id={
                              m.author === "interviewer"
                                ? `interview-${i}`
                                : undefined
                            }
                          >
                            {m.text}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {store.loading &&
                    (store.streaming?.reasoning || store.streaming?.text) && (
                      <div class="flex justify-start">
                        <div class="max-w-[80%] space-y-2">
                          {store.streaming.reasoning && (
                            <ReasoningPart
                              text={store.streaming.reasoning}
                              streaming={store.streaming.phase === "reasoning"}
                              open={
                                store.openReasoning[store.messages.length] ??
                                true
                              }
                              onToggle$={$(() => {
                                const key = store.messages.length;
                                store.openReasoning = {
                                  ...store.openReasoning,
                                  [key]: !(store.openReasoning[key] ?? true),
                                };
                              })}
                            />
                          )}
                          {store.streaming.text && (
                            <div
                              aria-live="polite"
                              class="bg-[var(--color-paper-2)] border border-[var(--color-paper-3)] text-[var(--color-ink)] rounded-[3px] px-4 py-2.5 leading-relaxed text-[0.95rem]"
                              style={{ fontFamily: "var(--font-display)" }}
                            >
                              <div class="flex items-center gap-2 mb-1">
                                <p
                                  class="text-[0.55rem] tracking-[0.24em] uppercase text-[var(--color-ink-muted)]"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  The room
                                </p>
                                <span
                                  class="h-1.5 w-1.5 rounded-full bg-[var(--color-mustard)] interview-stream-pulse"
                                  aria-label="Response streaming"
                                />
                              </div>
                              {store.streaming.text}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {/* A typed follow-up to the question just asked. Sits under the
                  thread rather than inside the bubble so the transcript stays
                  a transcript, and the writer can still just type instead. */}
                  {store.activeProbe && !store.loading && !store.synthesis && (
                    <div class="flex justify-start">
                      <div class="max-w-[80%] w-full">
                        <ProbeInput
                          probe={store.activeProbe}
                          disabled={store.loading}
                          onAnswer$={answerProbe}
                          onSkip$={skipProbe}
                        />
                      </div>
                    </div>
                  )}

                  {store.loading &&
                    !store.streaming?.reasoning &&
                    !store.streaming?.text && (
                      <div class="flex justify-start">
                        <div class="bg-[var(--color-paper-2)] border border-[var(--color-paper-3)] rounded-[3px] px-4 py-2.5">
                          <span
                            class="text-[var(--color-ink-muted)] text-sm"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          >
                            Preparing the next question…
                          </span>
                        </div>
                      </div>
                    )}

                  {store.synthesis && (
                    <div class="bg-[var(--color-paper-2)] border border-[var(--color-paper-3)] rounded-[2px] p-5 shadow-sm space-y-4">
                      <div>
                        <p
                          class="text-[0.6rem] tracking-[0.24em] uppercase text-[var(--color-ink-muted)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Draft dossier
                        </p>
                        <p
                          class="text-base"
                          style={{
                            fontFamily: "var(--font-display)",
                            fontWeight: 600,
                          }}
                        >
                          The room's first pass. Edit anything before you take
                          it to the desk.
                        </p>
                      </div>

                      <dl class="space-y-3">
                        {FIELD_ORDER.map((field) => {
                          const value = store.synthesis!.brief[field];
                          const conf = store.synthesis!.confidence[field];
                          const isEditing = store.editingField === field;
                          return (
                            <div
                              key={field}
                              class="border-l-2 border-[var(--color-paper-3)] pl-3 py-1"
                            >
                              <dt
                                class="text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] flex items-center gap-2 mb-1"
                                style={{ fontFamily: "var(--font-typewriter)" }}
                              >
                                <span
                                  class={`inline-block w-1.5 h-1.5 rounded-full ${confidenceTone(conf)}`}
                                  aria-hidden="true"
                                />
                                {FIELD_LABELS[field]}
                                <span
                                  class="text-[0.55rem] tracking-[0.1em] normal-case text-[var(--color-ink-muted)]"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  ({confidenceLabel(conf)})
                                </span>
                              </dt>
                              <dd
                                class="text-[0.95rem] leading-relaxed"
                                style={{ fontFamily: "var(--font-serif)" }}
                              >
                                {isEditing ? (
                                  <div class="space-y-2">
                                    <textarea
                                      ref={inputRef}
                                      value={store.draft}
                                      onInput$={(_, el) => {
                                        store.draft = el.value;
                                      }}
                                      rows={3}
                                      class="w-full border border-[var(--color-paper-3)] rounded px-2 py-1.5 text-sm bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-vermilion)]"
                                      style={{
                                        fontFamily: "var(--font-serif)",
                                      }}
                                    />
                                    <div class="flex items-center gap-2">
                                      <button
                                        onClick$={() => applyEdit(field)}
                                        class="text-xs px-3 py-1 rounded bg-[var(--color-vermilion)] text-white"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick$={() => {
                                          store.editingField = null;
                                          store.draft = "";
                                        }}
                                        class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div class="flex items-start justify-between gap-2">
                                    <span class="flex-1">
                                      {value || (
                                        <em class="text-[var(--color-ink-muted)] italic">
                                          (empty — the room wasn't sure)
                                        </em>
                                      )}
                                    </span>
                                    <button
                                      onClick$={() => startEditing(field)}
                                      class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] flex-shrink-0"
                                      style={{
                                        fontFamily: "var(--font-typewriter)",
                                      }}
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>

                      <div class="border-t border-[var(--color-paper-3)] pt-4">
                        <p
                          class="text-[0.6rem] tracking-[0.24em] uppercase text-[var(--color-ink-muted)] mb-2"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Reference material
                        </p>
                        <DossierAttachmentsEditor
                          attachments={store.attachments}
                          onChange$={(next) => {
                            store.attachments = next;
                          }}
                        />
                      </div>

                      <div class="flex items-center gap-2 pt-2 border-t border-[var(--color-paper-3)]">
                        <button
                          onClick$={acceptSynthesis}
                          disabled={store.filing}
                          class="flex-1 rounded-full bg-[var(--color-vermilion)] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          {store.filing ? "Filing…" : "File and open the desk"}
                        </button>
                        <button
                          onClick$={dismissSynthesis}
                          class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-sm px-4 py-2.5"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Keep talking
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Composer */}
            {!store.synthesis && (
              <div
                class="shrink-0 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-2)]/50 px-5 pt-3"
                style={{
                  paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
                }}
              >
                <div class="mx-auto w-full">
                  {store.error && (
                    <div class="mb-3">
                      <ApplicationNotice
                        error={store.error}
                        busy={store.loading}
                        onRetry$={
                          store.error.recovery.canRetry ? retryTurn : undefined
                        }
                        recoveryLabel={
                          store.error.code === "AUTHENTICATION_REQUIRED"
                            ? "Sign in"
                            : props.onUseForm$
                              ? "Use the form"
                              : "Open AI settings"
                        }
                        recoveryHref={
                          store.error.code === "AUTHENTICATION_REQUIRED"
                            ? "/signin/"
                            : props.onUseForm$
                              ? undefined
                              : "/settings/"
                        }
                        onRecovery$={props.onUseForm$ ? useForm : undefined}
                        onDismiss$={dismissError}
                      />
                    </div>
                  )}
                  {/* Speaking an answer fills the box rather than sending it —
                  transcription mishears, and the writer should see their own
                  words before the room does. */}
                  <ChatComposer
                    value={store.draft}
                    onValueChange$={$((value: string) => {
                      store.draft = value;
                    })}
                    onSend$={send}
                    busy={store.loading}
                    label="Your answer"
                    placeholder={
                      store.messages.length <= 1
                        ? "Type your answer here, or speak it."
                        : "Type your answer…"
                    }
                    transcriptionHint={
                      props.initialBrief
                        ? `${props.initialBrief.answers.workingTitle}. ${props.initialBrief.answers.audience}`
                        : undefined
                    }
                  >
                    <button
                      q:slot="actions"
                      type="button"
                      onClick$={requestSynthesis}
                      disabled={store.loading || store.messages.length < 3}
                      class="focus-ring text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-30"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                      title="Ask the room to synthesise the dossier now"
                    >
                      → Show me what you have
                    </button>
                  </ChatComposer>
                </div>
              </div>
            )}
          </>
        }
      />
    );
  },
);
