import { component$, useStyles$ } from "@qwik.dev/core";
import styles from "./editorial-activity.css?inline";

/** Small editorial state cues, with still alternatives for reduced motion. */
export const EditorialActivity = component$<{
  label: string;
  kind?: "writing" | "reading" | "searching" | "saving" | "ready";
  /** Decorative icon beside a status that is already written out. */
  iconOnly?: boolean;
}>((props) => {
  useStyles$(styles);
  return (
    <span
      class="editorial-activity"
      data-kind={props.kind ?? "writing"}
      role={props.iconOnly ? undefined : "status"}
      aria-hidden={props.iconOnly ? "true" : undefined}
    >
      <span class="editorial-activity__paper" aria-hidden="true" data-ambient>
        <span class="editorial-activity__line" data-ambient />
        <span class="editorial-activity__line" data-ambient />
        <span class="editorial-activity__line" data-ambient />
        <span class="editorial-activity__pen" data-ambient />
        <span class="editorial-activity__lens" data-ambient />
        <span class="editorial-activity__check" />
      </span>
      {!props.iconOnly && <span>{props.label}</span>}
    </span>
  );
});
