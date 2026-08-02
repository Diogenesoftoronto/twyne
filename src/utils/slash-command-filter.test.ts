import { describe, expect, test } from "bun:test";
import { getEditorCommand } from "./editor-commands";
import { fuzzyCommandScore, fuzzySlashCommands } from "./slash-command-filter";

describe("slash command fuzzy filtering", () => {
  test("exact and prefix labels rank ahead of synonyms", () => {
    const page = getEditorCommand("insert.page-break")!;
    const image = getEditorCommand("insert.image")!;
    expect(fuzzyCommandScore(page, "page break")).toBeGreaterThan(
      fuzzyCommandScore(image, "plate")!,
    );
    expect(fuzzyCommandScore(page, "page")).toBeGreaterThan(
      fuzzyCommandScore(page, "new page")!,
    );
  });

  test("ordered subsequences match common abbreviations", () => {
    expect(
      fuzzyCommandScore(getEditorCommand("insert.mermaid")!, "mmd"),
    ).not.toBeNull();
  });

  test("unrelated queries are excluded", () => {
    expect(
      fuzzyCommandScore(getEditorCommand("insert.table")!, "zebra"),
    ).toBeNull();
  });

  test("availability hides selection-only commands", () => {
    expect(
      fuzzySlashCommands("", { hasSelection: false }).map(
        (candidate) => candidate.command.id,
      ),
    ).not.toContain("review.comment");
    expect(
      fuzzySlashCommands("", { hasSelection: true }).map(
        (candidate) => candidate.command.id,
      ),
    ).toContain("review.comment");
  });

  test("shortcut hints come from the keybinding registry", () => {
    const pageBreak = fuzzySlashCommands("page break").find(
      (candidate) => candidate.command.id === "insert.page-break",
    );
    expect(pageBreak?.shortcut).toBe("⌘↩");
  });
});
