import { component$ } from "@qwik.dev/core";

export const WorkflowStamp = component$<{ kind: "filed" | "revised" }>(
  (props) => (
    <img
      class={`workflow-stamp workflow-stamp--${props.kind}`}
      src={`/assets/rubric-stamps/sunburst-${props.kind}.png`}
      width={240}
      height={240}
      alt={props.kind === "filed" ? "Filed" : "Revised"}
    />
  ),
);
