import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";

/**
 * The page break's job is to survive: it has to round-trip through the saved
 * HTML, because a manuscript is stored as HTML and reopened from it. A break
 * that renders but does not parse would silently vanish the first time the
 * writer closed the folio.
 */
describe("pageBreak node", () => {
  test("setPageBreak inserts a break", async () => {
    await withEditor({ content: "<p>Before</p>" }, ({ editor, html }) => {
      editor.commands.setPageBreak();
      expect(html()).toContain('data-type="page-break"');
    });
  });

  test("the break round-trips through saved HTML", async () => {
    await withEditor({ content: "<p>Before</p>" }, ({ editor }) => {
      editor.commands.setPageBreak();
      const saved = editor.getHTML();

      // Reopening the folio must produce the same document, not a paragraph
      // where the break used to be.
      editor.commands.setContent(saved);
      expect(editor.getHTML()).toBe(saved);

      let found = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "pageBreak") found++;
        return true;
      });
      expect(found).toBe(1);
    });
  });

  test("the break carries a data attribute the exporter can read", async () => {
    // Export and print key off `data-page-break` rather than the CSS class,
    // so a manuscript opened outside Twyne still breaks in the right place.
    await withEditor({ content: "<p>x</p>" }, ({ editor, html }) => {
      editor.commands.setPageBreak();
      expect(html()).toContain('data-page-break="true"');
    });
  });

  test("the caret lands after the break when splitting a paragraph", async () => {
    await withEditor({ content: "<p>Before</p>" }, ({ editor }) => {
      editor.commands.setTextSelection(3);
      editor.commands.setPageBreak();
      const { $from } = editor.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
      const nodeBefore = editor.state.doc.resolve($from.before()).nodeBefore;
      expect(nodeBefore?.type.name).toBe("pageBreak");
    });
  });

  test("the caret lands after the break at the end of the document", async () => {
    // The end-of-document case has nothing to split, so the selection lands
    // on the atom itself. Left alone, the writer's next keystroke would
    // replace the break they just asked for.
    await withEditor({ content: "<p>Before</p>" }, ({ editor }) => {
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.commands.setPageBreak();
      const sel = editor.state.selection;
      expect(sel.constructor.name).toBe("TextSelection");
      expect(sel.$from.parent.type.name).toBe("paragraph");
      const nodeBefore = editor.state.doc.resolve(sel.$from.before()).nodeBefore;
      expect(nodeBefore?.type.name).toBe("pageBreak");
    });
  });

  test("the node is an atom, so one keystroke removes it", async () => {
    await withEditor({ content: "<p>x</p>" }, ({ editor }) => {
      editor.commands.setPageBreak();
      const type = editor.schema.nodes.pageBreak;
      expect(type.isAtom).toBe(true);
      expect(type.spec.selectable).toBe(true);
    });
  });

  test("several breaks can coexist", async () => {
    await withEditor({ content: "<p>a</p>" }, ({ editor }) => {
      editor.commands.setPageBreak();
      editor.commands.setPageBreak();
      editor.commands.setPageBreak();
      let found = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "pageBreak") found++;
        return true;
      });
      expect(found).toBe(3);
    });
  });

  test("Mod-Enter yields inside a code block so exitCode still works", async () => {
    // Mod-Enter is bound three ways: hard break, exitCode, and now this.
    // Escaping a code block has no other keystroke, so it wins there.
    await withEditor({ content: "<pre><code>let x = 1</code></pre>" }, ({
      editor,
    }) => {
      editor.commands.setTextSelection(5);
      expect(editor.isActive("codeBlock")).toBe(true);

      const before = editor.getHTML();
      const handled = editor.commands.keyboardShortcut("Mod-Enter");
      // Whatever exitCode did or did not do, we must not have inserted a
      // page break into the code block.
      expect(editor.getHTML()).not.toContain("page-break");
      expect(handled || before !== editor.getHTML()).toBeTruthy();
    });
  });

  test("Mod-Enter inserts a break in ordinary prose", async () => {
    await withEditor({ content: "<p>Prose</p>" }, ({ editor, html }) => {
      editor.commands.setTextSelection(3);
      editor.commands.keyboardShortcut("Mod-Enter");
      expect(html()).toContain('data-type="page-break"');
    });
  });
});
