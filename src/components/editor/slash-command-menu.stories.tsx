import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { SlashCommandMenu } from "./slash-command-menu";

const meta = {
  title: "Editor/SlashCommandMenu",
  component: SlashCommandMenu,
  args: {
    open: true,
    query: "",
    left: 240,
    top: 200,
    onSelect$: $(() => {}),
    onClose$: $(() => {}),
  },
} satisfies Meta<typeof SlashCommandMenu>;

export default meta;
type Story = StoryObj<typeof SlashCommandMenu>;

export const AllCommands: Story = {};

export const Filtered: Story = {
  args: { query: "diagram" },
};

export const NoMatch: Story = {
  args: { query: "xyznothing" },
};

export const Closed: Story = {
  args: { open: false },
};
