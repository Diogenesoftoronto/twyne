import { component$, useSignal } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { WorkflowStamp } from "./workflow-stamp";

const WorkflowPreview = component$<{
  kind: "filed" | "revised";
  overlay?: boolean;
}>((props) => {
  const replay = useSignal(0);
  return (
    <div class="paper-sheet p-8">
      <button class="btn-paper" onClick$={() => replay.value++}>
        Replay {props.kind} stamp
      </button>
      <div
        key={replay.value}
        class={props.overlay ? "approval-stamp-overlay" : "mt-8"}
      >
        <WorkflowStamp kind={props.kind} />
      </div>
    </div>
  );
});

export default {
  title: "Editorial/Workflow stamps",
  component: WorkflowStamp,
  parameters: { layout: "centered" },
} satisfies Meta<typeof WorkflowStamp>;
type Story = StoryObj<typeof WorkflowStamp>;
export const Filed: Story = { render: () => <WorkflowPreview kind="filed" /> };
export const Revised: Story = {
  render: () => <WorkflowPreview kind="revised" />,
};
export const AcceptedRevision: Story = {
  render: () => <WorkflowPreview kind="revised" overlay />,
};
export const FiledImprint: Story = {
  args: { kind: "filed", animated: false },
};
