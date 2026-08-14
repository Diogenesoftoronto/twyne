import { describe, expect, test } from "bun:test";
import {
  EDITOR_COMMANDS,
  type EditorCommandId,
} from "../../utils/editor-commands";
import type { SlashCommandCandidate } from "../../utils/slash-command-filter";
import {
  moveSlashSelection,
  reconcileSlashSelection,
} from "./slash-command-menu";

function candidate(id: EditorCommandId): SlashCommandCandidate {
  const command = EDITOR_COMMANDS.find((entry) => entry.id === id);
  if (!command) throw new Error(`Missing editor command fixture: ${id}`);
  return {
    command,
    score: 0,
    shortcut: null,
  };
}

describe("slash command menu selection", () => {
  const heading = candidate("paragraph.heading-1");
  const quote = candidate("paragraph.blockquote");
  const table = candidate("insert.table");

  test("preserves the selected command by ID when results reorder", () => {
    expect(
      reconcileSlashSelection([table, heading, quote], "paragraph.heading-1"),
    ).toBe("paragraph.heading-1");
  });

  test("selects the first visible result when the old selection disappears", () => {
    expect(reconcileSlashSelection([quote, table], "paragraph.heading-1")).toBe(
      "paragraph.blockquote",
    );
  });

  test("clears selection for an empty result set", () => {
    expect(reconcileSlashSelection([], "paragraph.heading-1")).toBeNull();
  });

  test("arrow navigation wraps within the visible result set", () => {
    expect(moveSlashSelection([heading, quote], "paragraph.heading-1", -1)).toBe(
      "paragraph.blockquote",
    );
    expect(moveSlashSelection([heading, quote], "paragraph.blockquote", 1)).toBe(
      "paragraph.heading-1",
    );
  });
});
