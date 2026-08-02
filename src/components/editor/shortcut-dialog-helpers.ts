import type { KeybindingListEntry } from "../../utils/keybindings";

export function filterKeybindingEntries(
  entries: readonly KeybindingListEntry[],
  query: string,
): KeybindingListEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...entries];

  return entries.filter((entry) => {
    const haystack = [
      entry.commandId,
      entry.label,
      entry.description,
      entry.group,
      ...entry.shortcuts,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
