import { component$, $, useStore, type PropFunction } from "@builder.io/qwik";
import type { ProjectInterviewAnswers } from "../../types";
import { DEFAULT_INTERVIEW_ANSWERS } from "../../utils/anti-tabula-rasa";

interface BriefRefineryProps {
  initialAnswers?: ProjectInterviewAnswers | null;
  onSave$: PropFunction<(answers: ProjectInterviewAnswers) => void>;
  onCancel$?: PropFunction<() => void>;
}

interface FieldDef {
  key: keyof ProjectInterviewAnswers;
  label: string;
  numeral: string;
  hint: string;
  placeholder: string;
  rows?: number;
}

const FIELDS: FieldDef[] = [
  {
    key: "workingTitle",
    label: "Working Title",
    numeral: "I",
    hint: "Give the piece a working name so the room has something to hold onto.",
    placeholder: "A working title — anything you can carry across a desk",
  },
  {
    key: "format",
    label: "Format",
    numeral: "II",
    hint: "Essay, memo, chapter, dispatch, proposal, profile, polemic — or something stranger.",
    placeholder: "Essay",
  },
  {
    key: "audience",
    label: "Audience",
    numeral: "III",
    hint: "Name the actual reader, not just a demographic label. Picture one face.",
    placeholder:
      "A skeptical, smart reader who needs the argument made plainly",
    rows: 3,
  },
  {
    key: "goal",
    label: "Goal",
    numeral: "IV",
    hint: "What should the piece accomplish? This becomes the north star.",
    placeholder:
      "Convince them, inform them, move them, or change how they think.",
    rows: 3,
  },
  {
    key: "tone",
    label: "Tone",
    numeral: "V",
    hint: "Say how the draft should feel, not just how it should sound.",
    placeholder: "Calm, exact, and a little sharp where it matters",
  },
  {
    key: "constraints",
    label: "Constraints",
    numeral: "VI",
    hint: "Sources, boundaries, forbidden moves, or must-keep material.",
    placeholder:
      "Keep claims tied to evidence, avoid jargon, preserve the anecdote in the second paragraph.",
    rows: 3,
  },
  {
    key: "successSignal",
    label: "Success Signal",
    numeral: "VII",
    hint: "How will we know the draft has landed? Describe the reader's reaction.",
    placeholder:
      "A reader can state the thesis back to us and knows why it matters.",
    rows: 3,
  },
];

export const BriefRefinery = component$(
  ({ initialAnswers, onSave$, onCancel$ }: BriefRefineryProps) => {
    const store = useStore({
      answers: {
        ...DEFAULT_INTERVIEW_ANSWERS,
        ...initialAnswers,
      } as ProjectInterviewAnswers,
      touched: false,
    });

    const handleSave = $(() => {
      onSave$(store.answers);
    });

    return (
      <div
        class="fixed inset-0 paper-sheet paper-foxed"
        style="z-index: var(--z-modal);"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refinery-title"
      >
        <div class="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-4 py-6 sm:px-6 lg:px-8">
          <div class="folio overflow-hidden">
            <div class="p-7">
              {/* Header */}
              <div class="flex items-center justify-between gap-4">
                <div>
                  <span class="stamp">Anti-Tabula Rasa</span>
                  <h1
                    id="refinery-title"
                    class="mt-4 leading-[1.05] text-[var(--color-ink)]"
                    style="font-family: var(--font-display); font-weight: 700; font-size: 2rem; letter-spacing: -0.015em;"
                  >
                    Refine the{" "}
                    <em style="color: var(--color-vermilion); font-style: italic;">
                      dossier.
                    </em>
                  </h1>
                  <p
                    class="mt-2 max-w-lg text-sm leading-6 text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif); font-style: italic;"
                  >
                    Every field is visible at a glance. Tweak what needs
                    changing and save. The rest of the room will pick up the
                    new brief on the next pass.
                  </p>
                </div>
                {onCancel$ && (
                  <button
                    onClick$={onCancel$}
                    class="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                    style="font-family: var(--font-typewriter); letter-spacing: 0.18em; text-transform: uppercase;"
                  >
                    Close
                  </button>
                )}
              </div>

              <div
                class="ornament-divider mt-5"
                style="font-family: var(--font-display);"
              >
                ❦
              </div>

              {/* Fields grid */}
              <div class="mt-6 grid gap-5 md:grid-cols-2">
                {FIELDS.map((field) => {
                  const value = store.answers[field.key];
                  return (
                    <div
                      key={field.key}
                      class={`index-card pt-5 ${
                        field.rows ? "md:col-span-2" : ""
                      }`}
                    >
                      <div class="flex items-baseline gap-2 px-4">
                        <span
                          class="leading-none ink-bleed"
                          style="font-family: var(--font-display); font-weight: 700; font-size: 1.5rem; color: var(--color-vermilion); font-style: italic;"
                        >
                          {field.numeral}.
                        </span>
                        <span
                          class="text-sm text-[var(--color-ink)]"
                          style="font-family: var(--font-display); font-weight: 600;"
                        >
                          {field.label}
                        </span>
                      </div>

                      <p
                        class="mt-1 px-4 text-xs text-[var(--color-ink-light)]"
                        style="font-family: var(--font-serif); font-style: italic;"
                      >
                        {field.hint}
                      </p>

                      {field.rows ? (
                        <textarea
                          value={value}
                          onInput$={(e) => {
                            store.answers = {
                              ...store.answers,
                              [field.key]: (
                                e.target as HTMLTextAreaElement
                              ).value,
                            };
                            store.touched = true;
                          }}
                          placeholder={field.placeholder}
                          rows={field.rows}
                          class="mt-2 w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm leading-6 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:border-[var(--color-vermilion)] focus:outline-none"
                          style="font-family: var(--font-serif); border-radius: 2px;"
                        />
                      ) : (
                        <input
                          value={value}
                          onInput$={(e) => {
                            store.answers = {
                              ...store.answers,
                              [field.key]: (e.target as HTMLInputElement)
                                .value,
                            };
                            store.touched = true;
                          }}
                          placeholder={field.placeholder}
                          class="mt-2 w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:border-[var(--color-vermilion)] focus:outline-none"
                          style="font-family: var(--font-display); font-weight: 500; border-radius: 2px;"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div class="mt-7 flex items-center justify-end gap-3 pt-5 border-t border-dashed border-[var(--color-paper-3)]">
                <span class="text-xs text-[var(--color-ink-muted)]" style="font-family: var(--font-serif); font-style: italic;">
                  {store.touched
                    ? "Unsaved changes"
                    : "No changes yet"}
                </span>
                {onCancel$ && (
                  <button
                    onClick$={onCancel$}
                    class="btn-paper"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick$={handleSave}
                  class="btn-press"
                >
                  Save changes →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
