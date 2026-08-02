import { describe, expect, test } from "bun:test";
import { EDITOR_COMMANDS } from "./editor-commands";
import {
  EDITOR_KEYBINDINGS,
  chordMatches,
  formatShortcut,
  keybindingList,
  parseShortcut,
  shortcutHints,
  shortcutPlatform,
} from "./keybindings";

describe("keybinding registry", () => {
  test("every binding points at a real command", () => {
    const ids = new Set(EDITOR_COMMANDS.map((command) => command.id));
    for (const binding of EDITOR_KEYBINDINGS) {
      expect(ids.has(binding.commandId)).toBe(true);
    }
  });

  test("shortcuts are unique except deliberate alternatives for one command", () => {
    const owners = new Map<string, string>();
    for (const binding of EDITOR_KEYBINDINGS) {
      const previous = owners.get(binding.shortcut);
      expect(previous == null || previous === binding.commandId).toBe(true);
      owners.set(binding.shortcut, binding.commandId);
    }
  });

  test("platform detection handles Apple, Windows, and Linux", () => {
    expect(shortcutPlatform("MacIntel")).toBe("mac");
    expect(shortcutPlatform("iPhone")).toBe("mac");
    expect(shortcutPlatform("Win32")).toBe("windows");
    expect(shortcutPlatform("Linux x86_64")).toBe("linux");
  });

  test("Mac labels use familiar symbols", () => {
    expect(formatShortcut("Mod-b", "mac")).toBe("⌘B");
    expect(formatShortcut("Mod-Shift-z", "mac")).toBe("⌘⇧Z");
    expect(formatShortcut("Mod-Enter", "mac")).toBe("⌘↩");
    expect(formatShortcut("Shift-Tab", "mac")).toBe("⇧⇥");
  });

  test("Windows and Linux labels use named modifiers", () => {
    expect(formatShortcut("Mod-b", "windows")).toBe("Ctrl+B");
    expect(formatShortcut("Mod-Shift-z", "linux")).toBe("Ctrl+Shift+Z");
    expect(formatShortcut("Alt-ArrowDown", "windows")).toBe("Alt+↓");
  });

  test("parser separates modifiers from the key", () => {
    expect(parseShortcut("Mod-Alt-1")).toEqual({
      modifiers: ["Mod", "Alt"],
      key: "1",
    });
  });

  test("chordMatches honours modifier sets", () => {
    expect(chordMatches({ key: "f", metaKey: true }, "Mod-f")).toBe(true);
    expect(chordMatches({ key: "f", ctrlKey: true }, "Mod-f")).toBe(true);
    expect(chordMatches({ key: "f" }, "Mod-f")).toBe(false);
    expect(
      chordMatches({ key: "/", metaKey: true, shiftKey: true }, "Mod-/"),
    ).toBe(false);
    expect(
      chordMatches({ key: "/", metaKey: true, shiftKey: true }, "Mod-Shift-/"),
    ).toBe(true);
    expect(chordMatches({ key: "Tab" }, "Tab")).toBe(true);
    expect(chordMatches({ key: "Tab", shiftKey: true }, "Tab")).toBe(false);
    expect(chordMatches({ key: "Tab", shiftKey: true }, "Shift-Tab")).toBe(true);
  });

  test("a command can expose alternative bindings", () => {
    expect(shortcutHints("view.shortcuts", "mac")).toEqual(["⌘/", "⌘⇧/"]);
  });

  test("list rows use command metadata as their only label source", () => {
    const row = keybindingList("mac").find(
      (entry) => entry.commandId === "insert.page-break",
    );
    expect(row).toMatchObject({
      label: "Page break",
      group: "insert",
      shortcuts: ["⌘↩"],
    });
  });
});
