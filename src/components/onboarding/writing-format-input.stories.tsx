import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { WritingFormatInput } from "./writing-format-input";

const meta = {
  title: "Onboarding/WritingFormatInput",
  component: WritingFormatInput,
  decorators: [
    (Story) => <div class="w-[30rem] max-w-[calc(100vw-2rem)]">{Story()}</div>,
  ],
  args: {
    value: "",
    onValueChange$: $(() => {}),
    onCommit$: $(() => {}),
    labelledBy: "format-label",
    describedBy: "format-help",
  },
} satisfies Meta<typeof WritingFormatInput>;

export default meta;
type Story = StoryObj<typeof WritingFormatInput>;

export const Empty: Story = {};

export const Filled: Story = {
  args: { value: "Magazine feature" },
};
