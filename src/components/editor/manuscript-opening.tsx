import { component$, useStyles$ } from "@qwik.dev/core";
import styles from "./manuscript-opening.css?inline";

/** A local placeholder, never an editable document or a persistence source. */
export const ManuscriptOpening = component$<{ shell?: boolean }>((props) => {
  useStyles$(styles);
  return (
    <div class={{ "manuscript-opening-shell": props.shell }}>
      {props.shell && (
        <nav class="manuscript-opening-nav" aria-label="Writing desk">
          <a href="/desk/">My Desk</a>
          <span>Twyne</span>
        </nav>
      )}
      <div
        class={[
          "manuscript-opening",
          { "manuscript-opening--in-shell": props.shell },
        ]}
        role="status"
        aria-live="polite"
      >
        <span class="manuscript-opening__ink" aria-hidden="true" />
        <span>Opening manuscript…</span>
      </div>
    </div>
  );
});
