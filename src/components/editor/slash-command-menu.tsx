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

type SlashSelectionId = EditorCommandId | null;

/** Keep selection attached to a command, even when filtering reorders rows. */
export function reconcileSlashSelection(
  candidates: SlashCommandCandidate[],
  selectedCommandId: SlashSelectionId,
): SlashSelectionId {
  if (
    selectedCommandId &&
    candidates.some((candidate) => candidate.command.id === selectedCommandId)
  ) {
    return selectedCommandId;
  }
  return (candidates[0]?.command.id as EditorCommandId | undefined) ?? null;
}

/** Move through the visible result set rather than the unfiltered registry. */
export function moveSlashSelection(
  candidates: SlashCommandCandidate[],
  selectedCommandId: SlashSelectionId,
  direction: 1 | -1,
): SlashSelectionId {
  if (candidates.length === 0) return null;
  const currentId = reconcileSlashSelection(candidates, selectedCommandId);
  const currentIndex = candidates.findIndex(
    (candidate) => candidate.command.id === currentId,
  );
  const nextIndex =
    (currentIndex + direction + candidates.length) % candidates.length;
  return candidates[nextIndex].command.id as EditorCommandId;
}

function optionId(commandId: string): string {
  return `slash-command-${commandId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Keyboard-navigable slash menu, driven entirely by the command registry. */
export const SlashCommandMenu = component$<SlashCommandMenuProps>((props) => {
  const selectedCommandId = useSignal<SlashSelectionId>(null);
  const candidates: SlashCommandCandidate[] = fuzzySlashCommands(
    props.query,
    props.context,
    props.platform ?? "mac",
  );
  const visibleSelection = reconcileSlashSelection(
    candidates,
    selectedCommandId.value,
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    const open = track(() => props.open);
    const query = track(() => props.query);
    const currentCandidates = fuzzySlashCommands(
      query,
      props.context,
      props.platform ?? "mac",
    );
    selectedCommandId.value = reconcileSlashSelection(
      currentCandidates,
      selectedCommandId.value,
    );
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void props.onClose$();
        return;
      }
      // Resolve results at keypress time. A rapid query change must never leave
      // Enter acting on the candidate array from the prior render.
      const visibleCandidates = fuzzySlashCommands(
        props.query,
        props.context,
        props.platform ?? "mac",
      );
      if (visibleCandidates.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectedCommandId.value = moveSlashSelection(
          visibleCandidates,
          selectedCommandId.value,
          1,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        selectedCommandId.value = moveSlashSelection(
          visibleCandidates,
          selectedCommandId.value,
          -1,
        );
      } else if (event.key === "Enter") {
        if (event.isComposing) return;
        event.preventDefault();
        const currentSelection = reconcileSlashSelection(
          visibleCandidates,
          selectedCommandId.value,
        );
        const selected = visibleCandidates.find(
          (candidate) => candidate.command.id === currentSelection,
        );
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
      aria-activedescendant={
        visibleSelection ? optionId(visibleSelection) : undefined
      }
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
            const isSelected = candidate.command.id === visibleSelection;
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
                  id={optionId(candidate.command.id)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  class={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                    isSelected
                      ? "bg-[var(--color-paper-2)] text-[var(--color-vermilion)]"
                      : "text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)]"
                  }`}
                  onMouseEnter$={() => {
                    selectedCommandId.value = candidate.command
                      .id as EditorCommandId;
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
