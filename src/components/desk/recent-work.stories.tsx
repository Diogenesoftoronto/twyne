import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { RecentWorkEntry } from "../../utils/usage-summary";
import { RecentWork } from "./recent-work";

const entries: RecentWorkEntry[] = [
  {
    folioId: "folio-libraries",
    lastActiveAt: Date.UTC(2026, 8, 17, 14, 30),
    currentWords: 8421,
    activeDays: 14,
    editorialActions: 38,
    actualCostMicrousd: 92_100,
    estimatedCostMicrousd: 98_400,
  },
  {
    folioId: "folio-harbour",
    lastActiveAt: Date.UTC(2026, 8, 11, 9, 5),
    currentWords: 2310,
    activeDays: 5,
    editorialActions: 11,
    actualCostMicrousd: 12_300,
    estimatedCostMicrousd: 12_300,
  },
  {
    folioId: "folio-unfiled",
    lastActiveAt: Date.UTC(2026, 7, 28, 20, 44),
    currentWords: 412,
    activeDays: 2,
    editorialActions: 3,
    actualCostMicrousd: 1_800,
    estimatedCostMicrousd: 2_100,
  },
];

const meta = {
  title: "Desk/RecentWork",
  component: RecentWork,
  args: {
    entries,
    folioTitles: {
      "folio-libraries": "Libraries as Civic Infrastructure",
      "folio-harbour": "Winter Harbour",
    },
  },
} satisfies Meta<typeof RecentWork>;

export default meta;
type Story = StoryObj<typeof RecentWork>;

export const WithEntries: Story = {};

export const Empty: Story = {
  args: { entries: [], folioTitles: {} },
};
