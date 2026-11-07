import {
  $,
  component$,
  useSignal,
  useId,
  useTask$,
  sync$,
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
  placement?: "top" | "bottom";
}

/** A paper-and-ink listbox whose opened options can follow Twyne's design. */
export const SiteSelect = component$<SiteSelectProps>((props) => {
  const id = useId();
  const menu = useSignal<HTMLElement>();
  const search = useSignal("");
  const searchedAt = useSignal(0);
  const root = useSignal<HTMLElement>();
  const trigger = useSignal<HTMLButtonElement>();
  const open = useSignal(false);
  const activeIndex = useSignal(0);
  const selectedIndex = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );
  const selected = props.options.find((option) => option.value === props.value);

  const close = $((returnFocus = false) => {
    open.value = false;
    if (returnFocus) trigger.value?.focus();
  });

  const choose = $((index: number) => {
    const option = props.options[index];
    if (!option || props.disabled) return;
    props.onChange$(option.value);
    void close(true);
  });

  useTask$(({ track }) => {
    if (track(() => props.disabled)) open.value = false;
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
      onFocusOut$={(event) => {
        if (!root.value?.contains(event.relatedTarget as Node)) void close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        class="site-select__trigger"
        aria-label={props.ariaLabel}
        role="combobox"
        aria-controls={`${id}-listbox`}
        aria-activedescendant={
          open.value ? `${id}-option-${activeIndex.value}` : undefined
        }
        aria-haspopup="listbox"
        aria-expanded={open.value}
        disabled={props.disabled || props.options.length === 0}
        onClick$={() => {
          activeIndex.value = selectedIndex;
          open.value = !open.value;
        }}
        onKeyDown$={[
          sync$((event: KeyboardEvent) => {
            if (
              [
                "ArrowDown",
                "ArrowUp",
                "Home",
                "End",
                "Enter",
                " ",
                "Escape",
              ].includes(event.key)
            )
              event.preventDefault();
          }),
          $((event: KeyboardEvent) => {
            if (props.disabled || props.options.length === 0) return;
            const key = event.key;
            if (key === "ArrowDown" || key === "ArrowUp") {
              const delta = key === "ArrowDown" ? 1 : -1;
              activeIndex.value = open.value
                ? (activeIndex.value + delta + props.options.length) %
                  props.options.length
                : selectedIndex;
              open.value = true;
            } else if (key === "Home" || key === "End") {
              activeIndex.value = key === "Home" ? 0 : props.options.length - 1;
              open.value = true;
            } else if (key === "Enter" || key === " ") {
              if (open.value) void choose(activeIndex.value);
              else {
                activeIndex.value = selectedIndex;
                open.value = true;
              }
            } else if (key === "Escape" || key === "Tab") {
              void close();
            } else if (
              key.length === 1 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              const now = Date.now();
              search.value =
                (now - searchedAt.value < 700 ? search.value : "") +
                key.toLowerCase();
              searchedAt.value = now;
              const match = props.options.findIndex((option) =>
                option.label.toLowerCase().startsWith(search.value),
              );
              if (match >= 0) {
                activeIndex.value = match;
                open.value = true;
              }
            }
            menu.value
              ?.querySelector(`[data-index="${activeIndex.value}"]`)
              ?.scrollIntoView({ block: "nearest" });
          }),
        ]}
      >
        <span class="site-select__value">{selected?.label ?? "Choose"}</span>
        <span class="site-select__chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open.value && (
        <div
          ref={menu}
          id={`${id}-listbox`}
          class="site-select__menu"
          style={
            props.placement === "top"
              ? {
                  top: "auto",
                  bottom: "calc(100% + 0.5rem)",
                  left: "auto",
                  right: "0",
                  maxHeight: "min(16rem, 45dvh)",
                }
              : undefined
          }
          role="listbox"
          aria-label={props.ariaLabel}
          tabIndex={-1}
        >
          {props.options.map((option, index) => {
            const isSelected = option.value === props.value;
            const isActive = index === activeIndex.value;
            return (
              <button
                key={option.value}
                id={`${id}-option-${index}`}
                data-index={index}
                tabIndex={-1}
                type="button"
                role="option"
                aria-selected={isSelected}
                class={`site-select__option${
                  isActive ? " is-active" : ""
                }${isSelected ? " is-selected" : ""}`}
                preventdefault:mousedown
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
