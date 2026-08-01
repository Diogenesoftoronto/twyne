import { describe, expect, test } from "bun:test";
import { withEditor } from "./test-harness";
import { Indent, INDENT_STEP_REM, MAX_INDENT_LEVEL } from "./extensions/indent";

/**
 * Tab used to fall through to the browser and move focus out of the document.
 * What matters here is that an indent is a real, persisted attribute rather
 * than a screen effect: it has to survive the HTML round-trip, because that
 * HTML is what gets exported, printed to PDF, and synced.
 */
describe("indent", () => {
  const opts = { extensions: [Indent] };

  test("indent adds a left margin to the paragraph", async () => {
    await withEditor(
      { ...opts, content: "<p>Filed from the desk.</p>" },
      ({ editor, html }) => {
        editor.commands.setTextSelection(2);
        expect(editor.commands.indent()).toBe(true);
        expect(html()).toContain(`margin-left: ${INDENT_STEP_REM}rem`);
        expect(html()).toContain('data-indent="1"');
      },
    );
  });

  test("the indent survives a round-trip through HTML", async () => {
    await withEditor({ ...opts, content: "<p>One.</p>" }, ({ editor }) => {
      editor.commands.setTextSelection(2);
      editor.commands.indent();
      editor.commands.indent();
      const exported = editor.getHTML();

      // Re-parsing is what an import, a reload, or a sync does.
      editor.commands.setContent(exported);
      expect(editor.getHTML()).toContain('data-indent="2"');
    });
  });

  test("outdent walks it back and stops at zero", async () => {
    await withEditor(
      { ...opts, content: "<p>Two.</p>" },
      ({ editor, html }) => {
        editor.commands.setTextSelection(2);
        editor.commands.indent();
        expect(editor.commands.outdent()).toBe(true);
        expect(html()).not.toContain("data-indent");
        // Nothing left to give back — the command reports no change.
        expect(editor.commands.outdent()).toBe(false);
      },
    );
  });

  test("indent stops at the maximum rather than running off the page", async () => {
    await withEditor(
      { ...opts, content: "<p>Three.</p>" },
      ({ editor, html }) => {
        editor.commands.setTextSelection(2);
        for (let i = 0; i < MAX_INDENT_LEVEL + 4; i += 1) {
          editor.commands.indent();
        }
        expect(html()).toContain(`data-indent="${MAX_INDENT_LEVEL}"`);
        expect(editor.commands.indent()).toBe(false);
      },
    );
  });

  test("a selection spanning several paragraphs indents all of them", async () => {
    await withEditor(
      { ...opts, content: "<p>First.</p><p>Second.</p><p>Third.</p>" },
      ({ editor, html }) => {
        editor.commands.selectAll();
        expect(editor.commands.indent()).toBe(true);
        const matches = html().match(/data-indent="1"/g) ?? [];
        expect(matches.length).toBe(3);
      },
    );
  });

  test("headings indent too, but list items are left to the list", async () => {
    await withEditor(
      { ...opts, content: "<h2>A heading</h2>" },
      ({ editor, html }) => {
        editor.commands.setTextSelection(2);
        editor.commands.indent();
        expect(html()).toContain('data-indent="1"');
      },
    );

    await withEditor(
      { ...opts, content: "<ul><li><p>An item</p></li></ul>" },
      ({ editor, html }) => {
        editor.commands.setTextSelection(3);
        // The paragraph inside a list item is a layout wrapper; indenting it
        // would fight the list's own nesting.
        editor.commands.indent();
        expect(html()).not.toContain("margin-left");
      },
    );
  });
});
