import { EDITOR_COMMANDS, type EditorCommandId } from "./editor-commands";

export type ShortcutPlatform = "mac" | "windows" | "linux";

export interface EditorKeybinding {
  commandId: EditorCommandId;
  /** ProseMirror-style chord: Mod, Shift, Alt, Ctrl plus a final key. */
  shortcut: string;
  /** Lower values win when two handlers share a chord. */
  priority?: number;
  /** Why a deliberate overlap is safe. */
  context?: string;
}

export const EDITOR_KEYBINDINGS = [
  { commandId: "format.bold", shortcut: "Mod-b" },
  { commandId: "format.italic", shortcut: "Mod-i" },
  { commandId: "format.underline", shortcut: "Mod-u" },
  { commandId: "format.strike", shortcut: "Mod-Shift-x" },
  { commandId: "format.clear", shortcut: "Mod-\\" },
  { commandId: "paragraph.heading-1", shortcut: "Mod-Alt-1" },
  { commandId: "paragraph.heading-2", shortcut: "Mod-Alt-2" },
  { commandId: "paragraph.heading-3", shortcut: "Mod-Alt-3" },
  { commandId: "paragraph.bullet-list", shortcut: "Mod-Shift-8" },
  { commandId: "paragraph.numbered-list", shortcut: "Mod-Shift-7" },
  { commandId: "paragraph.blockquote", shortcut: "Mod-Shift-b" },
  { commandId: "paragraph.code-block", shortcut: "Mod-Alt-c" },
  { commandId: "paragraph.indent", shortcut: "Tab" },
  { commandId: "paragraph.outdent", shortcut: "Shift-Tab" },
  {
    commandId: "insert.page-break",
    shortcut: "Mod-Enter",
    priority: 200,
    context: "Yields to exitCode while the cursor is in a code block.",
  },
  // Table removals are bound so they appear in the shortcut dialog at all —
  // the floating toolbar scrolls its trailing buttons out of sight, which is
  // how writers ended up with tables they could not delete. Both are covered
  // by undo, so no confirmation step.
  { commandId: "table.delete-row", shortcut: "Mod-Alt-Backspace" },
  { commandId: "table.delete-table", shortcut: "Mod-Alt-Shift-Backspace" },
  { commandId: "review.comment", shortcut: "Mod-Alt-m" },
  { commandId: "navigate.find", shortcut: "Mod-f" },
  { commandId: "navigate.replace", shortcut: "Mod-h" },
  { commandId: "navigate.outline", shortcut: "Mod-Shift-o" },
  { commandId: "view.shortcuts", shortcut: "Mod-/" },
  { commandId: "view.shortcuts", shortcut: "Mod-Shift-/" },
  { commandId: "history.undo", shortcut: "Mod-z" },
  { commandId: "history.redo", shortcut: "Mod-Shift-z" },
] as const satisfies readonly EditorKeybinding[];

const VALID_MODIFIERS = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
const MAC_MODIFIERS: Record<string, string> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};
const OTHER_MODIFIERS: Record<string, string> = {
  Mod: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

export function shortcutPlatform(
  platform = typeof navigator === "undefined"
    ? ""
    : ((
        navigator as Navigator & {
          userAgentData?: { platform?: string };
        }
      ).userAgentData?.platform ?? navigator.platform),
): ShortcutPlatform {
  const value = platform.toLocaleLowerCase();
  if (
    value.includes("mac") ||
    value.includes("iphone") ||
    value.includes("ipad")
  ) {
    return "mac";
  }
  if (value.includes("win")) return "windows";
  return "linux";
}

export interface ParsedShortcut {
  modifiers: string[];
  key: string;
}

export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split("-").filter(Boolean);
  const key = parts.pop() ?? "";
  return {
    modifiers: parts.filter((part) => VALID_MODIFIERS.has(part)),
    key,
  };
}

function displayKey(key: string, platform: ShortcutPlatform): string {
  const named: Record<string, string> = {
    Enter: platform === "mac" ? "↩" : "Enter",
    Tab: platform === "mac" ? "⇥" : "Tab",
    Escape: platform === "mac" ? "Esc" : "Esc",
    Backspace: platform === "mac" ? "⌫" : "Backspace",
    Delete: platform === "mac" ? "⌦" : "Delete",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
  };
  if (named[key]) return named[key];
  return key.length === 1 ? key.toLocaleUpperCase() : key;
}

