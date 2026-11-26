import type { Meta, StoryObj } from "storybook-framework-qwik";
import { EditorLoadingScreen } from "./editor-loading-screen";

const meta = {
  title: "Editor/LoadingScreen",
  component: EditorLoadingScreen,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditorLoadingScreen>;

export default meta;
type Story = StoryObj<typeof EditorLoadingScreen>;

export const OpeningManuscript: Story = {};

export const SmallPhone: Story = {
  globals: { viewport: { value: "compactPhone", isRotated: false } },
};
