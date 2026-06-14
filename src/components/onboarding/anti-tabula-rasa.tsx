import { component$, $, useStore, type PropFunction } from "@builder.io/qwik";
import type { ProjectInterviewAnswers } from "../../types";
import { DEFAULT_INTERVIEW_ANSWERS } from "../../utils/anti-tabula-rasa";

type InterviewMode = "first-run" | "refine";

type StepKind = "input" | "textarea" | "import";

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
    department: "Dept. of Prior Material",
    question: "Already have a draft, notes, or sources to bring in?",
    hint: "Paste or upload existing prose so the editor's room reads from your work instead of an empty page. Skip if you're starting from scratch.",
    placeholder:
      "Paste an outline, a stalled draft, research notes, source quotes — whatever the room should hold while you write.",
    rows: 12,
    kind: "import",
  },
];

interface AntiTabulaRasaProps {
  initialAnswers?: ProjectInterviewAnswers | null;
  mode?: InterviewMode;
  /** Obsolete — kept for compat but no longer invoked. Use the global event instead. */
  onSubmit$?: PropFunction<
    (answers: ProjectInterviewAnswers, existingMaterial?: string) => void
  >;
  onCancel$?: PropFunction<() => void>;
}

export const AntiTabulaRasa = component$(
  ({ initialAnswers, mode = "first-run", onCancel$ }: AntiTabulaRasaProps) => {
    const store = useStore({
      step: 0,
      answers: {
        ...DEFAULT_INTERVIEW_ANSWERS,
        ...initialAnswers,
      } as ProjectInterviewAnswers,
      existingMaterial: "",
      importedFilename: "",
      submitting: false,
      submitError: "",
    });

    const step = STEPS[store.step];
    if (!step) return null;
    const progress = Math.round(((store.step + 1) / STEPS.length) * 100);

    const goNext = $(() => {
      // Read step from the reactive store at CALL time, not captured value
      const currentStep = store.step;
      const lastStep = currentStep === STEPS.length - 1;

      store.submitError = "";
      if (lastStep) {
        store.submitting = true;

        const event = new CustomEvent("twyne:submit-interview", {
          detail: {
            answers: store.answers,
            existingMaterial: store.existingMaterial,
            filename: store.importedFilename,
          },
        });
        window.dispatchEvent(event);
        return;
      }
      store.step = currentStep + 1;
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

    return (
      <div
        class="fixed inset-0 paper-sheet paper-foxed"
        style="z-index: var(--z-modal);"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atr-title"
      >
        {/* Onboarding starts — let user click freely */}
        {store.submitting && (
          <div
            class="fixed top-4 right-4 flex items-center gap-2 rounded-full px-2.5 py-1"
            style="z-index: 9999; background: var(--color-paper-3); border: 1px solid var(--color-paper-3);"
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
            style="z-index: 9999; background: #c1272d; color: #fff; font-family: monospace; font-size: 0.875rem;"
          >
            ⚠ {store.submitError}
          </div>
        )}

        <div class="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4 py-6 sm:px-6 lg:px-8">
          <div class="folio overflow-hidden">
            <div class="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
              {/* ── LEFT: The Masthead column ───────────────── */}
              <div
                class="border-b border-[var(--color-paper-3)] p-7 lg:border-b-0 lg:border-r"
                style="background: linear-gradient(165deg, var(--color-paper-soft) 0%, var(--color-paper-2) 100%);"
              >
                <div class="flex items-center gap-3">
                  <span class="stamp">Anti-Tabula Rasa</span>
                  {mode === "refine" && (
                    <span class="dept-label">Edition · Revised</span>
                  )}
                </div>

                <h1
                  id="atr-title"
                  class="mt-5 leading-[1.05] text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 700; font-size: 2.75rem; letter-spacing: -0.015em;"
                >
                  Begin with a{" "}
                  <em style="color: var(--color-vermilion); font-style: italic;">
                    dossier,
                  </em>
                  <br />
                  not a blank page.
                </h1>

                <p
                  class="mt-5 max-w-xl text-base leading-7 text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                >
                  Before the first paragraph, the room interviews the project:
                  what it is, who it is for, what it must do, and what we
                  promise to protect. The brief becomes the spine — every editor
                  reads from it.
                </p>

                <div
                  class="ornament-divider mt-7"
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
                  <BriefStat label="Outcome" value="Seeded draft" />
                </div>

                <div class="mt-6 index-card p-4 pt-7">
                  <p class="dept-label">In the dossier so far</p>
                  <p
                    class="mt-2 text-base text-[var(--color-ink)]"
                    style="font-family: var(--font-display); font-weight: 600;"
                  >
                    {store.answers.workingTitle}
                  </p>
                  <p
                    class="mt-1 text-sm text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif); font-style: italic;"
                  >
                    {store.answers.format} for {store.answers.audience}
                  </p>
                </div>
              </div>

              {/* ── RIGHT: The Interview column ────────────── */}
              <div class="flex flex-col p-7 bg-[var(--color-paper)]">
                <div class="mb-5 flex items-center justify-between gap-4">
                  <div class="w-full">
                    <div class="flex items-baseline justify-between">
                      <p class="dept-label">{step.department}</p>
                      <p class="dept-label">
                        Folio {store.step + 1} of {STEPS.length}
                      </p>
                    </div>
                    <div
                      class="mt-2 h-[3px] w-full overflow-hidden bg-[var(--color-paper-2)]"
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
                  {onCancel$ && mode === "refine" && (
                    <button
                      onClick$={onCancel$}
                      class="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                      style="font-family: var(--font-typewriter); letter-spacing: 0.18em; text-transform: uppercase;"
                    >
                      Close
                    </button>
                  )}
                </div>

                <div class="flex-1">
                  <div class="flex items-baseline gap-3">
                    <span
                      class="leading-none ink-bleed"
                      style="font-family: var(--font-display); font-weight: 700; font-size: 3rem; color: var(--color-vermilion); font-style: italic;"
                    >
                      {step.numeral}.
                    </span>
                    <p
                      id="atr-question"
                      class="text-2xl leading-tight text-[var(--color-ink)]"
                      style="font-family: var(--font-display); font-weight: 600;"
                    >
                      {step.question}
                    </p>
                  </div>
                  <p
                    id="atr-hint"
                    class="mt-2 ml-[3.25rem] text-sm text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif); font-style: italic;"
                  >
                    {step.hint}
                  </p>

                  <div class="mt-5">
                    {step.kind === "input" && step.field && (
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
                        class="w-full border-b-2 border-[var(--color-ink)] bg-transparent px-1 py-2 text-lg text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:border-[var(--color-vermilion)] focus:outline-none"
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
                          rows={step.rows || 12}
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
                  </div>

                  <div class="mt-6 index-card p-4 pt-8">
                    <p class="dept-label">Brief preview</p>
                    <dl
                      class="mt-3 space-y-2 text-sm"
                      style="font-family: var(--font-serif);"
                    >
                      <BriefRow
                        label="Title"
                        value={store.answers.workingTitle}
                      />
                      <BriefRow
                        label="Audience"
                        value={store.answers.audience}
                      />
                      <BriefRow label="Goal" value={store.answers.goal} />
                    </dl>
                  </div>
                </div>

                <div class="mt-7 flex items-center justify-between gap-3">
                  <button
                    onClick$={goBack}
                    disabled={store.step === 0}
                    class="btn-paper disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ← Back
                  </button>

                  <div class="flex items-center gap-2" aria-hidden="true">
                    {STEPS.map((_, i) => (
                      <span
                        key={i}
                        class="block h-1 w-1 rounded-full transition-colors"
                        style={{
                          background:
                            i <= store.step
                              ? "var(--color-vermilion)"
                              : "var(--color-paper-3)",
                        }}
                      />
                    ))}
                  </div>

                  <button onClick$={goNext} class="btn-press" disabled={store.submitting}>
                    {store.submitting ? "Sending…" : store.step === STEPS.length - 1 ? "Send to press" : "Next"}
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

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt class="dept-label">{label}</dt>
      <dd class="mt-0.5 text-sm leading-6 text-[var(--color-ink-light)]">
        {value}
      </dd>
    </div>
  );
}
