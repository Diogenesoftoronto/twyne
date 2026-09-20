import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { UsageMetrics } from "../../utils/usage-summary";
import { DeskSummary } from "./desk-summary";

const metrics: UsageMetrics = {
  generations: 142,
  completedGenerations: 138,
  failedGenerations: 4,
  logicalActions: 96,
  completedActions: 94,
  failedActions: 2,
  actualCostMicrousd: 184_200,
  estimatedCostMicrousd: 201_500,
  localGenerations: 12,
  unknownCostGenerations: 1,
  creditMicrounits: 0,
  tokens: {
    inputTokens: 1_204_318,
    outputTokens: 96_442,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 1_300_760,
    coverage: {
      inputTokens: { reportedEvents: 138, missingEvents: 0 },
      outputTokens: { reportedEvents: 138, missingEvents: 0 },
      cacheReadTokens: { reportedEvents: 0, missingEvents: 0 },
      cacheWriteTokens: { reportedEvents: 0, missingEvents: 0 },
      reasoningTokens: { reportedEvents: 0, missingEvents: 0 },
      totalTokens: { reportedEvents: 138, missingEvents: 0 },
    },
    reportedTotalDiscrepancies: 0,
  },
};

const meta = {
  title: "Desk/DeskSummary",
  component: DeskSummary,
  args: {
    displayName: "A. Writer",
    signedIn: true,
    rangeLabel: "Last 30 days · all folios",
    writingDays: 21,
    folioCount: 6,
    metrics,
    sourceState: "combined",
    synchronized: {
      generations: 126,
      unknownCostGenerations: 1,
    },
  },
} satisfies Meta<typeof DeskSummary>;

export default meta;
type Story = StoryObj<typeof DeskSummary>;

export const Combined: Story = {};

export const LocalOnly: Story = {
  args: {
    signedIn: false,
    sourceState: "local",
    combined: false,
  },
};

export const Loading: Story = {
  args: { sourceState: "loading" },
};

export const Offline: Story = {
  args: { sourceState: "offline", signedIn: false },
};

export const Error: Story = {
  args: { sourceState: "error" },
};
