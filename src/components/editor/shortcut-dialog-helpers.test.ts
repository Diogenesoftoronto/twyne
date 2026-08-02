import { describe, expect, test } from "bun:test";
import { keybindingList } from "../../utils/keybindings";
import { filterKeybindingEntries } from "./shortcut-dialog-helpers";

const entries = keybindingList("mac");

describe("shortcut dialog filtering", () => {
  test("empty query keeps the complete reference", () => {
    expect(filterKeybindingEntries(entries, "")).toHaveLength(entries.length);
  });

  test("finds command labels and descriptions", () => {
    expect(
      filterKeybindingEntries(entries, "page break").map(
        (entry) => entry.commandId,
      ),
    ).toContain("insert.page-break");
  });

  test("finds rendered shortcut labels", () => {
    expect(
      filterKeybindingEntries(entries, "⌘⇧z").map((entry) => entry.commandId),
    ).toContain("history.redo");
  });

  test("all query terms must match", () => {
    expect(filterKeybindingEntries(entries, "find manuscript")).toHaveLength(1);
    expect(filterKeybindingEntries(entries, "find table")).toHaveLength(0);
  });
});
