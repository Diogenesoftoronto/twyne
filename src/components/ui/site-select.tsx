import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";

export interface SiteSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SiteSelectProps {
  value: string;
  options: SiteSelectOption[];
  onChange$: PropFunction<(value: string) => void>;
  ariaLabel: string;
  disabled?: boolean;
  class?: string;
}

/** A paper-and-ink listbox whose opened options can follow Twyne's design. */
export const SiteSelect = component$<SiteSelectProps>((props) => {
  const root = useSignal<HTMLElement>();
  const trigger = useSignal<HTMLButtonElement>();
  const open = useSignal(false);
  const activeIndex = useSignal(0);
  const selectedIndex = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );
  const selected = props.options[selectedIndex] ?? props.options[0];

  const close = $((returnFocus = false) => {
    open.value = false;
    if (returnFocus) trigger.value?.focus();
  });

  const choose = $((index: number) => {
    const option = props.options[index];
    if (!option) return;
    props.onChange$(option.value);
    void close(true);
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const onPointerDown = (event: PointerEvent) => {
      if (!root.value?.contains(event.target as Node)) void close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    cleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  });

  return (
    <div
      ref={root}
      class={`site-select${props.class ? ` ${props.class}` : ""}`}
    >
      <button
        ref={trigger}
        type="button"
        class="site-select__trigger"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open.value}
        disabled={props.disabled || props.options.length === 0}
        onClick$={() => {
          activeIndex.value = selectedIndex;
          open.value = !open.value;
        }}
        onKeyDown$={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            activeIndex.value = open.value
              ? (activeIndex.value + delta + props.options.length) %
                props.options.length
              : selectedIndex;
            open.value = true;
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open.value) void choose(activeIndex.value);
            else open.value = true;
          } else if (event.key === "Escape") {
            event.preventDefault();
            void close();
          }
        }}
      >
        <span class="site-select__value">{selected?.label ?? "Choose"}</span>
        <span class="site-select__chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open.value && (
        <div
          class="site-select__menu"
          role="listbox"
          aria-label={props.ariaLabel}
          tabIndex={-1}
          onKeyDown$={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              activeIndex.value =
                (activeIndex.value + delta + props.options.length) %
                props.options.length;
            } else if (event.key === "Home") {
              event.preventDefault();
              activeIndex.value = 0;
            } else if (event.key === "End") {
              event.preventDefault();
              activeIndex.value = props.options.length - 1;
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void choose(activeIndex.value);
            } else if (event.key === "Escape" || event.key === "Tab") {
              void close(event.key === "Escape");
            }
          }}
        >
          {props.options.map((option, index) => {
            const isSelected = option.value === props.value;
            const isActive = index === activeIndex.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                class={`site-select__option${
                  isActive ? " is-active" : ""
                }${isSelected ? " is-selected" : ""}`}
                onPointerMove$={() => {
                  activeIndex.value = index;
                }}
                onClick$={() => choose(index)}
              >
                <span class="site-select__check" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </span>
                <span class="site-select__option-copy">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
