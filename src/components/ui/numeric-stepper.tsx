import { component$, type PropFunction } from "@qwik.dev/core";

export interface NumericBounds {
  min?: number;
  max?: number;
  step?: number;
  emptyValue?: number;
}

interface NumericStepperProps extends NumericBounds {
  value: number | "" | null | undefined;
  ariaLabel: string;
  placeholder?: string;
  suffix?: string;
  disabled?: boolean;
  density?: "regular" | "compact";
  class?: string;
  title?: string;
  onValue$: PropFunction<(value: number | null) => void>;
  onCommit$?: PropFunction<(value: number | null) => void>;
}

function decimalPlaces(value: number): number {
  const [, decimals = ""] = String(value).split(".");
  return Math.min(decimals.length, 6);
}

export function normalizeNumericValue(
  value: number,
  bounds: NumericBounds,
): number {
  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(max, Math.max(min, value));
  const precision = Math.max(
    decimalPlaces(bounds.step ?? 1),
    Number.isFinite(min) ? decimalPlaces(min) : 0,
    Number.isFinite(max) ? decimalPlaces(max) : 0,
  );
  return Number(clamped.toFixed(precision));
}

export function stepNumericValue(
  value: number | null | undefined,
  direction: -1 | 1,
  bounds: NumericBounds,
): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return normalizeNumericValue(bounds.emptyValue ?? bounds.min ?? 0, bounds);
  }
  return normalizeNumericValue(value + direction * (bounds.step ?? 1), bounds);
}

/**
 * A single numeric-field vocabulary for Twyne.
 *
 * The value remains directly editable for precision, while the segmented
 * buttons expose the bounded step without relying on tiny browser spinners.
 */
export const NumericStepper = component$<NumericStepperProps>((props) => {
  const density = props.density ?? "regular";
  const numericValue =
    typeof props.value === "number" && Number.isFinite(props.value)
      ? props.value
      : null;
  const bounds: NumericBounds = {
    min: props.min,
    max: props.max,
    step: props.step,
    emptyValue: props.emptyValue,
  };
  const atMinimum =
    numericValue !== null &&
    props.min !== undefined &&
    numericValue <= props.min;
  const atMaximum =
    numericValue !== null &&
    props.max !== undefined &&
    numericValue >= props.max;

  return (
    <div
      class={`numeric-stepper numeric-stepper--${density}${
        props.suffix ? " numeric-stepper--has-suffix" : ""
      }${props.class ? ` ${props.class}` : ""}`}
      role="group"
      aria-label={props.ariaLabel}
      aria-disabled={props.disabled}
      title={props.title}
    >
      <button
        type="button"
        class="numeric-stepper__button"
        disabled={props.disabled || atMinimum}
        aria-label={`Decrease ${props.ariaLabel}`}
        onClick$={async () => {
          const next = stepNumericValue(numericValue, -1, bounds);
          await props.onValue$(next);
          await props.onCommit$?.(next);
        }}
      >
        −
      </button>
      <label class="numeric-stepper__field">
        <span class="sr-only">{props.ariaLabel}</span>
        <input
          class="numeric-stepper__input"
          type="number"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={numericValue ?? ""}
          placeholder={props.placeholder}
          disabled={props.disabled}
          aria-label={props.ariaLabel}
          onInput$={(_, element) => {
            const next = element.value === "" ? null : Number(element.value);
            props.onValue$(Number.isFinite(next) ? next : null);
          }}
          onBlur$={(_, element) => {
            const raw = element.value === "" ? null : Number(element.value);
            const next =
              raw === null || !Number.isFinite(raw)
                ? null
                : normalizeNumericValue(raw, bounds);
            props.onValue$(next);
            props.onCommit$?.(next);
          }}
        />
        {props.suffix && (
          <span class="numeric-stepper__suffix" aria-hidden="true">
            {props.suffix}
          </span>
        )}
      </label>
      <button
        type="button"
        class="numeric-stepper__button"
        disabled={props.disabled || atMaximum}
        aria-label={`Increase ${props.ariaLabel}`}
        onClick$={async () => {
          const next = stepNumericValue(numericValue, 1, bounds);
          await props.onValue$(next);
          await props.onCommit$?.(next);
        }}
      >
        +
      </button>
    </div>
  );
});
