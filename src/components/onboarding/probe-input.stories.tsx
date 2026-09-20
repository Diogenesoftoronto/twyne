import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ProbeInput } from "./probe-input";

const meta = {
  title: "Onboarding/ProbeInput",
  component: ProbeInput,
  decorators: [
    (Story) => <div class="w-[36rem] max-w-[calc(100vw-2rem)]">{Story()}</div>,
  ],
  args: {
    probe: {
      id: "probe-1",
      kind: "choice",
      prompt: "Which case should carry the argument?",
      options: ["Public health", "Workforce access", "Social connection"],
      relatesTo: "goal",
    },
    onAnswer$: $(() => {}),
    onSkip$: $(() => {}),
  },
} satisfies Meta<typeof ProbeInput>;

export default meta;
type Story = StoryObj<typeof ProbeInput>;

export const SingleChoice: Story = {};

export const ChoiceAnswered: Story = {
  args: {
    probe: {
      id: "probe-1",
      kind: "choice",
      prompt: "Which case should carry the argument?",
      options: ["Public health", "Workforce access", "Social connection"],
      answer: "Social connection",
      relatesTo: "goal",
    },
  },
};

export const Scale: Story = {
  args: {
    probe: {
      id: "probe-2",
      kind: "scale",
      prompt: "How forceful should the policy recommendation be?",
      min: 1,
      max: 5,
      minLabel: "Suggestive",
      maxLabel: "Prescriptive",
      relatesTo: "tone",
    },
  },
};

export const MultiSelect: Story = {
  args: {
    probe: {
      id: "probe-3",
      kind: "multi",
      prompt: "Which threads must survive the cut?",
      options: ["Branch hours", "Hold queues", "Meeting rooms", "Archives"],
      answer: ["Branch hours", "Archives"],
      relatesTo: "constraints",
    },
  },
};

export const FillBlanks: Story = {
  args: {
    probe: {
      id: "probe-4",
      kind: "blanks",
      prompt: "Finish the reader's takeaway.",
      template: "The reader should leave ___ and do ___.",
      relatesTo: "successSignal",
    },
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
