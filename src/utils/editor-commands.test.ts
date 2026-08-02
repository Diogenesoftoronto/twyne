import { describe, expect, test } from "bun:test";
import {
  EDITOR_COMMANDS,
  filterEditorCommands,
  getEditorCommand,
  getSlashCommands,
  isEditorCommandAvailable,
} from "./editor-commands";

describe("editor command registry", () => {
  test("ids are unique and stable-looking", () => {
    const ids = EDITOR_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(?:[.-][a-z0-9]+)+$/);
  });

  test("every command has useful search metadata", () => {
    for (const command of EDITOR_COMMANDS) {
      expect(command.label.trim().length).toBeGreaterThan(1);
      expect(command.description.trim().length).toBeGreaterThan(8);
      expect(command.surfaces.length).toBeGreaterThan(0);
    }
  });

  test("lookup returns the stable definition", () => {
    expect(getEditorCommand("insert.page-break")?.label).toBe("Page break");
    expect(getEditorCommand("not-a-command")).toBeUndefined();
  });

  test("filters by group and surface", () => {
    const insertSlash = filterEditorCommands({
      group: "insert",
      surface: "slash",
    });
    expect(insertSlash.length).toBeGreaterThan(5);
    expect(insertSlash.every((command) => command.group === "insert")).toBe(
      true,
    );
    expect(insertSlash.every((command) => command.slash != null)).toBe(true);
  });

  test("search uses labels, descriptions, ids, and synonyms", () => {
    expect(filterEditorCommands({ query: "plate" }).map((c) => c.id)).toContain(
      "insert.image",
    );
    expect(
      filterEditorCommands({
        query: "table row",
        includeUnavailable: true,
      }).map((c) => c.id),
    ).toContain("table.add-row-before");
    expect(filterEditorCommands({ query: "toc" }).map((c) => c.id)).toContain(
      "navigate.outline",
    );
  });

  test("availability depends only on the supplied context", () => {
    const comment = getEditorCommand("review.comment")!;
    expect(isEditorCommandAvailable(comment, { hasSelection: false })).toBe(
      false,
    );
    expect(isEditorCommandAvailable(comment, { hasSelection: true })).toBe(
      true,
    );

    const merge = getEditorCommand("table.merge-cells")!;
    expect(
      isEditorCommandAvailable(merge, {
        inTable: true,
        canMergeCells: false,
      }),
    ).toBe(false);
    expect(
      isEditorCommandAvailable(merge, {
        inTable: true,
        canMergeCells: true,
      }),
    ).toBe(true);
  });

  test("read-only contexts hide editing but retain view commands", () => {
    expect(
      filterEditorCommands({
        context: { readOnly: true, hasDocument: true },
      }).map((command) => command.id),
    ).toContain("view.shortcuts");
    expect(
      filterEditorCommands({
        context: { readOnly: true, hasDocument: true },
      }).map((command) => command.id),
    ).not.toContain("format.bold");
  });

  test("slash commands are ordered and unavailable commands are hidden", () => {
    const commands = getSlashCommands("", {
      hasSelection: false,
      hasDocument: true,
    });
    expect(commands.map((command) => command.id)).not.toContain(
      "review.comment",
    );
    for (let i = 1; i < commands.length; i++) {
      const previous = commands[i - 1].slash!;
      const current = commands[i].slash!;
      expect(
        previous.group.localeCompare(current.group) < 0 ||
          (previous.group === current.group && previous.order <= current.order),
      ).toBe(true);
    }
  });
});
