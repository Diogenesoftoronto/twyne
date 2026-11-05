import { component$ } from "@qwik.dev/core";
import { CONSEQUENCE_LABELS, type Consequence } from "../../utils/consequence";

interface DestinationTagProps {
  /** Where the action's words or data go. */
  to: Consequence;
  /** Replaces the short visible word, e.g. a provider's name. */
  label?: string;
  /** Replaces the long, spoken description. */
  description?: string;
  /** Softer, for a tag repeated down a list. */
  quiet?: boolean;
  class?: string;
}

/**
 * A typewritten docket saying where an action sends things. The mark's ink and
 * shape follow the destination (hollow for the device, struck for erasing), and
 * the word is always there, so colour is never the only cue. Screen readers get
 * the long form instead of the abbreviation.
 */
export const DestinationTag = component$<DestinationTagProps>((props) => {
  const labels = CONSEQUENCE_LABELS[props.to];
  const long = props.description ?? labels.long;
  return (
    <span
      class={[
        "destination-tag",
        { "destination-tag--quiet": props.quiet },
        props.class,
      ]}
      data-consequence={props.to}
      title={long}
    >
      <span class="destination-tag__mark" aria-hidden="true" />
      <span aria-hidden="true">{props.label ?? labels.short}</span>
      <span class="sr-only">{long}</span>
    </span>
  );
});
