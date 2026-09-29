import { component$, Slot, useSignal } from "@qwik.dev/core";

/**
 * A real wooden die presses the projected impression into the paper.
 * The mark is readable before the optional image loads, and remains if it fails.
 * Mount/key this component only for a new event, never for routine repaints.
 */
export const StampPress = component$<{ animated?: boolean }>((props) => {
  const toolReady = useSignal(false);

  return (
    <span
      class={[
        "ink-stamp",
        { "ink-stamp--pressing": props.animated && toolReady.value },
      ]}
      aria-hidden="true"
    >
      <span class="ink-stamp__imprint">
        <Slot />
      </span>
      {props.animated && (
        <>
          <span class="ink-stamp__contact-shadow" />
          <img
            class="ink-stamp__tool"
            src="/assets/stamp-press/walnut-stamp.avif"
            width={768}
            height={768}
            alt=""
            draggable={false}
            onLoad$={() => (toolReady.value = true)}
          />
        </>
      )}
    </span>
  );
});
