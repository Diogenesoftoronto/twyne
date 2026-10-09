import { component$, useSignal, useStyles$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { InstrumentArt, InstrumentRule } from "./instrument-art";
import {
  InstrumentMotion,
  InstrumentMotionPart,
  type InstrumentMotionState,
} from "./instrument-motion";

const MotionStudy = component$<{
  initialState?: InstrumentMotionState;
  quiet?: boolean;
  flow?: "working" | "flow";
}>((props) => {
  const state = useSignal<InstrumentMotionState>(props.initialState ?? "rest");
  const revision = useSignal(0);
  const quiet = useSignal(props.quiet ?? false);
  useStyles$(`
    .instrument-motion-study { max-width: 40rem; color: var(--color-ink); font: .875rem/1.5 var(--font-sans); }
    .instrument-motion-study__tool { padding: 1.5rem; background: var(--color-paper); border: 1px solid var(--color-paper-3); }
    .instrument-motion-study__head { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    .instrument-motion-study h2 { margin: 0 0 .375rem; font: 600 1.125rem/1.3 var(--font-sans); }
    .instrument-motion-study p { margin: 0; }
    .instrument-motion-study__hint { color: var(--color-ink-light); }
    .instrument-motion-study__wording { padding: 1rem 0; border-top: 1px solid var(--color-paper-3); }
    .instrument-motion-study__label { display: block; margin-bottom: .375rem; color: var(--color-ink-light); font-size: .75rem; }
    .instrument-motion-study__wording p { font: 1.0625rem/1.65 var(--font-serif); }
    .instrument-motion-study__result { padding: .875rem 0 0; color: var(--color-ink-light); font-size: .8125rem; }
    .instrument-motion-study__result .instrument-art__rule { margin-bottom: .625rem; }
    .instrument-motion-study__controls { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.25rem; }
    .instrument-motion-study button { padding: .5rem .75rem; min-height: 2.75rem; border: 1px solid var(--color-ink-light); background: transparent; color: var(--color-ink); font: inherit; cursor: pointer; }
    .instrument-motion-study button:hover { background: var(--color-paper-2); }
    .instrument-motion-study button:active { background: var(--color-paper-3); }
    .instrument-motion-study button:focus-visible, .instrument-motion-study input:focus-visible { outline: 2px solid var(--color-cobalt); outline-offset: 3px; }
    .instrument-motion-study__quiet { display: flex; align-items: center; gap: .5rem; min-height: 2.75rem; margin-top: .5rem; }
    .instrument-motion-study__quiet input { accent-color: var(--color-cobalt); }
    .instrument-motion-study__note { margin-top: .5rem !important; color: var(--color-ink-light); font-size: .75rem; }
    @media (max-width: 25rem) { .instrument-motion-study__tool { padding: 1rem; } .instrument-motion-study__head { align-items: flex-start; gap: .75rem; } }
  `);
  return (
    <section class="instrument-motion-study" data-flow={props.flow}>
      <InstrumentMotion
        key={revision.value}
        state={state.value}
        quiet={quiet.value}
        class="instrument-motion-study__tool"
      >
        <header class="instrument-motion-study__head">
          <InstrumentArt kind="sentence-bench" size="compact" />
          <div>
            <h2>Sentence bench</h2>
            <p class="instrument-motion-study__hint">
              Compare a complete thought.
            </p>
          </div>
        </header>
        <InstrumentMotionPart
          part="source"
          class="instrument-motion-study__wording"
        >
          <span class="instrument-motion-study__label">Your sentence</span>
          <p>
            The river kept the light long after the windows of the town had gone
            dark.
          </p>
        </InstrumentMotionPart>
        <InstrumentMotionPart
          part="alternative"
          class="instrument-motion-study__wording"
        >
          <span class="instrument-motion-study__label">Put the town first</span>
          <p>
            Long after the town's windows went dark, the river still held the
            light.
          </p>
        </InstrumentMotionPart>
        <InstrumentMotionPart
          part="result"
          class="instrument-motion-study__result"
        >
          <InstrumentRule />
          <p>The second wording brings the contrast closer to the beginning.</p>
        </InstrumentMotionPart>
      </InstrumentMotion>
      <div
        class="instrument-motion-study__controls"
        aria-label="Replay a motion state"
      >
        {(
          [
            ["open", "Open bench"],
            ["compare", "Compare wording"],
            ["arrive", "Receive a result"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick$={() => {
              state.value = value;
              revision.value++;
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label class="instrument-motion-study__quiet">
        <input
          type="checkbox"
          checked={quiet.value}
          onChange$={(_, input) => (quiet.value = input.checked)}
        />
        Keep the instrument still while writing
      </label>
      <p class="instrument-motion-study__note" role="status">
        {quiet.value || props.flow === "flow"
          ? "Motion is quiet. The comparison stays available."
          : "Each action moves once, then rests."}
      </p>
      <p class="instrument-motion-study__note">
        This specimen replays component states. No manuscript is edited.
      </p>
    </section>
  );
});

const meta = {
  title: "Instruments/Meaningful motion",
  component: MotionStudy,
  parameters: { layout: "padded" },
  args: { initialState: "rest", quiet: false, flow: "working" },
} satisfies Meta<typeof MotionStudy>;
export default meta;
type Story = StoryObj<typeof MotionStudy>;

export const Interactive: Story = {};
export const Open: Story = { args: { initialState: "open" } };
export const Compare: Story = { args: { initialState: "compare" } };
export const ResultArrives: Story = { args: { initialState: "arrive" } };
export const QuietWhileWriting: Story = { args: { quiet: true } };
export const AutomaticFlow: Story = { args: { flow: "flow" } };
export const Nightpress: Story = { globals: { theme: "nightpress" } };
