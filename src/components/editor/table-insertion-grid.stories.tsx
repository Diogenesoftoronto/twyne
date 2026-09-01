import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { TableInsertionGrid } from "./table-insertion-grid";

const meta = {
  title: "Editor/TableInsertionGrid",
  component: TableInsertionGrid,
  parameters: { layout: "centered" },
  args: {
    onInsert$: $(() => {}),
    onCancel$: $(() => {}),
  },
} satisfies Meta<typeof TableInsertionGrid>;

export default meta;
type Story = StoryObj<typeof TableInsertionGrid>;

export const Default: Story = {};

export const Compact: Story = {
  args: {
    maxRows: 4,
    maxColumns: 5,
  },
};

export const WithoutHeaderRow: Story = {
  args: {
    maxRows: 6,
    maxColumns: 8,
    withHeaderRow: false,
  },
};

export const MaximumColumns: Story = {
  args: {
    maxRows: 5,
    maxColumns: 12,
  },
};
