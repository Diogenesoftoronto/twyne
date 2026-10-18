import { component$ } from "@qwik.dev/core";
import type { StrengthView } from "../../utils/brief-strength";

interface AnswerStrengthProps {
  strength: StrengthView;
  /** Jev is reading this answer now. */
  reading?: boolean;
  /** Jev cannot be reached; say the grade is the quick read only. */
  quickOnly?: boolean;
  /**
   * `full` sits under the field being answered and explains itself;
   * `compact` is the four-notch bar in the working copy.
   */
  variant?: "full" | "compact";
}

/**
 * A password meter for brief answers: four notches for Vague → Sharp, the
 * level named, and the one thing that would raise it. The level is the
 * explanation — it is worded as a diagnosis, not a grade.
 */
export const AnswerStrength = component$<AnswerStrengthProps>((props) => {
  const { strength } = props;
  const variant = props.variant ?? "full";
  const notches = (
    <span class="answer-strength__notches" aria-hidden="true">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          class="answer-strength__notch"
          data-lit={strength.level >= n ? "true" : undefined}
        />
      ))}
    </span>
  );

  if (variant === "compact") {
    return (
      <span
        class="answer-strength answer-strength--compact"
        data-level={strength.level}
        data-reading={props.reading ? "true" : undefined}
        title={[strength.label, strength.hint].filter(Boolean).join(" — ")}
      >
        {notches}
        <span class="answer-strength__label">{strength.label}</span>
      </span>
    );
  }

  const source = props.reading
    ? "Jev is reading…"
    : strength.source === "jev"
      ? strength.uncertain
        ? "Jev · close call"
        : "Jev"
      : props.quickOnly
        ? "Quick read"
        : "Quick read · Jev on a pause";

  return (
    <div
      class="answer-strength answer-strength--full"
      data-level={strength.level}
      data-reading={props.reading ? "true" : undefined}
    >
      <div class="answer-strength__head">
        {notches}
        {/* Keyed on level so a change in grade replays the stamp. */}
        <span
          key={`${strength.level}-${strength.source}`}
          class="answer-strength__label answer-strength__label--stamp"
        >
          {strength.label}
        </span>
        <span class="answer-strength__source">{source}</span>
      </div>
      <p class="answer-strength__note" role="status" aria-live="polite">
        <span class="sr-only">Answer strength: {strength.label}. </span>
        {strength.level > 0 && (
          <span class="answer-strength__diagnosis">{strength.diagnosis}. </span>
        )}
        {strength.hint && (
          <span class="answer-strength__hint">{strength.hint}</span>
        )}
      </p>
    </div>
  );
});
