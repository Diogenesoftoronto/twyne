import { component$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { buildSpanIndex, proposeThreadPairs } from "../../utils/span-index";
import {
  ruleThreads,
  type ThreadInstrumentSnapshot,
} from "../../utils/thread-instrument";
import { ThreadsInstrument } from "./thread-instrument";
const index = buildSpanIndex([
  {
    from: 0,
    text: "The ledger held every name we remembered. This was our only trace. The ledger held every name we remembered.",
  },
]);
const fixture: ThreadInstrumentSnapshot = {
  open: true,
  index,
  threads: ruleThreads(index, proposeThreadPairs(index)),
  status: "ready",
  stale: false,
};
const Preview = component$<{ fixture: ThreadInstrumentSnapshot }>(
  ({ fixture }) => (
    <main style="padding:2rem;background:var(--color-paper-2);min-height:100dvh">
      <ThreadsInstrument fixture={fixture} />
    </main>
  ),
);
const meta = {
  title: "Writing instruments/Threads",
  component: Preview,
  parameters: { layout: "fullscreen" },
  args: { fixture },
} satisfies Meta<{ fixture: ThreadInstrumentSnapshot }>;
export default meta;
type Story = StoryObj<{ fixture: ThreadInstrumentSnapshot }>;
export const RulePairs: Story = {};
export const Stale: Story = {
  args: {
    fixture: {
      ...fixture,
      stale: true,
      notice: "The manuscript changed. Reopen Threads to check these spans.",
    },
  },
};
