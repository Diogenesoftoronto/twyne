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
  hasConfiguredAiProvider,
  runClientInterviewTurn,
} from "../../utils/ai-client";
import { loadAiSettingsFromIdb } from "../../utils/idb";
import type { ProjectBrief, ProjectInterviewAnswers } from "../../types";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";

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
 * Non-streaming. Streaming the AI's question into the chat is a
 * polish pass for later — the current implementation waits for the
 * full response before showing the next message.
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
  onComplete$: PropFunction<(brief: ProjectInterviewAnswers) => void>;
  onCancel$?: PropFunction<() => void>;
  cancelLabel?: string;
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
  error: string | null;
  synthesis: Synthesis | null;
  liveDraft: InterviewDossierDraft | null;
  /** When the writer edits a field of the synthesis before accepting. */
  editingField: keyof ProjectInterviewAnswers | null;
  draft: string;
  initialized: boolean;
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

export const ConversationalInterview = component$(
  (props: ConversationalInterviewProps) => {
    const store = useStore<ComponentStore>({
      messages: [],
      loading: false,
      error: null,
      synthesis: null,
      liveDraft: props.initialBrief
        ? { brief: props.initialBrief.answers, confidence: {} }
        : null,
      editingField: null,
      draft: "",
      initialized: false,
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

    const runTurn = $(async (writerText: string) => {
      store.messages = [
        ...store.messages,
        { author: "writer", text: writerText },
      ];
      store.loading = true;
      store.error = null;

      try {
        const settings = await loadAiSettingsFromIdb();
        let result: InterviewTurnResult | null = null;
        const hasByok = hasConfiguredAiProvider(settings);

        if (hasByok && settings) {
          result = await runClientInterviewTurn(
            {
              messages: store.messages,
              mode: props.mode,
              currentBrief: props.initialBrief ?? null,
            },
            settings,
          );
          if (!result) {
            store.error =
              "Your configured provider did not answer. Check the API key, model, and base URL in Preferences.";
            return;
          }
        }

        if (!result && !hasByok && clientSig.value) {
          try {
            result = (await clientSig.value.action(
              (api as any).agents.runInterviewTurn,
              {
                messages: store.messages,
                mode: props.mode,
                currentBrief: props.initialBrief ?? null,
              },
            )) as InterviewTurnResult | null;
          } catch {
            store.error =
              "The shared server could not answer. Sign in again or use your own provider in Preferences.";
            return;
          }
        }

        if (!result) {
          store.error = hasByok
            ? "Your configured provider did not answer. Check the API key, model, and base URL in Preferences."
            : "Add a provider in Preferences or sign in to use the interview.";
          return;
        }

        if (result.kind === "question") {
          store.liveDraft = mergeDossierDraft(store.liveDraft, result.draft);
          store.messages = [
            ...store.messages,
            { author: "interviewer", text: result.text },
          ];
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
      } catch (err) {
        store.error =
          (err as Error).message ??
          "The interview could not continue. Check your provider settings and try again.";
      } finally {
        store.loading = false;
      }
    });

    const send = $(async () => {
      if (store.loading || store.synthesis) return;
      const text = store.draft.trim();
      if (!text) return;
      store.draft = "";
      await runTurn(text);
    });

    const requestSynthesis = $(async () => {
      if (store.loading) return;
      // The writer can ask for the dossier at any point. We just
      // send an empty-ish nudge so the model knows to synthesise
      // rather than ask another question.
      await runTurn(
        "(the writer is ready to see the dossier — please synthesise now)",
      );
    });

    const acceptSynthesis = $(() => {
      if (!store.synthesis) return;
      void props.onComplete$(store.synthesis.brief);
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

    return (
      <div
        class="min-h-screen flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {/* Header */}
        <header class="px-6 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-2)]/90 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p
              class="text-[0.6rem] tracking-[0.32em] uppercase text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              {props.mode === "refine" ? "Refine the dossier" : "The interview"}
            </p>
            <h1
              class="text-lg leading-tight mt-0.5"
              style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
            >
              {props.mode === "refine"
                ? "The room reads your draft."
                : "Begin with a one-liner."}
            </h1>
          </div>
          {props.onCancel$ && (
            <button
              onClick$={props.onCancel$}
              class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-sm"
              style={{
                fontFamily: "var(--font-typewriter)",
                letterSpacing: "0.1em",
              }}
            >
              {props.cancelLabel ?? "Cancel"}
            </button>
          )}
        </header>

        {/* Thread */}
        <div
          ref={scrollerRef}
          class="flex-1 overflow-y-auto px-4 py-6 space-y-4"
        >
          <div class="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div class="space-y-4">
              {store.messages.map((m, i) => (
                <div
                  key={i}
                  class={`flex ${m.author === "writer" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    class={`max-w-[80%] rounded-[3px] px-4 py-2.5 leading-relaxed text-[0.95rem] ${
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
                      <p
                        class="text-[0.55rem] tracking-[0.24em] uppercase mb-1 text-[var(--color-ink-muted)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        The room
                      </p>
                    )}
                    {m.text}
                  </div>
                </div>
              ))}

              {store.loading && (
                <div class="flex justify-start">
                  <div class="bg-[var(--color-paper-2)] border border-[var(--color-paper-3)] rounded-[3px] px-4 py-2.5">
                    <span
                      class="text-[var(--color-ink-muted)] text-sm"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      The room is reading…
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
                      The room's first pass. Edit anything before you take it to
                      the desk.
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
                              style={{ fontFamily: "var(--font-typewriter)" }}
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
                                  style={{ fontFamily: "var(--font-serif)" }}
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

                  <div class="flex items-center gap-2 pt-2 border-t border-[var(--color-paper-3)]">
                    <button
                      onClick$={acceptSynthesis}
                      class="flex-1 rounded-full bg-[var(--color-vermilion)] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      Take it to the desk
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

              {store.error && (
                <div class="bg-[var(--color-vermilion)]/10 border border-[var(--color-vermilion)] rounded p-3 text-sm text-[var(--color-vermilion)]">
                  {store.error}
                </div>
              )}
            </div>

            <aside class="lg:sticky lg:top-4 lg:self-start border border-[var(--color-paper-3)] bg-[var(--color-paper-2)] p-4 shadow-sm">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p
                    class="text-[0.6rem] tracking-[0.24em] uppercase text-[var(--color-ink-muted)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Room brief
                  </p>
                  <h2
                    class="mt-1 text-base"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                    }}
                  >
                    Filling as you talk
                  </h2>
                </div>
                <span
                  class={`block h-2 w-2 rounded-full ${
                    store.synthesis
                      ? "bg-[var(--color-accent-green)]"
                      : "bg-[var(--color-mustard)]"
                  }`}
                  aria-hidden="true"
                />
              </div>

              <dl class="mt-4 space-y-3">
                {FIELD_ORDER.map((field) => {
                  const value = livePanel?.brief[field];
                  const conf = livePanel?.confidence[field];
                  return (
                    <div
                      key={field}
                      class="border-l-2 border-[var(--color-paper-3)] pl-3"
                    >
                      <dt
                        class="flex items-center gap-2 text-[0.57rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        <span
                          class={`inline-block h-1.5 w-1.5 rounded-full ${
                            value
                              ? confidenceTone(conf)
                              : "bg-[var(--color-paper-3)]"
                          }`}
                          aria-hidden="true"
                        />
                        {FIELD_LABELS[field]}
                      </dt>
                      <dd class="mt-1 text-sm leading-6 text-[var(--color-ink-light)]">
                        {value || (
                          <span class="italic text-[var(--color-ink-muted)]">
                            Waiting for evidence.
                          </span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <p
                class="mt-4 border-t border-[var(--color-paper-3)] pt-3 text-[0.72rem] leading-5 text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                When the room has enough, it will ask you to review before
                opening the editor.
              </p>
            </aside>
          </div>
        </div>

        {/* Composer */}
        {!store.synthesis && (
          <div class="border-t border-[var(--color-paper-3)] bg-[var(--color-paper-2)] px-4 py-3">
            <div class="max-w-2xl mx-auto">
              <textarea
                value={store.draft}
                onInput$={(_, el) => {
                  store.draft = el.value;
                }}
                onKeyDown$={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    void send();
                  }
                }}
                rows={3}
                placeholder={
                  store.messages.length <= 1
                    ? "Type your answer here. ⌘↩ to send."
                    : "Type your answer. ⌘↩ to send."
                }
                disabled={store.loading}
                class="w-full border border-[var(--color-paper-3)] rounded px-3 py-2 text-sm bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-vermilion)] disabled:opacity-50"
                style={{ fontFamily: "var(--font-serif)" }}
              />
              <div class="flex items-center justify-between mt-2">
                <button
                  onClick$={requestSynthesis}
                  disabled={store.loading || store.messages.length < 3}
                  class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-30"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                  title="Ask the room to synthesise the dossier now"
                >
                  → Show me what you have
                </button>
                <button
                  onClick$={send}
                  disabled={store.loading || !store.draft.trim()}
                  class="rounded-full bg-[var(--color-vermilion)] text-white px-4 py-1.5 text-sm disabled:opacity-30"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
