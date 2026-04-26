import { component$, $, useStore, type PropFunction } from "@builder.io/qwik";
import type { ProjectInterviewAnswers } from "../../types";
import { DEFAULT_INTERVIEW_ANSWERS } from "../../utils/anti-tabula-rasa";

type InterviewMode = "first-run" | "refine";

interface InterviewStep {
  field: keyof ProjectInterviewAnswers;
  question: string;
  hint: string;
  placeholder: string;
  rows?: number;
  kind: "input" | "textarea";
}

const STEPS: InterviewStep[] = [
  {
    field: "workingTitle",
    question: "What are we making?",
    hint: "Give the draft a working name so the room has something to hold onto.",
    placeholder: "Working title",
    kind: "input",
  },
  {
    field: "format",
    question: "What kind of piece is this?",
    hint: "Essay, memo, chapter, proposal, landing page, essay, response, or something stranger.",
    placeholder: "Essay",
    kind: "input",
  },
  {
    field: "audience",
    question: "Who is this for?",
    hint: "Name the actual reader, not just a demographic label.",
    placeholder: "A skeptical smart reader who needs the argument made plainly",
    rows: 4,
    kind: "textarea",
  },
  {
    field: "goal",
    question: "What should the piece accomplish?",
    hint: "This becomes the north star for the draft and the editorial room.",
    placeholder:
      "Convince them, inform them, move them, or change how they think.",
    rows: 4,
    kind: "textarea",
  },
  {
    field: "tone",
    question: "What tone should the room protect?",
    hint: "Say how the draft should feel, not just how it should sound.",
    placeholder: "Calm, exact, and a little sharp where it matters",
    kind: "input",
  },
  {
    field: "constraints",
    question: "What constraints or non-negotiables matter?",
    hint: "Include sources, boundaries, forbidden moves, or must-keep material.",
    placeholder:
      "Keep claims tied to evidence, avoid jargon, and preserve the anecdote in the second paragraph.",
    rows: 4,
    kind: "textarea",
  },
  {
    field: "successSignal",
    question: "How will we know the draft is working?",
    hint: "Describe the signal of success from the reader's side.",
    placeholder:
      "A reader can state the thesis back to us and knows why it matters.",
    rows: 4,
    kind: "textarea",
  },
];

interface AntiTabulaRasaProps {
  initialAnswers?: ProjectInterviewAnswers | null;
  mode?: InterviewMode;
  onSubmit$: PropFunction<(answers: ProjectInterviewAnswers) => void>;
  onCancel$?: PropFunction<() => void>;
}

