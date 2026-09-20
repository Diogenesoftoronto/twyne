import type { Meta, StoryObj } from "storybook-framework-qwik";
import type {
  DailyUsagePoint,
  WritingHeatmapDay,
} from "../../utils/usage-summary";
import { WritingActivity } from "./writing-activity";
import { storyMetrics } from "./story-fixtures";

const NOW = Date.UTC(2026, 8, 18, 12, 0);

const days: WritingHeatmapDay[] = Array.from({ length: 60 }, (_, i) => {
  const date = new Date(NOW - i * 24 * 60 * 60 * 1000);
  return {
    day: date.toISOString().slice(0, 10),
    count: (i * 5 + 2) % 7,
    detailedCount: (i * 5 + 2) % 7,
    legacyCount: 0,
    detailComplete: true,
    folios: [],
  };
});

const daily: DailyUsagePoint[] = days.slice(0, 14).map((entry, index) => ({
  ...storyMetrics({ logicalActions: (index * 3) % 11 }),
  day: entry.day,
  writingCount: (index * 521) % 2400,
}));

const meta = {
  title: "Desk/WritingActivity",
  component: WritingActivity,
  args: {
    days,
    daily,
    folioTitles: { "folio-libraries": "Libraries as Civic Infrastructure" },
    windowLabel: "Last 60 days",
  },
} satisfies Meta<typeof WritingActivity>;

export default meta;
type Story = StoryObj<typeof WritingActivity>;

export const WithActivity: Story = {};

export const Empty: Story = {
  args: { days: [], daily: [], folioTitles: {} },
};
