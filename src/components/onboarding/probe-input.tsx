import {
  component$,
  useSignal,
  useStore,
  $,
  type PropFunction,
} from "@builder.io/qwik";
import type { DossierProbe } from "../../types";
import {
  BLANK_PATTERN,
  blankAnswer,
  countBlanks,
} from "../../utils/dossier-probes";

interface ProbeInputProps {
  probe: DossierProbe;
  /** Fired with the probe carrying its answer. */
  onAnswer$: PropFunction<(answered: DossierProbe) => void>;
  /** Let the writer decline and go back to typing. */
  onSkip$?: PropFunction<() => void>;
  disabled?: boolean;
}

/**
 * A typed interview question, rendered as the control its kind implies.
 *
 * Single choice commits on click — one tap is the whole point, and a chip
 * followed by a Send button would make it slower than typing. The kinds that
 * can't be finished in one gesture (multi-select, fill-in-the-blanks, scale)
 * get an explicit confirm, because there is no other way to know the writer
 * is done.
 *
 * Every probe is skippable. A generated question is sometimes the wrong
 * question, and a writer who can't get past it is stuck in their own dossier.
 */
export const ProbeInput = component$<ProbeInputProps>((props) => {
  const { probe } = props;
  const state = useStore<{ answer: string | string[] | number }>({
    answer: blankAnswer(probe),
  });
  const touched = useSignal(false);

  const commit = $((answer: string | string[] | number) => {
    props.onAnswer$({ ...probe, answer });
  });

  return (
    <div
      class="mt-2 rounded-[3px] border border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-3"
      role="group"
      aria-label={probe.prompt}
    >
      <p
        class="text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)] mb-2"
        style={{ fontFamily: "var(--font-typewriter)" }}
      >
        {probe.kind === "scale"
          ? "Slide to answer"
          : probe.kind === "blanks"
            ? "Fill in the blanks"
            : probe.kind === "multi"
              ? "Pick any that apply"
              : "Pick one"}
      </p>

      {/* ── Single choice: one tap and it's sent ── */}
      {probe.kind === "choice" && (
        <div class="flex flex-wrap gap-1.5">
          {probe.options?.map((option) => (
            <button
              key={option}
              disabled={props.disabled}
              onClick$={() => commit(option)}
              class="rounded-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-3 py-1 text-[0.8rem] text-[var(--color-ink)] hover:border-[var(--color-vermilion)] hover:text-[var(--color-vermilion)] focus-ring disabled:opacity-40"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* ── Multi-select: toggle, then confirm ── */}
      {probe.kind === "multi" && (
        <>
          <div class="flex flex-wrap gap-1.5">
            {probe.options?.map((option) => {
              const chosen =
                Array.isArray(state.answer) && state.answer.includes(option);
              return (
                <button
                  key={option}
                  disabled={props.disabled}
                  aria-pressed={chosen}
                  onClick$={() => {
                    const current = Array.isArray(state.answer)
                      ? state.answer
                      : [];
                    state.answer = chosen
                      ? current.filter((v) => v !== option)
                      : [...current, option];
                    touched.value = true;
                  }}
                  class="rounded-full border px-3 py-1 text-[0.8rem] focus-ring disabled:opacity-40"
                  style={{
                    fontFamily: "var(--font-serif)",
                    borderColor: chosen
                      ? "var(--color-vermilion)"
                      : "var(--color-paper-3)",
                    background: chosen
                      ? "var(--color-vermilion)"
                      : "var(--color-paper)",
                    color: chosen ? "var(--color-paper)" : "var(--color-ink)",
                  }}
                >
                  {chosen ? "✓ " : ""}
                  {option}
                </button>
              );
            })}
          </div>
          <ConfirmRow
            disabled={
              props.disabled ||
              !Array.isArray(state.answer) ||
              state.answer.length === 0
            }
            onConfirm$={$(() => commit(state.answer))}
            onSkip$={props.onSkip$}
          />
        </>
      )}

      {/* ── Fill in the blanks: inputs sit inside the sentence ── */}
      {probe.kind === "blanks" && probe.template && (
        <>
          <p
            class="text-[0.9rem] leading-8 text-[var(--color-ink)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {splitTemplate(probe.template).map((piece, i) =>
              piece.isBlank ? (
                <input
                  key={`blank-${i}`}
                  type="text"
                  disabled={props.disabled}
                  value={
                    Array.isArray(state.answer)
                      ? (state.answer[piece.blankIndex] ?? "")
                      : ""
                  }
                  onInput$={(_, el) => {
                    const current = Array.isArray(state.answer)
                      ? [...state.answer]
                      : new Array(countBlanks(probe.template!)).fill("");
                    current[piece.blankIndex] = el.value;
                    state.answer = current;
                    touched.value = true;
                  }}
                  aria-label={`Blank ${piece.blankIndex + 1}`}
                  class="mx-1 w-32 border-b border-[var(--color-vermilion)] bg-transparent px-1 text-[0.9rem] text-[var(--color-ink)] focus:outline-none"
                  style={{ fontFamily: "var(--font-serif)" }}
                />
              ) : (
                <span key={`text-${i}`}>{piece.text}</span>
              ),
            )}
          </p>
          <ConfirmRow
            disabled={
              props.disabled ||
              !Array.isArray(state.answer) ||
              !state.answer.some((v) => v.trim())
            }
            onConfirm$={$(() => commit(state.answer))}
            onSkip$={props.onSkip$}
          />
        </>
      )}

      {/* ── Scale ── */}
      {probe.kind === "scale" && (
        <>
          <input
            type="range"
            min={probe.min ?? 1}
            max={probe.max ?? 5}
            step={1}
            disabled={props.disabled}
            value={Number(state.answer)}
            onInput$={(_, el) => {
              state.answer = Number(el.value);
              touched.value = true;
            }}
            class="w-full accent-[var(--color-vermilion)]"
            aria-label={probe.prompt}
            aria-valuetext={`${state.answer} of ${probe.max ?? 5}`}
          />
          <div
            class="flex items-center justify-between text-[0.65rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            <span>{probe.minLabel ?? probe.min ?? 1}</span>
            <span class="text-[var(--color-vermilion)]">{state.answer}</span>
            <span>{probe.maxLabel ?? probe.max ?? 5}</span>
          </div>
          <ConfirmRow
            disabled={props.disabled}
            onConfirm$={$(() => commit(state.answer))}
            onSkip$={props.onSkip$}
          />
        </>
      )}

      {/* Single choice has no confirm row of its own, but still needs an out. */}
      {probe.kind === "choice" && props.onSkip$ && (
        <button
          onClick$={props.onSkip$}
          disabled={props.disabled}
          class="mt-2 text-[0.65rem] tracking-[0.12em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring disabled:opacity-40"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          I'd rather say it in my own words
        </button>
      )}
    </div>
  );
});

const ConfirmRow = component$<{
  disabled?: boolean;
  onConfirm$: PropFunction<() => void>;
  onSkip$?: PropFunction<() => void>;
}>((props) => (
  <div class="mt-2.5 flex items-center gap-3">
    <button
      onClick$={props.onConfirm$}
      disabled={props.disabled}
      class="rounded-full bg-[var(--color-vermilion)] px-3.5 py-1 text-[0.75rem] text-[var(--color-paper)] disabled:opacity-30"
      style={{ fontFamily: "var(--font-display)" }}
    >
      Answer
    </button>
    {props.onSkip$ && (
      <button
        onClick$={props.onSkip$}
        class="text-[0.65rem] tracking-[0.12em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring"
        style={{ fontFamily: "var(--font-typewriter)" }}
      >
        I'd rather say it in my own words
      </button>
    )}
  </div>
));

/** Break a blanks template into literal text and numbered blank slots. */
function splitTemplate(
  template: string,
): Array<{ isBlank: boolean; text: string; blankIndex: number }> {
  const pieces: Array<{ isBlank: boolean; text: string; blankIndex: number }> =
    [];
  let cursor = 0;
  let blankIndex = 0;
  // `matchAll` needs a fresh lastIndex — BLANK_PATTERN is a shared global regex.
  const pattern = new RegExp(BLANK_PATTERN.source, "g");
  for (const match of template.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      pieces.push({
        isBlank: false,
        text: template.slice(cursor, start),
        blankIndex: -1,
      });
    }
    pieces.push({ isBlank: true, text: "", blankIndex: blankIndex++ });
    cursor = start + match[0].length;
  }
  if (cursor < template.length) {
    pieces.push({
      isBlank: false,
      text: template.slice(cursor),
      blankIndex: -1,
    });
  }
  return pieces;
}
