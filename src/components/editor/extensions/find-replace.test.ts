import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import {
  FindReplace,
  findMatchesInDocument,
  getFindReplaceState,
} from "./find-replace";

const extensions = [FindReplace];

describe("FindReplace extension", () => {
  test("finds across inline mark boundaries but not across paragraphs", async () => {
    await withEditor(
      {
        content: "<p>sea<strong>shell</strong></p><p>sea shell</p>",
        extensions,
      },
      ({ editor }) => {
        const result = findMatchesInDocument(editor.state.doc, {
          search: "seashell",
          caseSensitive: false,
          wholeWord: false,
          regex: false,
        });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].text).toBe("seashell");
      },
    );
  });

  test("query and navigation change neither HTML nor undo history", async () => {
    await withEditor(
      { content: "<p>one two one</p>", extensions },
      ({ editor, html }) => {
        const before = html();
        editor.commands.setFindQuery("one");
        editor.commands.findNext();
        editor.commands.findNext();
        editor.commands.findPrevious();

        expect(html()).toBe(before);
        const state = getFindReplaceState(editor.state)!;
        expect(state.matches).toHaveLength(2);
        expect(state.activeIndex).toBe(0);
        expect(state.decorations.find()).toHaveLength(2);
        expect(editor.commands.undo()).toBe(false);
      },
    );
  });

  test("next and previous wrap and select the active match", async () => {
    await withEditor(
      { content: "<p>one two one</p>", extensions },
      ({ editor }) => {
        editor.commands.setFindQuery("one");
        editor.commands.findNext();
        const first = editor.state.selection.from;
        editor.commands.findNext();
        const second = editor.state.selection.from;
        expect(second).toBeGreaterThan(first);
        editor.commands.findNext();
        expect(editor.state.selection.from).toBe(first);
        editor.commands.findPrevious();
        expect(editor.state.selection.from).toBe(second);
      },
    );
  });

  test("supports case, whole-word, regex, and recoverable regex errors", async () => {
    await withEditor(
      { content: "<p>cat Cat scatter cat</p>", extensions },
      ({ editor }) => {
        editor.commands.setFindQuery("cat", {
          caseSensitive: true,
          wholeWord: true,
        });
        expect(getFindReplaceState(editor.state)?.matches).toHaveLength(2);

        editor.commands.setFindQuery("c.t", { regex: true });
        expect(getFindReplaceState(editor.state)?.matches).toHaveLength(4);

        editor.commands.setFindQuery("[", { regex: true });
        // The replacement itself contains "Lovelace, Ada", but no longer
        // satisfies the original "First Last" expression.
        expect(getFindReplaceState(editor.state)?.matches).toHaveLength(0);
        expect(getFindReplaceState(editor.state)?.error).toBeString();
      },
    );
  });

  test("replaceCurrent changes one active result and is one undo step", async () => {
    await withEditor(
      { content: "<p>one two one</p>", extensions },
      ({ editor }) => {
        editor.commands.setFindQuery("one");
        editor.commands.findNext();
        expect(editor.commands.replaceCurrent("three")).toBe(true);
        expect(editor.getText()).toBe("three two one");
        expect(getFindReplaceState(editor.state)?.matches).toHaveLength(1);

        editor.commands.undo();
        expect(editor.getText()).toBe("one two one");
      },
    );
  });

  test("replaceAll runs from the end, expands regex captures, and is one undo step", async () => {
    await withEditor(
      { content: "<p>Ada Lovelace and Grace Hopper</p>", extensions },
      ({ editor }) => {
        editor.commands.setFindQuery("([A-Z]\\w+) (Lovelace|Hopper)", {
          regex: true,
          caseSensitive: true,
        });
        expect(editor.commands.replaceAll("$2, $1")).toBe(true);
        expect(editor.getText()).toBe("Lovelace, Ada and Hopper, Grace");
        expect(getFindReplaceState(editor.state)?.matches).toHaveLength(0);

        editor.commands.undo();
        expect(editor.getText()).toBe("Ada Lovelace and Grace Hopper");
      },
    );
  });

  test("clear removes decorations without changing manuscript HTML", async () => {
    await withEditor(
      { content: "<p>one one</p>", extensions },
      ({ editor, html }) => {
        const before = html();
        editor.commands.setFindQuery("one");
        expect(
          getFindReplaceState(editor.state)?.decorations.find(),
        ).toHaveLength(2);
        editor.commands.clearFindQuery();
        expect(
          getFindReplaceState(editor.state)?.decorations.find(),
        ).toHaveLength(0);
        expect(html()).toBe(before);
      },
    );
  });
});
