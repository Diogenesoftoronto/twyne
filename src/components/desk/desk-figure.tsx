import { component$ } from "@qwik.dev/core";

/**
 * A figure set like type in a composing stick: its numerals roll up into
 * place when it first appears, and again only when its displayed value
 * changes (the key is the text, so an unchanged figure is never re-set).
 * The animation is CSS alone: at `data-motion="still"` it collapses and the
 * final value is simply there. Readers get the whole value once, not digits.
 */
export const DeskFigure = component$<{ value: string | number }>(
  ({ value }) => {
    const text = String(value);
    return (
      <>
        <span class="sr-only">{text}</span>
        <span key={text} class="desk-figure" aria-hidden="true">
          {Array.from(text).map((char, index) =>
            /[0-9]/.test(char) ? (
              <span key={index} class="desk-digit">
                <span style={{ "--desk-digit": index }}>{char}</span>
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
