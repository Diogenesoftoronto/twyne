import { describe, expect, test } from "bun:test";
import { withEditor } from "../../../../../src/components/editor/test-harness";
import { MathExtensions } from "../../../../../src/components/editor/extensions/math";
import { getEditorCommand, isEditorCommandAvailable } from "../../../../../src/utils/editor-commands";
import reference from "./source-reference.json";

describe("actual Source math source commits", () => {
  test("retained corpus hashes match the original executed extensions", async () => {
    for (const [file, hash] of Object.entries(reference.sourceHashes)) {
      const bytes = await Bun.file(new URL(`../../../../../${file}`, import.meta.url)).arrayBuffer();
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(hash);
    }
  });

  test("replays original raw commits and real Undo/Redo, without preview DOM in HTML", async () => {
    for (const input of reference.cases) {
      await withEditor({ content: input.html, extensions: MathExtensions }, ({ editor }) => {
        let pos: number | undefined;
        editor.state.doc.descendants((node, position) => {
          if (pos === undefined && ["inlineMath", "blockMath"].includes(node.type.name)) pos = position;
        });
        expect(pos).toBeDefined();
        expect(editor.commands.setNodeSelection(pos!)).toBe(true);
        expect(editor.getHTML()).toBe(input.before.html);
        expect(editor.state.selection.toJSON()).toEqual(input.before.selection);
        expect(editor.commands.updateMathSource(input.raw)).toBe(true);
        expect(editor.state.doc.nodeAt(pos!)?.attrs.source).toBe(input.raw);
        expect(editor.getHTML()).toBe(input.after.html);
        expect(editor.state.selection.toJSON()).toEqual(input.after.selection);
        expect(editor.getHTML()).not.toContain("data-math-source-editor");
        expect(editor.getHTML()).not.toContain('class="katex"');
        expect(editor.commands.undo()).toBe(true);
        expect(editor.getHTML()).toBe(input.undone.html);
        expect(editor.state.selection.toJSON()).toEqual(input.undone.selection);
        expect(editor.commands.redo()).toBe(true);
        expect(editor.getHTML()).toBe(input.redone.html);
        expect(editor.state.selection.toJSON()).toEqual(input.redone.selection);
      });
    }
  });

  test("original insert catalogue creates empty source atoms and gates editable availability", async () => {
    for (const [id, name] of [["insert.math-inline", "inlineMath"], ["insert.math-block", "blockMath"]] as const) {
      const command = getEditorCommand(id)!;
      expect(command).toBeDefined();
      expect(isEditorCommandAvailable(command, { readOnly: false })).toBe(true);
      expect(isEditorCommandAvailable(command, { readOnly: true })).toBe(false);
      await withEditor({ content: "<p>Before after</p>", extensions: MathExtensions }, ({ editor }) => {
        editor.commands.setTextSelection(8);
        const inserted = name === "inlineMath"
          ? editor.commands.setInlineMath({ source: "" })
          : editor.commands.setBlockMath({ source: "" });
        expect(inserted).toBe(true);
        let source: unknown = undefined;
        editor.state.doc.descendants((node) => {
          if (node.type.name === name) source = node.attrs.source;
        });
        expect(source).toBe("");
        expect(editor.getHTML()).toContain('data-latex=""');
        expect(editor.getHTML()).toContain(`aria-label="${name === "inlineMath" ? "Inline" : "Block"} equation: empty"`);
      });
    }
  });
});
