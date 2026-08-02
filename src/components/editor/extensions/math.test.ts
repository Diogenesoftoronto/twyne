import { describe, expect, test } from "bun:test";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { withEditor } from "../test-harness";
import { BlockMath, InlineMath } from "./math";

const extensions = [InlineMath, BlockMath];

describe("LaTeX math extension", () => {
  test("inserts inline and block math with portable source attributes", async () => {
    await withEditor(
      { content: "<p>Euler: </p>", extensions },
      ({ editor, html }) => {
        editor.commands.setTextSelection(8);
        editor.commands.setInlineMath({ source: "e^{i\\pi}+1=0" });
        editor.commands.setBlockMath({ source: "\\int_0^1 x^2\\,dx" });

        expect(html()).toContain('data-type="inline-math"');
        expect(html()).toContain('data-type="block-math"');
        expect(html()).toContain('data-math-display="inline"');
        expect(html()).toContain('data-math-display="block"');
        expect(html()).toContain('data-latex="e^{i\\pi}+1=0"');
        expect(html()).toContain('data-latex="\\int_0^1 x^2\\,dx"');
      },
    );
  });

  test("round-trips raw LaTeX without requiring rendered KaTeX markup", async () => {
    const source = String.raw`\frac{a & b}{c < d}`;

    await withEditor({ content: "<p>Before</p>", extensions }, ({ editor }) => {
      editor.commands.setInlineMath({ source });
      const saved = editor.getHTML();
      expect(saved).toContain("data-latex=");

      editor.commands.setContent(saved);
      const mathNodes: ProseMirrorNode[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "inlineMath") {
          mathNodes.push(node);
          return false;
        }
        return true;
      });
      const inlineMath = mathNodes[0];
      expect(inlineMath).not.toBeNull();
      expect(inlineMath).toBeDefined();
      if (!inlineMath) throw new Error("Expected an inline math node.");
      expect(inlineMath.type.name).toBe("inlineMath");
      expect(inlineMath.attrs.source).toBe(source);
    });
  });

  test("parses legacy portable elements that only carry data attributes", async () => {
    const content =
      '<p>A <span data-math-display="inline" data-latex="x^2">x^2</span></p>' +
      '<div data-math-display="block" data-latex="y^2">y^2</div>';

    await withEditor({ content, extensions }, ({ editor }) => {
      const names: string[] = [];
      editor.state.doc.descendants((node) => {
        names.push(node.type.name);
        return true;
      });

      expect(names).toContain("inlineMath");
      expect(names).toContain("blockMath");
      expect(editor.getHTML()).toContain('data-type="inline-math"');
      expect(editor.getHTML()).toContain('data-type="block-math"');
    });
  });

  test("updates a selected math node through the public command", async () => {
    await withEditor(
      {
        content: '<p><span data-type="inline-math" data-latex="x">x</span></p>',
        extensions,
      },
      ({ editor }) => {
        expect(editor.commands.setNodeSelection(1)).toBe(true);
        expect(editor.commands.updateMathSource("x+1")).toBe(true);
        expect(editor.getHTML()).toContain('data-latex="x+1"');
      },
    );
  });

  test("declares block equations atomic and isolating for pagination", async () => {
    await withEditor({ extensions }, ({ editor }) => {
      const block = editor.schema.nodes.blockMath;
      expect(block.isAtom).toBe(true);
      expect(block.spec.isolating).toBe(true);
      expect(block.spec.selectable).toBe(true);
      expect(block.spec.draggable).toBe(true);
    });
  });

  test("keeps empty source recoverable instead of dropping the node", async () => {
    await withEditor({ extensions }, ({ editor }) => {
      editor.commands.setBlockMath({ source: "" });
      expect(editor.getHTML()).toContain('data-type="block-math"');
      expect(editor.getHTML()).toContain('data-latex=""');
    });
  });
});
