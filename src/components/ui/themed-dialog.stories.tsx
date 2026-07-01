import { $ } from "@builder.io/qwik";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ThemedDialog } from "./themed-dialog";

const meta = {
  title: "UI/ThemedDialog",
  component: ThemedDialog,
  args: {
    onCancel$: $(() => {}),
    onConfirm$: $(() => {}),
    onInput$: $(() => {}),
  },
} satisfies Meta<typeof ThemedDialog>;

export default meta;

type Story = StoryObj<typeof ThemedDialog>;

export const Default: Story = {
  args: {
    open: true,
    title: "Strike this note?",
    message: "This removes the editor's note from the margin.",
    confirmLabel: "Strike",
  },
};

export const Danger: Story = {
  args: {
    open: true,
    title: "Delete this draft?",
    message: "This can't be undone.",
    confirmLabel: "Delete",
    tone: "danger",
  },
};

export const WithInputAndError: Story = {
  args: {
    open: true,
    title: "Rename folio",
    message: "Pick a new title for this draft.",
    confirmLabel: "Save",
    inputLabel: "Title",
    inputValue: "Libraries as Civic Infrastructure",
    inputPlaceholder: "Untitled",
    inputHelp: "Visible to collaborators.",
    error: "That title is already in use.",
  },
};

export const Busy: Story = {
  args: {
    open: true,
    title: "Convening the room…",
    message: "Each editor is reading the draft.",
    confirmLabel: "Convene",
    busy: true,
  },
};
