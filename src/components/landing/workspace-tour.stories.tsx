import type { Meta, StoryObj } from "storybook-framework-qwik";
import { WorkspaceTour } from "./workspace-tour";

/**
 * The guided room tour: pulsing hotspots over each part of the workspace
 * preview, and a reader card below that transitions between stops. The tour
 * advances itself until the visitor takes over; every stop is also a story.
 */
const meta = {
  title: "Landing/WorkspaceTour",
  component: WorkspaceTour,
  decorators: [
    (Story) => (
      <div class="w-[56rem] max-w-[calc(100vw-2rem)]">
        <div style={{ height: "min(80vh, 800px)" }}>{Story()}</div>
      </div>
    ),
  ],
  argTypes: {
    initialStopId: {
      control: "select",
      options: [
        "dossier",
        "folios",
        "manuscript",
        "cast",
        "rubric",
        "marginalia",
        "apparatus",
        "versions",
      ],
    },
  },
} satisfies Meta<typeof WorkspaceTour>;

export default meta;
type Story = StoryObj<typeof WorkspaceTour>;

/** The tour opens on the dossier. */
export const Default: Story = {};

/** The tour opens mid-loop on the rubric stop. */
export const RubricStop: Story = {
  args: { initialStopId: "rubric" },
};

/** The tour opens on the folios stop, with the research notes showing. */
export const FoliosStop: Story = {
  args: { initialStopId: "folios" },
};
