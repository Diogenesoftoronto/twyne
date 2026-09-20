import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { ShortcutDialog } from "./shortcut-dialog";

const meta = {
  title: "Editor/ShortcutDialog",
  component: ShortcutDialog,
  args: {
    open: true,
    platform: "windows",
    onClose$: $(() => {}),
  },
} satisfies Meta<typeof ShortcutDialog>;

export default meta;
type Story = StoryObj<typeof ShortcutDialog>;

export const Windows: Story = {};

export const Linux: Story = {
  args: { platform: "linux" },
};

export const Mac: Story = {
  args: { platform: "mac" },
};

export const Closed: Story = {
  args: { open: false },
};
