import type { EditorCommandContext } from "./editor-commands";
import {
  getSlashCommands,
  type EditorCommandDefinition,
} from "./editor-commands";
import { shortcutHints, type ShortcutPlatform } from "./keybindings";

export interface SlashCommandCandidate {
  command: EditorCommandDefinition;
  score: number;
  shortcut: string | null;
}

function normalise(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Small fuzzy scorer tuned for command menus.
 *
 * Exact prefixes win, then word prefixes, then ordered subsequences. A query
 * that cannot be found in order is excluded rather than returning every
 * command with an arbitrary low score.
 */
export function fuzzyCommandScore(
  command: EditorCommandDefinition,
  query: string,
): number | null {
  const needle = normalise(query);
  if (!needle) return 0;

  const label = normalise(command.label);
  const haystack = normalise(
    [
      command.label,
      command.description,
      command.id,
      ...command.searchTerms,
      ...(command.slash?.keywords ?? []),
    ].join(" "),
  );

  if (label === needle) return 1000;
  if (label.startsWith(needle)) return 800 - (label.length - needle.length);
  const wordPrefix = label
    .split(" ")
    .findIndex((word) => word.startsWith(needle));
  if (wordPrefix >= 0) return 650 - wordPrefix * 10;
  const contained = haystack.indexOf(needle);
  if (contained >= 0) return 500 - Math.min(contained, 200);

  let cursor = 0;
  let gapPenalty = 0;
  for (const character of needle.replace(/\s/g, "")) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return null;
    gapPenalty += found - cursor;
    cursor = found + 1;
  }
  return 250 - Math.min(gapPenalty, 200);
}

export function fuzzySlashCommands(
  query: string,
  context: EditorCommandContext = {},
  platform: ShortcutPlatform = "mac",
): SlashCommandCandidate[] {
  return getSlashCommands("", context)
    .flatMap((command): SlashCommandCandidate[] => {
      const score = fuzzyCommandScore(command, query);
      if (score == null) return [];
      return [
        {
          command,
          score,
          shortcut: shortcutHints(command.id as never, platform)[0] ?? null,
        },
      ];
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const group = (a.command.slash?.group ?? "").localeCompare(
        b.command.slash?.group ?? "",
      );
      if (group !== 0) return group;
      return (a.command.slash?.order ?? 0) - (b.command.slash?.order ?? 0);
    });
}
