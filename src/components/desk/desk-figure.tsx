import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";

import { allowsMotion } from "../../utils/motion";

/** Set a figure again only when its displayed value changes. */
export const DeskFigure = component$<{ value: string | number }>(
  ({ value }) => {
    const text = String(value);
    const animate = useSignal(false);
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      animate.value = allowsMotion("feedback");
    });
    return (
      <>
        <span class="sr-only">{text}</span>
        <span
          key={text}
          class={{ "desk-figure": true, "desk-figure-animate": animate.value }}
          aria-hidden="true"
        >
          {Array.from(text).map((char, index) =>
            /[0-9]/.test(char) ? (
              <span key={index} class="desk-digit">
                <span>{char}</span>
              </span>
            ) : (
              char
            ),
          )}
        </span>
      </>
    );
  },
);
