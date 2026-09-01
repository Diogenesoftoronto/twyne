import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { SiteSelect, type SiteSelectOption } from "./site-select";

const writingFormats: SiteSelectOption[] = [
  {
    value: "essay",
    label: "Essay",
    description: "Argument-led long-form prose",
  },
  {
    value: "feature",
    label: "Magazine feature",
    description: "Reported narrative with scenes and sources",
  },
  {
    value: "brief",
    label: "Research brief",
    description: "Compact findings and recommendations",
  },
];

const meta = {
  title: "UI/SiteSelect",
  component: SiteSelect,
  parameters: { layout: "centered" },
  args: {
    value: "essay",
    options: writingFormats,
    ariaLabel: "Writing format",
    onChange$: $(() => {}),
  },
} satisfies Meta<typeof SiteSelect>;

export default meta;
type Story = StoryObj<typeof SiteSelect>;

export const Default: Story = {};

export const SelectedWithDescription: Story = {
  args: { value: "feature" },
};

export const LongLabels: Story = {
  args: {
    value: "investigation",
    options: [
      {
        value: "investigation",
        label: "Long-form investigative feature",
        description: "Evidence-heavy reporting for a general readership",
      },
      ...writingFormats,
    ],
  },
};

export const Empty: Story = {
  args: { value: "", options: [] },
};

export const Disabled: Story = {
  args: { disabled: true },
};
