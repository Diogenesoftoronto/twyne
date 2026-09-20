import type { Meta, StoryObj } from "storybook-framework-qwik";
import {
  BriefPlatePreview,
  DraftPlatePreview,
  NotesPlatePreview,
  SourcesPlatePreview,
} from "./plate-previews";

const meta = {
  title: "Landing/PlatePreviews",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Brief: Story = {
  render: () => (
    <div class="w-[26rem] max-w-[calc(100vw-2rem)] border border-[var(--color-paper-3)]">
      <BriefPlatePreview />
    </div>
  ),
};

export const Draft: Story = {
  render: () => (
    <div class="w-[38rem] max-w-[calc(100vw-2rem)] border border-[var(--color-paper-3)]">
      <DraftPlatePreview />
    </div>
  ),
};

export const Notes: Story = {
  render: () => (
    <div class="w-[26rem] max-w-[calc(100vw-2rem)] border border-[var(--color-paper-3)]">
      <NotesPlatePreview />
    </div>
  ),
};

export const Sources: Story = {
  render: () => (
    <div class="w-[38rem] max-w-[calc(100vw-2rem)] border border-[var(--color-paper-3)]">
      <SourcesPlatePreview />
    </div>
  ),
};
