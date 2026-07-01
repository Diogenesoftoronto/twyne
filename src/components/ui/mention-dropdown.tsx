import { component$, type PropFunction } from "@builder.io/qwik";
import { filterMentionables, type Mentionable } from "../../utils/mentions";

interface MentionDropdownProps {
  /** Full candidate pool — personas today, personas + collaborators later. */
  items: Mentionable[];
  /** The partial name typed after "@". */
  query: string;
  onSelect$: PropFunction<(item: Mentionable) => void>;
  size?: "sm" | "md";
}

/**
 * Floating @-mention suggestion list. Purely presentational: the caller owns
 * the textarea, the trigger detection, and what a mention does once filed —
 * this just renders the matching candidates and reports a selection.
 */
export const MentionDropdown = component$((props: MentionDropdownProps) => {
  const candidates = filterMentionables(props.items, props.query);
  const textSize = props.size === "sm" ? "text-xs" : "text-sm";

  return (
    <>
      {candidates.length > 0 && (
        <div
          class="absolute left-0 right-0 top-full mt-1 z-10 border border-[var(--color-paper-3)] bg-[var(--color-paper)] shadow-md"
          style="border-radius: 2px;"
        >
          {candidates.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown$={(e: MouseEvent) => e.preventDefault()}
              onClick$={() => props.onSelect$(item)}
              class={`w-full flex items-center gap-2 px-3 py-1.5 ${textSize} text-left hover:bg-[var(--color-paper-soft)]`}
              style="font-family: var(--font-serif);"
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
          ))}
        </div>
      )}
    </>
  );
});
