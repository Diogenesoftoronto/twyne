/** Execute the original math extension commands in the project's isolated
 * JSDOM harness. No browser process, storage, provider or network is used. */
import assert from "node:assert/strict";
import type { Node as PmNode } from "@tiptap/pm/model";
import { withEditor } from "../../../../../src/components/editor/test-harness";
import { MathExtensions } from "../../../../../src/components/editor/extensions/math";

const inline = '<p>Before 🦊 <span data-type="inline-math" data-latex="x+1">x+1</span> after é.</p>';
const marked = '<p>Before 🦊 <strong><span data-type="inline-math" data-latex="x+1">x+1</span></strong> after é.</p>';
const block = '<p>Prelude 🦊.</p><div data-type="block-math" data-latex="x+1">x+1</div><p>After é.</p>';
const cases = [
  { name: "inline authored whitespace", html: inline, raw: "  \\frac{a}{b}  " },
  { name: "inline marked atom", html: marked, raw: '\\text{A & "B" — 東京 🦊 é}' },
  { name: "block final newline", html: block, raw: "\\frac{1}{x}\n" },
  { name: "inline empty source", html: inline, raw: "" },
  { name: "block empty source", html: block, raw: "" },
  { name: "inline whitespace is raw truthy data", html: inline, raw: " \n\t " },
  { name: "inline invalid LaTeX remains authored source", html: inline, raw: "\\notACommand{" },
  { name: "block only draft before", html: '<div data-type="block-math" data-latex="x+1">x+1</div><p>After.</p>', raw: "y+2" },
  { name: "block only draft after", html: '<p>Before.</p><div data-type="block-math" data-latex="x+1">x+1</div>', raw: "y+2" },
];

// Translate actual PM positions to the native editing projection's UTF-16
// endpoints in one traversal. Math is one unit; paragraphs add one newline.
function positions(doc: PmNode) {
  const map = new Map<number, number>();
  let cursor = 0;
  const visit = (node: PmNode, pos: number) => {
    if (node.isText) {
      const text = node.text ?? "";
      for (let i = 0; i <= text.length; i++) map.set(pos + i, cursor + i);
      cursor += text.length;
      return;
    }
    if (node.isAtom && node.type.name !== "doc") {
      map.set(pos, cursor);
      map.set(pos + node.nodeSize, ++cursor);
      return;
    }
    if (node.isTextblock) {
      map.set(pos + 1, cursor);
      node.forEach((child, offset) => visit(child, pos + 1 + offset));
      map.set(pos + node.nodeSize - 1, cursor);
      map.set(pos + node.nodeSize, ++cursor);
      return;
    }
    node.forEach((child, offset) => visit(child, pos + 1 + offset));
  };
  visit(doc, -1);
  return { map, length: cursor };
}

const results: unknown[] = [];
for (const input of cases) {
  await withEditor({ content: input.html, extensions: MathExtensions }, ({ editor }) => {
    let pos: number | undefined;
    editor.state.doc.descendants((node, position) => {
      if (pos === undefined && ["inlineMath", "blockMath"].includes(node.type.name)) pos = position;
    });
    assert.notEqual(pos, undefined);
    assert.equal(editor.commands.setNodeSelection(pos!), true);
    const record = () => {
      const projection = positions(editor.state.doc);
      const { anchor, head } = editor.state.selection;
      const nativeAnchor = projection.map.get(anchor);
      const nativeHead = projection.map.get(head);
      assert.notEqual(nativeAnchor, undefined, `unmapped Source selection ${anchor}`);
      assert.notEqual(nativeHead, undefined, `unmapped Source selection ${head}`);
      return {
        html: editor.getHTML(),
        json: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        nativeUtf16Selection: { anchor: nativeAnchor!, head: nativeHead! },
        nativeUtf16Length: projection.length,
      };
    };
    const before = record();
    assert.equal(editor.commands.updateMathSource(input.raw), true);
    const after = record();
    assert.equal(editor.state.doc.nodeAt(pos!)?.attrs.source, input.raw);
    assert.equal(after.nativeUtf16Length, before.nativeUtf16Length);
    assert.equal(editor.commands.undo(), true);
    const undone = record();
    assert.equal(undone.html, before.html);
    assert.deepEqual(undone.nativeUtf16Selection, before.nativeUtf16Selection);
    assert.equal(editor.commands.redo(), true);
    const redone = record();
    assert.equal(redone.html, after.html);
    assert.deepEqual(redone.nativeUtf16Selection, after.nativeUtf16Selection);
    results.push({ ...input, before, after, undone, redone });
  });
}

const sourceFiles = [
  "src/components/editor/extensions/math.ts",
  "src/components/editor/math/math-source-editor.ts",
  "src/components/editor/test-harness.ts",
];
const hashes: Record<string, string> = {};
for (const file of sourceFiles) {
  hashes[file] = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(new URL(`../../../../../${file}`, import.meta.url)).arrayBuffer())
    .digest("hex");
}
await Bun.write(`${import.meta.dir}/source-reference.json`, `${JSON.stringify({
  provenance: "Executed original MathExtensions updateMathSource, current Tiptap/PM selection mapping and real Undo/Redo in the original isolated JSDOM harness. No source copy, browser process, provider, network, user manuscript or storage access.",
  sourceHashes: hashes,
  cases: results,
}, null, 2)}\n`);
console.log(`Recorded ${results.length} original math source/selection/Undo/Redo cases.`);
