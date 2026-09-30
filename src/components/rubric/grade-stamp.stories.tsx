import { component$, useSignal } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { GradeStamp } from "./grade-stamp";
import { WorkflowStamp } from "../ui/workflow-stamp";

const VerdictPreview = component$(() => {
  const verdict = useSignal(0);
  const unrelated = useSignal(0);
  return (
    <div class="paper-sheet p-8" style="width: min(28rem, 90vw)">
      <div class="rubric-proof flex items-center gap-3 px-4 py-3">
        <GradeStamp
          grade="A-"
          score={92}
          color="var(--color-vermilion)"
          animated={verdict.value > 0}
          impressionKey={verdict.value}
        />
        <div>
          <p class="text-2xl" style="font-family: var(--font-display)">
            92 <span class="text-sm">/ 100</span>
          </p>
          <p class="text-sm">Your argument holds together.</p>
        </div>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <button class="btn-press" onClick$={() => verdict.value++}>
          Grade this draft
        </button>
        <button class="btn-paper" onClick$={() => unrelated.value++}>
          Update detail ({unrelated.value})
        </button>
      </div>
    </div>
  );
});

const StampCollection = component$(() => {
  const replay = useSignal(0);
  return (
    <div class="paper-sheet p-8" style="max-width: 64rem;">
      <button class="btn-paper mb-8" onClick$={() => replay.value++}>
        Replay impressions
      </button>
      <div class="flex flex-wrap gap-12">
        {[
          "A+",
          "A",
          "A-",
          "B+",
          "B",
          "B-",
          "C+",
          "C",
          "C-",
          "D+",
          "D",
          "D-",
          "F",
        ].map((grade) => (
          <div
            key={`${grade}-${replay.value}`}
            class="flex flex-col items-center gap-4"
          >
            <GradeStamp
              grade={grade}
              score={grade === "A+" ? 98 : 80}
              color={
                grade.startsWith("A")
                  ? "#9c6c16"
                  : grade.startsWith("B")
                    ? "#207c73"
                    : "var(--color-vermilion)"
              }
              size="report"
              animated
            />
            <span>{grade}</span>
          </div>
        ))}
      </div>
      <div key={`workflow-${replay.value}`} class="mt-12 flex flex-wrap gap-8">
        <WorkflowStamp kind="filed" />
        <WorkflowStamp kind="revised" />
      </div>
    </div>
  );
});

export default {
  title: "Rubric/GradeStamp",
  component: GradeStamp,
  parameters: { layout: "centered" },
  args: { grade: "B+", score: 84, color: "var(--color-vermilion)" },
} satisfies Meta<typeof GradeStamp>;
type Story = StoryObj<typeof GradeStamp>;
export const Compact: Story = {};
export const Report: Story = {
  args: { size: "report", grade: "A-", score: 92 },
};
export const Revise: Story = { args: { grade: "C", score: 61 } };
export const Animated: Story = {
  args: { animated: true, grade: "A", score: 96, size: "report" },
};
export const AllImpressions: Story = { render: () => <StampCollection /> };
export const NewVerdict: Story = { render: () => <VerdictPreview /> };
export const HighestGrade: Story = {
  args: {
    grade: "A+",
    score: 98,
    color: "#9c6c16",
    size: "report",
    animated: true,
  },
};
export const GradeA: Story = {
  args: {
    grade: "A",
    score: 92,
    color: "#9c6c16",
    size: "report",
    animated: true,
  },
};
export const GradeB: Story = {
  args: {
    grade: "B",
    score: 82,
    color: "#207c73",
    size: "report",
    animated: true,
  },
};
