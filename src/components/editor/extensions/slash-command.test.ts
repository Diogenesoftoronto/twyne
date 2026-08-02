import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import { getSlashCommandState, SlashCommand } from "./slash-command";

describe("SlashCommand extension", () => {
  test("opens on a slash query at the cursor", async () => {
    await withEditor(
      { content: "<p>/hea</p>", extensions: [SlashCommand] },
      ({ editor }) => {
        editor.commands.setTextSelection(5);
        expect(getSlashCommandState(editor.state)).toMatchObject({
          open: true,
          query: "hea",
          from: 1,
          to: 5,
        });
      },
    );
  });

  test("does not open for a slash embedded in a word", async () => {
    await withEditor(
      { content: "<p>one/two</p>", extensions: [SlashCommand] },
      ({ editor }) => {
        editor.commands.setTextSelection(8);
        expect(getSlashCommandState(editor.state).open).toBe(false);
      },
    );
  });

  test("removing the query retains the surrounding prose", async () => {
    await withEditor(
      { content: "<p>Before /hea</p>", extensions: [SlashCommand] },
      ({ editor }) => {
        editor.commands.setTextSelection(12);
        expect(editor.commands.removeSlashCommandQuery()).toBe(true);
        expect(editor.getText()).toBe("Before ");
        expect(getSlashCommandState(editor.state).open).toBe(false);
      },
    );
  });

  test("Escape closes without altering manuscript HTML", async () => {
    await withEditor(
      { content: "<p>/hea</p>", extensions: [SlashCommand] },
      ({ editor }) => {
        editor.commands.setTextSelection(5);
        const before = editor.getHTML();
        editor.commands.closeSlashCommand();
        expect(getSlashCommandState(editor.state).open).toBe(false);
        expect(editor.getHTML()).toBe(before);
      },
    );
  });
});
