import type { Meta, StoryObj } from "storybook-framework-qwik";
import { EditorialActivity } from "./editorial-activity";

const meta = {
  title: "UI/Editorial activity",
  component: EditorialActivity,
  parameters: { layout: "centered" },
  args: { label: "Mlle. Sceptique is replying" },
} satisfies Meta<typeof EditorialActivity>;
export default meta;
type Story = StoryObj<typeof EditorialActivity>;
export const Writing: Story = {};
export const Reading: Story = {
  args: { kind: "reading", label: "Reading the passage…" },
};
export const Searching: Story = {
  args: { kind: "searching", label: "Checking sources…" },
};
export const Saving: Story = {
  args: { kind: "saving", label: "Filing the source…" },
};
export const Ready: Story = { args: { kind: "ready", label: "Source filed" } };
export const IconOnly: Story = {
  args: { kind: "searching", label: "Searching", iconOnly: true },
};
