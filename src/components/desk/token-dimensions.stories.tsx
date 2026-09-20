import type { Meta, StoryObj } from "storybook-framework-qwik";
import { TokenDimensions } from "./token-dimensions";
import { storyTokens } from "./story-fixtures";

const meta = {
  title: "Desk/TokenDimensions",
  component: TokenDimensions,
  args: { tokens: storyTokens() },
} satisfies Meta<typeof TokenDimensions>;

export default meta;
type Story = StoryObj<typeof TokenDimensions>;

export const Reported: Story = {};

export const NoCoverage: Story = {
  args: {
    tokens: {
      ...storyTokens(),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      coverage: {
        inputTokens: { reportedEvents: 0, missingEvents: 3 },
        outputTokens: { reportedEvents: 0, missingEvents: 3 },
        cacheReadTokens: { reportedEvents: 0, missingEvents: 0 },
        cacheWriteTokens: { reportedEvents: 0, missingEvents: 0 },
        reasoningTokens: { reportedEvents: 0, missingEvents: 0 },
        totalTokens: { reportedEvents: 0, missingEvents: 3 },
      },
    },
  },
};
