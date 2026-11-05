import {
  $,
  component$,
  Slot,
  useSignal,
  type PropFunction,
} from "@qwik.dev/core";
import type { Consequence } from "../../utils/consequence";
import { beginHold, cancelHold } from "../../utils/hold-press";
import { motionLevel } from "../../utils/motion";

interface HoldToConfirmProps {
  /** Runs once the hold completes (or on a confirmed keyboard press). */
  onConfirm$: PropFunction<() => void | Promise<void>>;
  /** Where the action sends things; tints the ink. Defaults to `erase`. */
  consequence?: Consequence;
  /** How long a pointer must hold. */
  holdMs?: number;
  /** Spoken and shown as the tooltip: what happens on completion. */
  label: string;
  /** The short instruction under the label, e.g. "hold to erase". */
  hint?: string;
  disabled?: boolean;
  class?: string;
}

/**
 * For actions that cannot be taken back from here. A pointer must hold the
 * control while the platen comes down; releasing early cancels and the ink
 * drains away. Keyboard and assistive tech take a two-step path instead (the
 * first Enter arms, the second confirms within a few seconds), so the guard
 * never depends on being able to hold a button steady.
 *
 * Reserve it for permanent losses. Recoverable actions are better served by
 * an undo, which interrupts no one.
 */
export const HoldToConfirm = component$<HoldToConfirmProps>((props) => {
  const button = useSignal<HTMLButtonElement>();
  const armed = useSignal(false);
  // Bumped on every arm, so an older lapse timer cannot disarm a newer arm.
  const armId = useSignal(0);
  const holdMs = props.holdMs ?? 900;

  const start = $((event: PointerEvent) => {
    const element = button.value;
    if (!element || props.disabled || event.button !== 0) return;
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      element.setPointerCapture(event.pointerId);
    }
    // With motion stilled the ink cannot show progress, so the hold is
    // shortened rather than made invisible; it still guards a slip.
    const duration = motionLevel() === "still" ? 450 : holdMs;
    beginHold(element, {
      durationMs: duration,
      onCommit: () => void props.onConfirm$(),
    });
  });

  const stop = $(() => {
    const element = button.value;
    if (element) cancelHold(element);
  });

  return (
    <button
      ref={button}
      type="button"
      class={["hold-to-confirm", props.class]}
      data-consequence={props.consequence ?? "erase"}
      data-armed={armed.value ? "" : undefined}
      disabled={props.disabled}
      title={props.label}
      aria-label={
        armed.value ? `${props.label}. Press again to confirm.` : props.label
      }
      onPointerDown$={start}
      onPointerUp$={stop}
      onPointerCancel$={stop}
      onPointerLeave$={stop}
      onClick$={async (event) => {
        // Pointer presses commit through the hold; a click with no pointer
        // behind it came from the keyboard or assistive tech.
        if (event.detail !== 0 || props.disabled) return;
        if (!armed.value) {
          armed.value = true;
          // An arm that is not confirmed lapses, so a stray Enter later on
          // cannot complete an old intention.
          const id = ++armId.value;
          setTimeout(() => {
            if (armId.value === id) armed.value = false;
          }, 4000);
          return;
        }
        armed.value = false;
        armId.value++;
        await props.onConfirm$();
      }}
      onKeyDown$={(event) => {
        if (event.key === "Escape") armed.value = false;
      }}
    >
      <span class="hold-to-confirm__ink" aria-hidden="true" />
      <Slot />
      {(props.hint || armed.value) && (
        <span class="hold-to-confirm__hint" aria-hidden="true">
          {armed.value ? "press again to confirm" : props.hint}
        </span>
      )}
    </button>
  );
});
