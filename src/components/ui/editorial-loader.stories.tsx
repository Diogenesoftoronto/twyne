import type { Meta, StoryObj } from "storybook-framework-qwik";
import { PERSONAS } from "../../utils/personas";
import { EditorialLoader } from "./editorial-loader";

const meta = {
  title: "UI/EditorialLoader",
  component: EditorialLoader,
  parameters: { layout: "centered" },
  args: {
    personas: PERSONAS,
    label: "The room is reading",
  },
} satisfies Meta<typeof EditorialLoader>;

export default meta;
type Story = StoryObj<typeof EditorialLoader>;

export const FullRoom: Story = {};

export const Compact: Story = {
  args: {
    compact: true,
    personas: PERSONAS.slice(0, 2),
    label: "Convening two editors",
  },
};

export const PressroomFallback: Story = {
  args: {
    personas: [],
    label: "Preparing the proof",
  },
};
