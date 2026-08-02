import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@builder.io/qwik";
import type {
  EditorCommandContext,
  EditorCommandId,
} from "../../utils/editor-commands";
import {
  fuzzySlashCommands,
  type SlashCommandCandidate,
} from "../../utils/slash-command-filter";
import type { ShortcutPlatform } from "../../utils/keybindings";

interface SlashCommandMenuProps {
  open: boolean;
  query: string;
  context?: EditorCommandContext;
  platform?: ShortcutPlatform;
  /** Fixed viewport coordinates supplied by the TipTap integration. */
  left: number;
  top: number;
  onSelect$: PropFunction<(commandId: EditorCommandId) => void>;
  onClose$: PropFunction<() => void>;
}

function slashGroup(candidate: SlashCommandCandidate): string {
  return candidate.command.slash?.group ?? "Commands";
}

/** Keyboard-navigable slash menu, driven entirely by the command registry. */
export const SlashCommandMenu = component$<SlashCommandMenuProps>((props) => {
  const activeIndex = useSignal(0);
  const candidates: SlashCommandCandidate[] = fuzzySlashCommands(
    props.query,
    props.context,
    props.platform ?? "mac",
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    const open = track(() => props.open);
    track(() => props.query);
    activeIndex.value = 0;
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void props.onClose$();
        return;
      }
      if (candidates.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex.value = (activeIndex.value + 1) % candidates.length;
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex.value =
          (activeIndex.value - 1 + candidates.length) % candidates.length;
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selected = candidates[activeIndex.value];
        if (selected)
          void props.onSelect$(selected.command.id as EditorCommandId);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    cleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  if (!props.open) return null;

  return (
    <div
      class="fixed w-72 overflow-hidden border border-[var(--color-paper-3)] bg-[var(--color-paper)] shadow-lg"
      style={{
        left: `${props.left}px`,
        top: `${props.top}px`,
        zIndex: "var(--z-dropdown)",
        borderRadius: "2px",
      }}
      role="listbox"
      aria-label="Insert command"
    >
      <p
        class="border-b border-[var(--color-paper-3)] px-3 py-2 text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]"
        style={{ fontFamily: "var(--font-typewriter)" }}
      >
        Insert {props.query ? `“${props.query}”` : "a block"}
      </p>

      {candidates.length === 0 ? (
        <p
          class="px-3 py-5 text-center text-sm text-[var(--color-ink-muted)]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No commands match.
        </p>
      ) : (
        <div class="max-h-80 overflow-y-auto py-1">
          {candidates.map((candidate, index) => {
            const group = slashGroup(candidate);
            const showGroup =
              index === 0 || slashGroup(candidates[index - 1]) !== group;
            return (
              <div key={candidate.command.id}>
                {showGroup && (
                  <p
                    class="border-y border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-1 text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] first:border-t-0"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    {group}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex.value}
                  class={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                    index === activeIndex.value
                      ? "bg-[var(--color-paper-2)] text-[var(--color-vermilion)]"
                      : "text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)]"
                  }`}
                  onMouseEnter$={() => {
                    activeIndex.value = index;
                  }}
                  onMouseDown$={(event) => event.preventDefault()}
                  onClick$={() =>
                    props.onSelect$(candidate.command.id as EditorCommandId)
                  }
                >
                  <span class="min-w-0 flex-1">
                    <span
                      class="block truncate text-sm font-medium"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {candidate.command.label}
                    </span>
                    <span
                      class="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {candidate.command.description}
                    </span>
                  </span>
                  {candidate.shortcut && (
                    <kbd
                      class="text-[0.62rem] text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      {candidate.shortcut}
                    </kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
