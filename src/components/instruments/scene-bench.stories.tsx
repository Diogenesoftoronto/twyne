import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import {
  createSceneInventory,
  SCENE_DIMENSIONS,
  SCENE_TENSION_OPTIONS,
} from "../../utils/scene-bench";
import { SceneBench } from "./scene-bench";

const passage = {
  id: "storybook-scene-river",
  sourceOffset: 0,
  text: "At dusk, Mara crossed the kitchen. The lamp above the doorway flickered. She heard footsteps stop outside. She needed the letter before morning, but the drawer was locked.",
};
const meta = {
  title: "Instruments/Scene bench",
  component: SceneBench,
  parameters: { layout: "padded" },
  args: { passage },
} satisfies Meta<typeof SceneBench>;
export default meta;
type Story = StoryObj<typeof SceneBench>;

export const Offline: Story = {};
export const Unspecified: Story = {
  args: {
    passage: {
      ...passage,
      id: "storybook-scene-unspecified",
      text: "She understood. Nothing changed.",
    },
  },
};
export const Empty: Story = { args: { passage: { ...passage, text: "" } } };
export const LongSelection: Story = {
  args: { passage: { ...passage, text: "Mara crossed the room. ".repeat(65) } },
};
export const Nightpress: Story = { globals: { theme: "nightpress" } };
export const Quiet: Story = { args: { quiet: true } };
export const ModelUnavailable: Story = {
  args: {
    judgement: {
      available: false,
      destination: "",
      costLabel: "",
      unavailableReason:
        "Your selected model is unavailable. Nothing has been sent.",
    },
  },
};
export const ModelSpecimen: Story = {
  args: {
    judgement: {
      available: true,
      destination: "a local Storybook fixture",
      costLabel: "No provider request or charge. This is a response specimen.",
    },
    onJudge$: $(async () => {
      const inventory = createSceneInventory(passage);
      const options = ["none", ...inventory.spans.map((span) => span.id)];
      const pick = (selected: string, choices: readonly string[]) => ({
        type: "choice",
        choice: selected,
        confidence: 0.9,
        probabilities: Object.fromEntries(
          choices.map((key) => [
            key,
            key === selected ? 0.9 : 0.1 / (choices.length - 1),
          ]),
        ),
      });
      return {
        ok: true,
        model: "Storybook specimen (not live)",
        transport: "none" as const,
        answers: {
          ...Object.fromEntries(
            SCENE_DIMENSIONS.map(({ id }) => [
              id,
              pick(inventory.dimensions[id][0]?.spanId ?? "none", options),
            ]),
          ),
          tensionLevel: pick("under-pressure", SCENE_TENSION_OPTIONS),
        },
      };
    }),
  },
};
