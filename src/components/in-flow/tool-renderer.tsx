/**
 * The Qwik side of the tool catalog: one component per catalog entry, and a
 * renderer that picks by `type`. json-render ships renderers for React, Vue,
 * Svelte and Solid; this is the same contract — spec in, components out — for
 * Qwik, and it only ever sees specs `validateToolSpec` has already passed.
 */
import { component$, useStore } from "@qwik.dev/core";
import { SentenceBench } from "./sentence-bench";
import { NumericStepper } from "../ui/numeric-stepper";
import { inFlowController } from "../editor/extensions/struggle-tracker";
import type { ActiveTool } from "../../utils/in-flow-tools";
import type { SavedToolConfig } from "../../utils/saved-tools";
import type {
  ClaimCheckProps,
  ReaderQuestionsProps,
  RhythmStripProps,
} from "./catalog";

/** What "Keep this tool" should remember about the tool as the writer left it. */
export function configFor(tool: ActiveTool): SavedToolConfig {
  const element = tool.spec.elements.tool;
  switch (element.type) {
    case "RhythmStrip":
      return {
        targetMin: element.props.targetMin,
        targetMax: element.props.targetMax,
      };
    case "ClaimCheck":
      return { slots: element.props.slots.map((slot) => slot.label) };
    case "ReaderQuestions":
      return element.props.angle ? { angle: element.props.angle } : {};
    default:
      return {};
  }
}

export const ToolRenderer = component$<{ tool: ActiveTool }>(({ tool }) => {
  const element = tool.spec.elements.tool;
  switch (element.type) {
    case "SentenceLab":
      return (
        <SentenceBench
          key={tool.id}
          props={element.props}
          filling={tool.status === "filling"}
          toolId={tool.id}
        />
      );
    case "RhythmStrip":
      return <RhythmStrip key={tool.id} props={element.props} />;
    case "ClaimCheck":
      return <ClaimCheck key={tool.id} props={element.props} />;
    case "ReaderQuestions":
      return (
        <ReaderQuestions
          key={tool.id}
          props={element.props}
          filling={tool.status === "filling"}
        />
      );
  }
});

/* ── Rhythm Strip ──────────────────────────────────────────────── */

