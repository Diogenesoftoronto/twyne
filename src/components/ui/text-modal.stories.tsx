import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { TextModal } from "./text-modal";

const meta = {
  title: "UI/TextModal",
  component: TextModal,
  args: {
    open: true,
    kicker: "Insert",
    title: "Add a footnote",
    description: "The note will appear at the current cursor position.",
    inputLabel: "Footnote text",
    placeholder: "Source, context, or qualification…",
    helpText: "Press Ctrl or Command + Enter to insert.",
    submitLabel: "Insert footnote",
    onCancel$: $(() => {}),
    onConfirm$: $(() => {}),
  },
} satisfies Meta<typeof TextModal>;

export default meta;
type Story = StoryObj<typeof TextModal>;

export const Empty: Story = {};

export const WithDraft: Story = {
  args: {
    initialValue:
      "Statistics Canada, “Canadian Internet Use Survey,” table 22-10-0137-01.",
  },
};

export const LargeSourceEditor: Story = {
  args: {
    kicker: "Insert",
    title: "Add a diagram",
    description: "Paste Mermaid source to render a diagram in the manuscript.",
    inputLabel: "Mermaid source",
    initialValue: "flowchart LR\n  Draft --> Review\n  Review --> Revision",
    helpText: "Use Mermaid flowchart, sequence, or state-diagram syntax.",
    rows: 10,
    minHeightRem: 16,
    submitLabel: "Insert diagram",
  },
};

export const SubmitDisabled: Story = {
  args: {
    initialValue: "A note that still needs a source.",
    submitDisabled: true,
  },
};
