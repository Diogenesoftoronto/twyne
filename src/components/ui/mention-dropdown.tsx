import { component$, type PropFunction } from "@qwik.dev/core";
import { filterMentionables, type Mentionable } from "../../utils/mentions";

interface MentionDropdownProps {
  /** Full candidate pool — personas today, personas + collaborators later. */
  items: Mentionable[];
  /** The partial name typed after "@". */
  query: string;
  onSelect$: PropFunction<(item: Mentionable) => void>;
  size?: "sm" | "md";
  /** Index of the keyboard-highlighted candidate, if any. */
  activeIndex?: number;
  /**
   * Unique id so the owning textarea can point `aria-activedescendant` at the
   * highlighted option. One panel renders several of these at once.
   */
  id?: string;
}

/** Stable option id shared with the textarea's `aria-activedescendant`. */
export function mentionOptionId(listId: string, itemId: string): string {
  return `${listId}-${itemId}`;
}

/**
 * Floating @-mention suggestion list. Purely presentational: the caller owns
 * the textarea, the trigger detection, and what a mention does once filed —
 * this just renders the matching candidates and reports a selection.
 *
 * `preventdefault:mousedown` is declarative on purpose. The obvious
 * `onMouseDown$={(e) => e.preventDefault()}` does not work here: Qwik loads
 * QRL handlers asynchronously, so the first click blurs the textarea before
 * the handler arrives, the panel unmounts, and no `click` event is ever
 * dispatched — the mention silently drops.
 */
export const MentionDropdown = component$((props: MentionDropdownProps) => {
  const candidates = filterMentionables(props.items, props.query);
  const textSize = props.size === "sm" ? "text-xs" : "text-sm";
  const listId = props.id ?? "mention-dropdown";

  return (
    <>
      {candidates.length > 0 && (
        <div
          id={listId}
          data-mention-dropdown
          role="listbox"
          aria-label="Mention suggestions"
          preventdefault:mousedown
          class="absolute left-0 right-0 top-full mt-1 z-10 border border-[var(--color-paper-3)] bg-[var(--color-paper)] shadow-md"
          style="border-radius: 2px;"
        >
          {candidates.map((item, index) => {
            const active = index === props.activeIndex;
            return (
              <button
                key={item.id}
                id={mentionOptionId(listId, item.id)}
                type="button"
                role="option"
                aria-selected={active}
                preventdefault:mousedown
                onClick$={() => props.onSelect$(item)}
                class={[
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left",
                  textSize,
                  active
                    ? "bg-[var(--color-paper-soft)]"
                    : "hover:bg-[var(--color-paper-soft)]",
                ]}
                style={{
                  fontFamily: "var(--font-serif)",
                  // Keyboard highlight needs to read differently from hover,
                  // which the mouse may be sitting on at the same time.
                  boxShadow: active
                    ? "inset 2px 0 0 var(--color-vermilion)"
                    : undefined,
                }}
              >
                <span style={{ color: item.color ?? "var(--color-ink)" }}>
                  {item.icon ?? "@"}
                </span>
                {item.name}
                {item.kind === "collaborator" && (
                  <span
                    class="ml-auto text-[0.55rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter);"
                  >
                    collaborator
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
});
