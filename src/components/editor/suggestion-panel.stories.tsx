import { component$, useStore, useTask$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { SuggestionPopover } from "./editor-state";
import { SuggestionPanel } from "./suggestion-panel";
import {
  copyFixture,
  ModalCardStage,
  proposedEdit,
} from "./modal-card.fixtures";

const SuggestionPreview = component$<{
  suggestion: SuggestionPopover;
  stampVisible: boolean;
}>((props) => {
  const state = useStore({
    suggestion: copyFixture(props.suggestion) as SuggestionPopover | null,
    stampVisible: props.stampVisible,
    status: "Local preview. Accept or strike the proposed edit.",
  });
  useTask$(({ track }) => {
    state.suggestion = copyFixture(track(() => props.suggestion));
    state.stampVisible = track(() => props.stampVisible);
  });
  return (
    <ModalCardStage
      status={state.status}
      onReset$={() => {
        state.suggestion = copyFixture(props.suggestion);
        state.stampVisible = props.stampVisible;
        state.status = "Preview reset";
      }}
    >
      <SuggestionPanel
        suggestion={state.suggestion}
        stampVisible={state.stampVisible}
        onClose$={() => {
          state.suggestion = null;
          state.status = "Proposed edit closed";
        }}
        onStrike$={() => {
          state.suggestion = null;
          state.status = "Proposed edit struck. Original retained in preview.";
        }}
        onAccept$={() => {
          state.suggestion = null;
          state.stampVisible = true;
          state.status = "Proposed edit accepted in preview";
        }}
      />
    </ModalCardStage>
  );
});

const meta = {
  title: "Editor/SuggestionPanel",
  component: SuggestionPreview,
  parameters: { layout: "fullscreen" },
  args: { suggestion: proposedEdit, stampVisible: false },
} satisfies Meta<typeof SuggestionPreview>;
export default meta;
type Story = StoryObj<typeof SuggestionPreview>;

export const ProposedEdit: Story = {};
export const SmallEdit: Story = {
  args: {
    suggestion: {
      ...proposedEdit,
      original:
        "The library was the only room in the city where nobody really had to buy anything at all to stay.",
      replacement:
        "The library was the only room in the city where nobody had to buy anything to stay.",
      rationale: "Two qualifiers soften the claim; **cut them**.",
    },
  },
};
export const WithoutRationale: Story = {
  args: { suggestion: { ...proposedEdit, rationale: "" } },
};
export const Stamping: Story = {
  args: { suggestion: { ...proposedEdit, busy: true } },
};
export const InMargin: Story = {
  args: {
    suggestion: { ...proposedEdit, margin: "story-margin-slot", width: 300 },
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
};