export const AntiTabulaRasa = component$(
  ({
    initialAnswers,
    mode = "first-run",
    onSubmit$,
    onCancel$,
  }: AntiTabulaRasaProps) => {
    const store = useStore({
      step: 0,
      answers: {
        ...DEFAULT_INTERVIEW_ANSWERS,
        ...initialAnswers,
      } as ProjectInterviewAnswers,
    });

    const step = STEPS[store.step];
    const isLastStep = store.step === STEPS.length - 1;
    const progress = Math.round(((store.step + 1) / STEPS.length) * 100);

    const goNext = $(() => {
      if (isLastStep) {
        onSubmit$(store.answers);
        return;
      }
      store.step += 1;
    });

    const goBack = $(() => {
      if (store.step > 0) {
        store.step -= 1;
      }
    });

    return (
      <div class="fixed inset-0 z-50 bg-[rgba(250,249,247,0.9)] backdrop-blur-md">
        <div class="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4 py-6 sm:px-6 lg:px-8">
          <div class="overflow-hidden rounded-3xl border border-[var(--color-surface-3)] bg-white shadow-2xl">
            <div class="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
              <div class="border-b border-[var(--color-surface-3)] bg-[linear-gradient(135deg,rgba(109,90,207,0.14),rgba(255,255,255,0.9))] p-6 lg:border-b-0 lg:border-r">
                <p class="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-brand)]">
                  Anti-tabula rasa
                </p>
                <h1 class="mt-3 text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
                  Start with context, not emptiness.
                </h1>
                <p class="mt-4 max-w-xl text-sm leading-6 text-[var(--color-ink-light)]">
                  Before the first paragraph, we interview the project: what it
                  is, who it is for, what it must do, and what the room should
                  protect.
                </p>

                <div class="mt-6 grid gap-3 sm:grid-cols-3">
                  <BriefStat
                    label="Step"
                    value={`${store.step + 1} / ${STEPS.length}`}
                  />
                  <BriefStat
                    label="Mode"
                    value={
                      mode === "first-run"
                        ? "First draft setup"
                        : "Refining the brief"
                    }
                  />
                  <BriefStat label="Output" value="Seeded draft" />
                </div>

                <div class="mt-6 rounded-2xl border border-[var(--color-surface-3)] bg-white/80 p-4">
                  <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                    What you are building
                  </p>
                  <p class="mt-2 text-sm text-[var(--color-ink-light)]">
                    {store.answers.workingTitle}
                  </p>
                  <p class="mt-2 text-sm text-[var(--color-ink-muted)]">
                    {store.answers.format} for {store.answers.audience}
                  </p>
                </div>
              </div>

              <div class="flex flex-col p-6">
                <div class="mb-4 flex items-center justify-between gap-4">
                  <div class="w-full">
                    <div class="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div
                        class="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p class="mt-2 text-xs uppercase tracking-[0.24em] text-[var(--color-ink-muted)]">
                      Interview {store.step + 1} of {STEPS.length}
                    </p>
                  </div>
                  {onCancel$ && mode === "refine" && (
                    <button
                      onClick$={onCancel$}
                      class="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    >
                      Close
                    </button>
                  )}
                </div>

                <div class="flex-1">
                  <p class="text-sm font-medium text-[var(--color-brand)]">
                    {step.question}
                  </p>
                  <p class="mt-1 text-sm text-[var(--color-ink-light)]">
                    {step.hint}
                  </p>

                  <div class="mt-5">
                    {step.kind === "input" ? (
                      <input
                        value={store.answers[step.field]}
                        onInput$={(e) => {
                          store.answers = {
                            ...store.answers,
                            [step.field]: (e.target as HTMLInputElement).value,
                          };
                        }}
                        placeholder={step.placeholder}
                        class="w-full rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)] focus:outline-none"
                      />
                    ) : (
                      <textarea
                        value={store.answers[step.field]}
                        onInput$={(e) => {
                          store.answers = {
                            ...store.answers,
                            [step.field]: (e.target as HTMLTextAreaElement)
                              .value,
                          };
                        }}
                        placeholder={step.placeholder}
                        rows={step.rows || 4}
                        class="w-full rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface)] px-4 py-3 text-sm leading-6 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)] focus:outline-none"
                      />
                    )}
                  </div>

                  <div class="mt-5 rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface)] p-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                      Brief preview
                    </p>
                    <div class="mt-3 space-y-2 text-sm text-[var(--color-ink-light)]">
                      <p>
                        <span class="font-medium text-[var(--color-ink)]">
                          Title:
                        </span>{" "}
                        {store.answers.workingTitle}
                      </p>
                      <p>
                        <span class="font-medium text-[var(--color-ink)]">
                          Audience:
                        </span>{" "}
                        {store.answers.audience}
                      </p>
                      <p>
                        <span class="font-medium text-[var(--color-ink)]">
                          Goal:
                        </span>{" "}
                        {store.answers.goal}
                      </p>
                    </div>
                  </div>
                </div>

                <div class="mt-6 flex items-center justify-between gap-3">
                  <button
                    onClick$={goBack}
                    disabled={store.step === 0}
                    class="rounded-full border border-[var(--color-surface-3)] px-4 py-2 text-sm font-medium text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Back
                  </button>

                  <button
                    onClick$={goNext}
                    class="rounded-full bg-[var(--color-brand)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-dark)]"
                  >
                    {isLastStep ? "Build the brief" : "Next"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

function BriefStat({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-2xl border border-[var(--color-surface-3)] bg-white/85 p-3">
      <p class="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--color-ink-muted)]">
        {label}
      </p>
      <p class="mt-1 text-sm font-medium text-[var(--color-ink)]">{value}</p>
    </div>
  );
}
