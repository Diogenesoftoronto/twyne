import type { Meta, StoryObj } from "storybook-framework-qwik";
import { WritingHeatmap, type ActivityDay } from "./writing-heatmap";

/** Fixed "today" so the stories don't drift with the calendar. */
const NOW = Date.UTC(2026, 8, 18, 12, 0);

function daysAround(counts: Record<number, number>): ActivityDay[] {
  return Object.entries(counts).map(([ago, count]) => {
    const date = new Date(NOW - Number(ago) * 24 * 60 * 60 * 1000);
    return { day: date.toISOString().slice(0, 10), count };
  });
}

const activeYear: ActivityDay[] = Array.from({ length: 200 }, (_, i) => {
  const date = new Date(NOW - i * 24 * 60 * 60 * 1000);
  return {
    day: date.toISOString().slice(0, 10),
    count: (i * 7 + 3) % 9,
  };
});

const meta = {
  title: "Profile/WritingHeatmap",
  component: WritingHeatmap,
  args: {
    days: activeYear,
    now: NOW,
    onSelectDay$: undefined,
  },
} satisfies Meta<typeof WritingHeatmap>;

export default meta;
type Story = StoryObj<typeof WritingHeatmap>;

export const ActiveYear: Story = {};

export const Sparse: Story = {
  args: {
    days: daysAround({ 2: 1, 9: 4, 30: 2, 120: 7, 300: 1 }),
  },
};

export const Empty: Story = {
  args: { days: [] },
};

export const WithSelection: Story = {
  args: {
    days: daysAround({ 1: 3, 2: 5, 5: 1 }),
    selectedDay: new Date(NOW - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  },
};
