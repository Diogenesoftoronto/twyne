import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { NumericStepper } from "./numeric-stepper";

const meta = {
  title: "UI/NumericStepper",
  component: NumericStepper,
  parameters: { layout: "centered" },
  args: {
    ariaLabel: "Page margin",
    value: 1,
    min: 0.5,
    max: 3,
    step: 0.25,
    suffix: "in",
    onValue$: $(() => {}),
    onCommit$: $(() => {}),
  },
} satisfies Meta<typeof NumericStepper>;

export default meta;
type Story = StoryObj<typeof NumericStepper>;

export const Default: Story = {};

export const Compact: Story = {
  args: {
    ariaLabel: "Table border width",
    value: 2,
    min: 0,
    max: 8,
    step: 1,
    suffix: "px",
    density: "compact",
  },
};

export const Empty: Story = {
  args: {
    value: null,
    placeholder: "Auto",
    emptyValue: 1,
  },
};

export const AtMinimum: Story = {
  args: { value: 0.5 },
};

export const AtMaximum: Story = {
  args: { value: 3 },
};

export const Disabled: Story = {
  args: { disabled: true },
};
