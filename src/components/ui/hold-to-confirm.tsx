import {
  component$,
  Slot,
  useSignal,
  useVisibleTask$,
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
  const onConfirm$ = props.onConfirm$;

  // The press is tracked with native listeners, not Qwik handlers. Qwik
  // loads and runs handlers asynchronously, so the first pointerdown handler
  // can run after the pointerup that should have cancelled it, and a click
  // would then hold itself down and commit. Native listeners see press and
  // release in the order they happened. Until this task has run, a press
  // simply does nothing, which is the safe way to be early.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const element = button.value;
    if (!element) return;
    const press = (event: PointerEvent) => {
      if (element.disabled || event.button !== 0) return;
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        element.setPointerCapture(event.pointerId);
      }
      // With motion stilled the ink cannot show progress, so the hold is
      // shortened rather than made invisible; it still guards a slip.
      beginHold(element, {
        durationMs: motionLevel() === "still" ? 450 : holdMs,
        onCommit: () => void onConfirm$(),
      });
    };
    const release = () => cancelHold(element);
    const releases = [
      "pointerup",
      "pointercancel",
      "pointerleave",
      "lostpointercapture",
    ] as const;
    element.addEventListener("pointerdown", press);
    for (const type of releases) element.addEventListener(type, release);
    cleanup(() => {
      element.removeEventListener("pointerdown", press);
      for (const type of releases) element.removeEventListener(type, release);
      cancelHold(element);
    });
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
        await onConfirm$();
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
