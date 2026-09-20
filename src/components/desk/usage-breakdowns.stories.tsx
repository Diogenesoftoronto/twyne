import type { Meta, StoryObj } from "storybook-framework-qwik";
import type {
  FeatureBreakdownEntry,
  ProviderBreakdownEntry,
} from "../../utils/usage-summary";
import { UsageBreakdowns } from "./usage-breakdowns";
import { storyMetrics } from "./story-fixtures";

const features: FeatureBreakdownEntry[] = [
  { ...storyMetrics({ logicalActions: 61 }), feature: "room" },
  { ...storyMetrics({ logicalActions: 22 }), feature: "rubric" },
  { ...storyMetrics({ logicalActions: 13 }), feature: "research" },
];

const providers: ProviderBreakdownEntry[] = [
  {
    ...storyMetrics({ logicalActions: 74 }),
    provider: "provider-a",
    models: [
      { ...storyMetrics({ logicalActions: 50 }), model: "writer-large" },
      { ...storyMetrics({ logicalActions: 24 }), model: "writer-small" },
    ],
  },
  {
    ...storyMetrics({ logicalActions: 22 }),
    provider: "provider-b",
    models: [{ ...storyMetrics({ logicalActions: 22 }), model: "reasoner-1" }],
  },
];

const meta = {
  title: "Desk/UsageBreakdowns",
  component: UsageBreakdowns,
  args: { kind: "features", features, providers },
} satisfies Meta<typeof UsageBreakdowns>;

export default meta;
type Story = StoryObj<typeof UsageBreakdowns>;

export const ByFeature: Story = {};

export const ByProvider: Story = {
  args: { kind: "models" },
};
