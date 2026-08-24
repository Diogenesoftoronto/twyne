import { component$, type PropFunction } from "@builder.io/qwik";
import { WRITING_FORMAT_SUGGESTIONS } from "../../utils/writing-formats";

interface WritingFormatInputProps {
  value: string;
  onValueChange$: PropFunction<(value: string) => void>;
  onCommit$: PropFunction<() => void>;
  labelledBy: string;
  describedBy: string;
}

/**
 * A suggestion-backed text field, not a closed select. Native datalist
 * filtering keeps keyboard, touch, and browser accessibility behavior while
 * preserving any form the writer chooses to type.
 */
export const WritingFormatInput = component$<WritingFormatInputProps>(
  (props) => (
    <div>
      <div class="writing-format-control">
        <input
          value={props.value}
          {...({ list: "twyne-writing-formats" } as Record<string, string>)}
          aria-labelledby={props.labelledBy}
          aria-describedby={`${props.describedBy} writing-format-guidance`}
          autoComplete="off"
          autoFocus
          onInput$={(_, input) => props.onValueChange$(input.value)}
          onKeyDown$={(event) => {
            if (event.key === "Enter") props.onCommit$();
          }}
          placeholder="Essay"
          class="carriage-input w-full border-b-2 border-[var(--color-ink)] bg-transparent px-1 py-2 pr-9 text-lg text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic focus:outline-none"
          style="font-family: var(--font-display); font-weight: 500;"
        />
        <span class="writing-format-control__cue" aria-hidden="true">
          ▾
        </span>
      </div>
      <datalist id="twyne-writing-formats">
        {WRITING_FORMAT_SUGGESTIONS.map((format) => (
          <option key={format} value={format} />
        ))}
      </datalist>
      <p
        id="writing-format-guidance"
        class="mt-2 text-[0.7rem] leading-5 text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter);"
      >
        Start typing to filter the list, or enter your own form.
      </p>
    </div>
  ),
);
