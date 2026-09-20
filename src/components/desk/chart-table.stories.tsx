import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ChartTable } from "./chart-table";

const meta = {
  title: "Desk/ChartTable",
  component: ChartTable,
  args: {
    caption: "Daily activity",
    columns: [
      { key: "day", label: "Day" },
      { key: "words", label: "Words" },
      { key: "actions", label: "Actions" },
    ],
    rows: [
      { key: "2026-09-16", cells: { day: "Sep 16", words: 1240, actions: 9 } },
      { key: "2026-09-17", cells: { day: "Sep 17", words: 860, actions: 4 } },
      { key: "2026-09-18", cells: { day: "Sep 18", words: 2130, actions: 12 } },
    ],
  },
} satisfies Meta<typeof ChartTable>;

export default meta;
type Story = StoryObj<typeof ChartTable>;

export const Collapsed: Story = {};

export const Open: Story = {
  args: { open: true },
};
