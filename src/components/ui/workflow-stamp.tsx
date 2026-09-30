import { component$ } from "@qwik.dev/core";
import { StampPress } from "./stamp-press";

export const WorkflowStamp = component$<{
  kind: "filed" | "revised";
  animated?: boolean;
  /** A new completion event, when an existing instance is reused. */
  impressionKey?: string | number;
}>((props) => (
  <span
    class={`workflow-stamp workflow-stamp--${props.kind}`}
    role="img"
    aria-label={props.kind === "filed" ? "Filed" : "Revised"}
    style={{
      "--workflow-stamp-image": `url("/assets/rubric-stamps/sunburst-${props.kind}.png")`,
    }}
  >
    <StampPress
      key={props.impressionKey ?? props.kind}
      animated={props.animated ?? true}
    >
      <span class="workflow-stamp__mark" />
    </StampPress>
  </span>
));
