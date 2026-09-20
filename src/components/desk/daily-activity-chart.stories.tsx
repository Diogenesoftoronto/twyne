import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { DailyUsagePoint } from "../../utils/usage-summary";
import { DailyActivityChart } from "./daily-activity-chart";
import { storyMetrics } from "./story-fixtures";

const points: DailyUsagePoint[] = [16, 17, 18].map((day, index) => ({
  ...storyMetrics({
    generations: 4 + index * 3,
    logicalActions: 2 + index * 4,
    actualCostMicrousd: 12_000 * (index + 1),
  }),
  day: `2026-09-${day}`,
  writingCount: [840, 2130, 1240][index],
}));

const meta = {
  title: "Desk/DailyActivityChart",
  component: DailyActivityChart,
  args: { points },
} satisfies Meta<typeof DailyActivityChart>;

export default meta;
type Story = StoryObj<typeof DailyActivityChart>;

export const WithPoints: Story = {};

export const Empty: Story = {
  args: { points: [] },
};
