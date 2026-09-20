import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { InsertPanels } from "./insert-panels";

const callbacks = {
  onCancelNote$: $(() => {}),
  onConfirmNote$: $(() => {}),
  onCancelMermaid$: $(() => {}),
  onConfirmMermaid$: $(() => {}),
  onChooseImage$: $(() => {}),
  onImageUrlChange$: $(() => {}),
  onInsertImage$: $(() => {}),
  onCancelImage$: $(() => {}),
};

const meta = {
  title: "Editor/InsertPanels",
  component: InsertPanels,
  args: {
    noteKind: null,
    mermaidOpen: true,
    imageOpen: false,
    imageUrl: "",
    imageUploadAvailable: true,
    imageUploadError: null,
    ...callbacks,
  },
} satisfies Meta<typeof InsertPanels>;

export default meta;
type Story = StoryObj<typeof InsertPanels>;

/**
 * Mermaid dialog with the live side-by-side diagram preview.
 * Starts empty in the story — type to see the preview render.
 */
export const DiagramModal: Story = {};

export const FootnoteModal: Story = {
  args: { mermaidOpen: false, noteKind: "footnote" },
};

export const EndnoteModal: Story = {
  args: { mermaidOpen: false, noteKind: "endnote" },
};

export const ImageBar: Story = {
  args: {
    mermaidOpen: false,
    imageOpen: true,
    imageUrl: "https://example.com/plate.jpg",
  },
};

export const ImageUploadUnavailable: Story = {
  args: {
    mermaidOpen: false,
    imageOpen: true,
    imageUploadAvailable: false,
    imageUploadError: "Image storage is not connected yet.",
  },
};

export const AllClosed: Story = {
  args: { mermaidOpen: false },
};
