import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ColorPicker } from "./color-picker";

const meta = {
  title: "UI/ColorPicker",
  component: ColorPicker,
  decorators: [(Story) => <div class="relative h-72 w-56">{Story()}</div>],
  args: {
    kind: "text",
    value: "#964f40",
    title: "Text colour",
    clearLabel: "Use default text colour",
    onPick$: $(() => {}),
    onClear$: $(() => {}),
    onClose$: $(() => {}),
  },
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof ColorPicker>;

export const TextColour: Story = {};

export const Highlight: Story = {
  args: {
    kind: "highlight",
    value: "#fbeaa8",
    title: "Highlight colour",
    clearLabel: "No highlight",
  },
};

export const AccentWithoutClear: Story = {
  args: {
    kind: "accent",
    value: "#c1272d",
    title: "Accent colour",
    onClear$: undefined,
  },
};
