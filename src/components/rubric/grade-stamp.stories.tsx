import type { Meta, StoryObj } from "storybook-framework-qwik";
import { GradeStamp } from "./grade-stamp";

const meta = {
  title: "Rubric/GradeStamp",
  component: GradeStamp,
  parameters: { layout: "centered" },
  args: {
    grade: "B+",
    score: 84,
    color: "var(--color-vermilion)",
  },
} satisfies Meta<typeof GradeStamp>;

export default meta;
type Story = StoryObj<typeof GradeStamp>;

export const Compact: Story = {};

export const Report: Story = {
  args: { size: "report", grade: "A-", score: 92 },
};

export const Revise: Story = {
  args: { grade: "C", score: 61 },
};

export const Animated: Story = {
  args: { animated: true, grade: "A", score: 96, size: "report" },
};
