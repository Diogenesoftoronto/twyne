import type { Meta, StoryObj } from "storybook-framework-qwik";
import { keybindingList } from "../../utils/keybindings";
import { KeybindingList } from "./keybinding-list";

const meta = {
  title: "Editor/KeybindingList",
  component: KeybindingList,
  decorators: [
    (Story) => (
      <div class="w-[34rem] max-w-[calc(100vw-2rem)] border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-4">
        {Story()}
      </div>
    ),
  ],
  args: {
    entries: keybindingList("windows"),
  },
} satisfies Meta<typeof KeybindingList>;

export default meta;
type Story = StoryObj<typeof KeybindingList>;

export const Windows: Story = {};

export const Linux: Story = {
  args: { entries: keybindingList("linux") },
};

export const Mac: Story = {
  args: { entries: keybindingList("mac") },
};

export const Empty: Story = {
  args: { entries: [], emptyLabel: "No shortcuts match this search." },
};
