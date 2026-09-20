import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { ModelsDevModel } from "../../utils/models-dev";
import { SearchableModelSelect } from "./searchable-model-select";

const models: ModelsDevModel[] = [
  {
    id: "provider-a/writer-large",
    name: "Writer Large",
    family: "provider-a",
    toolCall: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: "provider-a/writer-small",
    name: "Writer Small",
    family: "provider-a",
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: "provider-b/reasoner-1",
    name: "Reasoner 1",
    family: "provider-b",
    reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
];

const meta = {
  title: "UI/SearchableModelSelect",
  component: SearchableModelSelect,
  decorators: [
    (Story) => <div class="w-96 max-w-[calc(100vw-2rem)]">{Story()}</div>,
  ],
  args: {
    value: "",
    models,
    onSelect$: $(() => {}),
    placeholder: "Search models…",
  },
} satisfies Meta<typeof SearchableModelSelect>;

export default meta;
type Story = StoryObj<typeof SearchableModelSelect>;

export const Empty: Story = {};

export const WithValue: Story = {
  args: { value: "provider-a/writer-large" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
