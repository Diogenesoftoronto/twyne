import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { TwyneIconName } from "../../utils/icon-system";
import { Icon } from "./icon";

const NAMES: TwyneIconName[] = [
  "add",
  "align-horizontal-spacing",
  "arrow-down",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "code",
  "comment-add",
  "diagram",
  "file-check",
  "fullscreen",
  "grid",
  "history",
  "image",
  "keyboard",
  "layout",
  "link",
  "link-broken",
  "list",
  "section-divider",
  "ordered-list",
  "page",
  "quote",
  "redo",
  "row-horizontal",
  "row-vertical",
  "checklist",
  "search",
  "text-align-center",
  "text-align-justify",
  "text-align-left",
  "text-align-right",
  "trash",
  "undo",
  "unordered-list",
  "command",
  "grid-2",
  "browser-terminal",
  "iphone",
  "devices",
];

const meta = {
  title: "UI/Icon",
  component: Icon,
  parameters: { layout: "centered" },
  args: { name: "diagram", size: 20 },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof Icon>;

export const Single: Story = {};

export const Catalogue: Story = {
  render: () => (
    <ul style="display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: 0.5rem; max-width: 56rem; list-style: none; padding: 0;">
      {NAMES.map((name) => (
        <li
          key={name}
          style="display: flex; flex-direction: column; align-items: center; gap: 0.35rem; border: 1px solid var(--color-paper-3); border-radius: 3px; padding: 0.75rem 0.25rem; background: var(--color-paper);"
        >
          <Icon name={name} size={20} />
          <code style="font-size: 0.62rem; text-align: center; overflow-wrap: anywhere;">
            {name}
          </code>
        </li>
      ))}
    </ul>
  ),
};
