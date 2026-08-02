import { component$ } from "@builder.io/qwik";
import type { KeybindingListEntry } from "../../utils/keybindings";

interface KeybindingListProps {
  entries: readonly KeybindingListEntry[];
  emptyLabel?: string;
}

const GROUP_LABELS: Record<string, string> = {
  text: "Text formatting",
  paragraph: "Paragraphs",
  structure: "Structure",
  insert: "Insert",
  review: "Review",
  navigation: "Navigation",
  table: "Tables",
  history: "History",
  view: "View",
};

/**
 * Registry-backed shortcut rows shared by the editor dialog and the Manual.
 *
 * This component contains no hard-coded command labels or chords. If a
 * shortcut changes, both surfaces update from `keybindings.ts`.
 */
export const KeybindingList = component$<KeybindingListProps>((props) => {
  if (props.entries.length === 0) {
    return (
      <p
        class="py-8 text-center text-sm text-[var(--color-ink-muted)]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {props.emptyLabel ?? "No shortcuts match that search."}
      </p>
    );
  }

  const groups = new Map<string, KeybindingListEntry[]>();
  for (const entry of props.entries) {
    const rows = groups.get(entry.group) ?? [];
    rows.push(entry);
    groups.set(entry.group, rows);
  }

  return (
    <div class="space-y-5">
      {[...groups.entries()].map(([group, entries]) => (
        <section key={group} aria-labelledby={`shortcut-group-${group}`}>
          <h3
            id={`shortcut-group-${group}`}
            class="mb-2 text-[0.65rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {GROUP_LABELS[group] ?? group}
          </h3>
          <dl class="divide-y divide-[var(--color-paper-3)]">
            {entries.map((entry) => (
              <div
                key={entry.commandId}
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2"
              >
                <div>
                  <dt
                    class="text-sm font-medium text-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {entry.label}
                  </dt>
                  <dd
                    class="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-light)]"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {entry.description}
                  </dd>
                </div>
                <dd class="flex flex-wrap justify-end gap-1.5">
                  {entry.shortcuts.map((shortcut) => (
                    <kbd
                      key={shortcut}
                      class="inline-flex min-h-6 items-center border border-[var(--color-paper-3)] bg-[var(--color-paper-2)] px-1.5 text-[0.68rem] text-[var(--color-ink)]"
                      style={{
                        borderRadius: "2px",
                        fontFamily: "var(--font-typewriter)",
                        boxShadow: "inset 0 -1px 0 rgba(31, 27, 22, 0.12)",
                      }}
                    >
                      {shortcut}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
});
