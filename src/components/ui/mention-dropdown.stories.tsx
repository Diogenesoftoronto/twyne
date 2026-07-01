import { $ } from "@builder.io/qwik";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { MentionDropdown } from "./mention-dropdown";
import type { Mentionable } from "../../utils/mentions";

const personas: Mentionable[] = [
  { id: "reader", name: "Reader", kind: "persona", icon: "👁", color: "#2563eb" },
  { id: "editor", name: "Editor", kind: "persona", icon: "✎", color: "#b45309" },
  { id: "devil", name: "Devil's Advocate", kind: "persona", icon: "🜂", color: "#b91c1c" },
];

const personasAndCollaborators: Mentionable[] = [
  ...personas,
  { id: "ally", name: "Ally Reyes", kind: "collaborator" },
];

const meta = {
  title: "UI/MentionDropdown",
  component: MentionDropdown,
  args: {
    onSelect$: $(() => {}),
  },
} satisfies Meta<typeof MentionDropdown>;

export default meta;

type Story = StoryObj<typeof MentionDropdown>;

export const PersonasOnly: Story = {
  args: {
    items: personas,
    query: "",
  },
};

export const FilteredQuery: Story = {
  args: {
    items: personas,
    query: "e",
  },
};

/**
 * Once collaborators are wired into a panel's `mentionables` list, they show
 * up in the same dropdown with a small "collaborator" tag — no component
 * changes needed.
 */
export const WithCollaborators: Story = {
  args: {
    items: personasAndCollaborators,
    query: "",
  },
};

export const NoMatches: Story = {
  args: {
    items: personas,
    query: "zzz",
  },
};
