import { component$, Slot, useStyles$ } from "@qwik.dev/core";
import styles from "./instrument-motion.css?inline";

export type InstrumentMotionState = "rest" | "open" | "compare" | "arrive";
export type InstrumentMotionPartKind = "source" | "alternative" | "result";

export interface InstrumentMotionProps {
  /** Use rest for restored content. Change state only for an actual interaction. */
  state?: InstrumentMotionState;
  /** Pass true while writing, in Zen, or when the host is outside the viewport. */
  quiet?: boolean;
  class?: string;
}

/**
 * Finite feedback only: no timers, document listeners, or perpetual loader.
 * This wrapper never manages visibility or delays interaction with its children.
 */
export const InstrumentMotion = component$<InstrumentMotionProps>((props) => {
  useStyles$(styles);
  return (
    <div
      class={["instrument-motion", props.class]}
      data-instrument-motion={props.state ?? "rest"}
      data-instrument-quiet={props.quiet ? "true" : undefined}
    >
      <Slot />
    </div>
  );
});

/** Mark the real comparison/result content, not a decorative stand-in. */
export const InstrumentMotionPart = component$<{
  part: InstrumentMotionPartKind;
  class?: string;
}>((props) => (
  <div class={props.class} data-instrument-part={props.part}>
    <Slot />
  </div>
));