/** Human-readable labels for tooltips, the shortcut dialog, and the Manual. */
export function formatShortcut(
  shortcut: string,
  platform: ShortcutPlatform = shortcutPlatform(),
): string {
  const parsed = parseShortcut(shortcut);
  const modifierMap = platform === "mac" ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const modifiers = parsed.modifiers.map((part) => modifierMap[part] ?? part);
  const key = displayKey(parsed.key, platform);
  return platform === "mac"
    ? `${modifiers.join("")}${key}`
    : [...modifiers, key].filter(Boolean).join("+");
}

export function keybindingsForCommand(
  commandId: EditorCommandId,
): EditorKeybinding[] {
  return EDITOR_KEYBINDINGS.filter(
    (binding) => binding.commandId === commandId,
  );
}

/**
 * Minimal subset of `KeyboardEvent` we need to recognise a chord. Keeps the
 * matcher testable without pulling in a DOM, and lets the keyboard handler in
 * `twyne-editor.tsx` consult the registry instead of hard-coding per-command
 * `if (key === "x")` branches.
 */
export interface ChordEvent {
  /** Lowercased `KeyboardEvent.key`, e.g. `"f"`, `"/"`, `"?"`. */
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Does this keyboard event satisfy the given chord? Modifiers are matched as
 * a set: `Mod` accepts whichever of `metaKey`/`ctrlKey` is the platform's
 * primary modifier (caller decides by passing `metaKey: true` for ⌘ and
 * `ctrlKey: true` for Ctrl). Plain `Tab` / `Shift-Tab` chords ignore the
 * modifier check entirely.
 */
export function chordMatches(event: ChordEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  const wantsMod = parsed.modifiers.includes("Mod");
  const wantsCtrl = parsed.modifiers.includes("Ctrl");
  const wantsAlt = parsed.modifiers.includes("Alt");
  const wantsShift = parsed.modifiers.includes("Shift");

  // `Mod` is the cross-platform primary modifier (⌘ on macOS, Ctrl elsewhere).
  // `Ctrl` is the literal control key — distinct so a future Linux binding can
  // use it without colliding with `Mod`. Either alone satisfies the event.
  const primary = event.metaKey || event.ctrlKey;
  if (wantsMod && !primary) return false;
  if (!wantsMod && !wantsCtrl && primary) return false;
  // When `Mod` is wanted the literal-Ctrl gate is redundant (Mod already
  // accepts Ctrl); skip it so a pure ⌘ press isn't disqualified.
  if (!wantsMod && wantsCtrl && !event.ctrlKey) return false;
  if (!wantsMod && !wantsCtrl && event.ctrlKey) return false;
  if (wantsAlt !== Boolean(event.altKey)) return false;
  if (wantsShift !== Boolean(event.shiftKey)) return false;

  // `parseShortcut` returns the trailing segment verbatim ("?", "/", "Tab").
  // Compare case-insensitively because `KeyboardEvent.key` is lowercase for
  // printable keys but `"Enter"` / `"Tab"` for the named ones.
  return parsed.key.toLowerCase() === event.key.toLowerCase();
}

export function shortcutHints(
  commandId: EditorCommandId,
  platform: ShortcutPlatform = shortcutPlatform(),
): string[] {
  return keybindingsForCommand(commandId).map((binding) =>
    formatShortcut(binding.shortcut, platform),
  );
}

export interface KeybindingListEntry {
  commandId: EditorCommandId;
  label: string;
  description: string;
  group: string;
  shortcuts: string[];
}

/** Registry-backed rows consumed by both shortcut UIs. */
export function keybindingList(
  platform: ShortcutPlatform = shortcutPlatform(),
): KeybindingListEntry[] {
  const commands = new Map(
    EDITOR_COMMANDS.map((command) => [command.id, command]),
  );
  const ids = [
    ...new Set(EDITOR_KEYBINDINGS.map((binding) => binding.commandId)),
  ];
  return ids.map((commandId) => {
    const command = commands.get(commandId)!;
    return {
      commandId,
      label: command.label,
      description: command.description,
      group: command.group,
      shortcuts: shortcutHints(commandId, platform),
    };
  });
}
