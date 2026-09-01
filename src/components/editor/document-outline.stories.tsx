import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { buildDocumentOutline } from "../../utils/document-outline";
import { DocumentOutline } from "./document-outline";

const outline = buildDocumentOutline({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Libraries as civic infrastructure" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "The public room" }],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Who gets to stay" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Infrastructure beyond books" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "What cities should fund next" }],
    },
  ],
});

const meta = {
  title: "Editor/DocumentOutline",
  component: DocumentOutline,
  decorators: [
    (Story) => (
      <aside class="w-72 border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-3">
        {Story()}
      </aside>
    ),
  ],
  args: {
    outline,
    onNavigate$: $(() => {}),
  },
} satisfies Meta<typeof DocumentOutline>;

export default meta;
type Story = StoryObj<typeof DocumentOutline>;

export const Nested: Story = {};

export const ActiveSection: Story = {
  args: { activeId: "infrastructure-beyond-books" },
};

export const Empty: Story = {
  args: {
    outline: [],
    emptyLabel: "Use a heading style to start the document outline.",
  },
};