const RhythmStrip = component$<{ props: RhythmStripProps }>(({ props }) => {
  // The band lives in the spec (the controller re-seeds it), so a kept tool
  // remembers exactly the band the writer settled on.
  const band = { min: props.targetMin, max: props.targetMax };
  const scale = Math.max(
    band.max * 1.4,
    ...props.sentences.map((s) => s.words),
  );
  const long = props.sentences.filter((s) => s.words > band.max).length;
  const short = props.sentences.filter((s) => s.words < band.min).length;
  const lengths = props.sentences.map((s) => s.words);
  const flat =
    lengths.length >= 4 && Math.max(...lengths) - Math.min(...lengths) <= 4;
  const summary = flat
    ? "The sentences are all about the same length."
    : long || short
      ? [
          long && `${long} run${long === 1 ? "s" : ""} long`,
          short && `${short} ${short === 1 ? "is" : "are"} clipped`,
        ]
          .filter(Boolean)
          .join(", ") + "."
      : "The lengths vary within the band.";
  return (
    <div
      class="in-flow-body"
      data-rhythm-min={band.min}
      data-rhythm-max={band.max}
    >
      <p class="in-flow-summary">{summary}</p>
      <ol class="in-flow-rhythm" aria-label="Sentence lengths">
        {props.sentences.map((s, i) => {
          const tone =
            s.words > band.max ? "long" : s.words < band.min ? "short" : "fit";
          return (
            <li key={`${i}-${s.words}`}>
              <button
                type="button"
                class={`in-flow-bar in-flow-bar--${tone}`}
                style={{ "--bar": `${(s.words / scale) * 100}%` }}
                onMouseEnter$={() => inFlowController()?.highlightSentence(i)}
                onFocus$={() => inFlowController()?.highlightSentence(i)}
                onMouseLeave$={() =>
                  inFlowController()?.highlightSentence(null)
                }
                onBlur$={() => inFlowController()?.highlightSentence(null)}
                onClick$={() => inFlowController()?.selectSentence(i)}
                title={s.text}
                aria-label={`Sentence ${i + 1}: ${s.words} words. Select it in the draft.`}
              >
                <span class="in-flow-bar__fill" />
                <span class="in-flow-bar__count">{s.words}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div class="in-flow-row in-flow-band">
        <span class="in-flow-label">Comfortable length</span>
        <NumericStepper
          value={band.min}
          min={1}
          max={band.max - 1}
          density="compact"
          ariaLabel="Shortest comfortable sentence, in words"
          onValue$={(value) => {
            if (value !== null)
              inFlowController()?.setRhythmBand(value, band.max);
          }}
        />
        <span aria-hidden="true">–</span>
        <NumericStepper
          value={band.max}
          min={band.min + 1}
          max={120}
          density="compact"
          suffix=" words"
          ariaLabel="Longest comfortable sentence, in words"
          onValue$={(value) => {
            if (value !== null)
              inFlowController()?.setRhythmBand(band.min, value);
          }}
        />
      </div>
      <p class="in-flow-quiet">
        Hover a bar to find its sentence; click to select it.
      </p>
    </div>
  );
});

/* ── Claim Check ───────────────────────────────────────────────── */

const SLOT_HINT: Record<string, string> = {
  "A source": "Who else says so? The Apparatus can look.",
  "An example": "One concrete case, right after the claim.",
  "A number": "A figure, and where it comes from.",
};

const ClaimCheck = component$<{ props: ClaimCheckProps }>(({ props }) => {
  const state = useStore({
    slots: props.slots.map((slot) => ({ ...slot })),
    adding: "",
    message: "",
    searching: false,
  });
  const open = state.slots.filter((slot) => !slot.filled).length;
  return (
    <div class="in-flow-body">
      <blockquote class="in-flow-claim">{props.claim}</blockquote>
      <p class="in-flow-summary">
        {open === 0
          ? "Every kind of support you asked for is here."
          : `${open} kind${open === 1 ? "" : "s"} of support still missing.`}
      </p>
      <ul class="in-flow-slots">
        {state.slots.map((slot, i) => (
          <li key={slot.label} class={{ "is-filled": slot.filled }}>
            <label class="in-flow-slot">
              <input
                type="checkbox"
                checked={slot.filled}
                onChange$={(_, el) => {
                  state.slots[i].filled = el.checked;
                }}
              />
              <span>
                <strong>{slot.label}</strong>
                {!slot.filled && SLOT_HINT[slot.label] && (
                  <span class="in-flow-quiet"> — {SLOT_HINT[slot.label]}</span>
                )}
              </span>
            </label>
            {!slot.filled && slot.label === "A source" && (
              <button
                type="button"
                class="btn-paper in-flow-mini"
                disabled={state.searching}
                onClick$={async () => {
                  state.searching = true;
                  state.message = "";
                  const error =
                    (await inFlowController()?.research(props.claim)) ?? null;
                  state.searching = false;
                  state.message =
                    error ?? "Searching — results land in the Apparatus.";
                }}
              >
                {state.searching ? "Looking…" : "Find"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <input
        class="in-flow-input"
        placeholder="Another kind of support…"
        value={state.adding}
        onInput$={(_, el) => {
          state.adding = el.value;
        }}
        onKeyDown$={(event) => {
          const label = state.adding.trim().slice(0, 60);
          if (event.key !== "Enter" || !label) return;
          if (state.slots.length >= 5) return;
          if (!state.slots.some((slot) => slot.label === label))
            state.slots.push({ label, filled: false });
          state.adding = "";
        }}
        aria-label="Add a kind of support"
      />
      {state.message && (
        <p class="in-flow-quiet" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
});

/* ── Reader Questions ──────────────────────────────────────────── */

const ReaderQuestions = component$<{
  props: ReaderQuestionsProps;
  filling: boolean;
}>(({ props, filling }) => {
  const state = useStore({
    angle: props.angle,
    answered: [] as string[],
    jotted: [] as string[],
  });
  return (
    <div class="in-flow-body">
      <label class="in-flow-label" for="in-flow-angle">
        Reading as
      </label>
      <div class="in-flow-row">
        <input
          id="in-flow-angle"
          class="in-flow-input"
          placeholder="the piece's intended reader"
          value={state.angle}
          onInput$={(_, el) => {
            state.angle = el.value;
          }}
          onKeyDown$={(event) => {
            if (event.key === "Enter") inFlowController()?.reask(state.angle);
          }}
        />
        <button
          type="button"
          class="btn-paper in-flow-mini"
          disabled={filling || state.angle === props.angle}
          onClick$={() => inFlowController()?.reask(state.angle)}
        >
          Ask
        </button>
      </div>
      <ol class="in-flow-list">
        {props.questions.map((question) => {
          const answered = state.answered.includes(question);
          const jotted = state.jotted.includes(question);
          return (
            <li
              key={question}
              class={["in-flow-question", { "is-answered": answered }]}
            >
              <label class="in-flow-slot">
                <input
                  type="checkbox"
                  checked={answered}
                  onChange$={(_, el) => {
                    state.answered = el.checked
                      ? [...state.answered, question]
                      : state.answered.filter((q) => q !== question);
                  }}
                />
                <span>{question}</span>
              </label>
              <button
                type="button"
                class="btn-paper in-flow-mini"
                disabled={jotted}
                title="Save this question to your scraps"
                onClick$={async () => {
                  if (await inFlowController()?.jot(question))
                    state.jotted = [...state.jotted, question];
                }}
              >
                {jotted ? "Jotted" : "Jot"}
              </button>
            </li>
          );
        })}
      </ol>
      {filling && (
        <p class="in-flow-quiet" role="status">
          Imagining the reader…
        </p>
      )}
    </div>
  );
});
