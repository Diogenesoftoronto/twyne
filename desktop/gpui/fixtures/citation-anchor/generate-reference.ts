/** Source contract probe in isolated JSDOM. It runs the exact extracted
 * findTextRange on actual ProseMirror documents, then the real EndnoteNode
 * command. No user browser, provider, manuscript or bibliography is modified.
 */
import { withEditor } from "../../../../src/components/editor/test-harness";
import { EndnoteNode } from "../../../../src/components/editor/extensions/endnote-node";
import { RawTypst, RawTypstInline } from "../../../../src/components/editor/extensions/raw-typst";
import { ImageNode } from "../../../../src/components/editor/extensions/image-node";
import { createTableCoreExtensions } from "../../../../src/components/editor/extensions/table-format";
import { findTextRange } from "../../tools/semantic-citation-anchor.generated";
import type { Node as PmNode } from "@tiptap/pm/model";

type TextBlock = { position: number; children: { offset: number; text: string }[] };
function nativeProjection(document: PmNode) {
  const blocks: TextBlock[] = [];
  const units = new Map<number, number>();
  let cursor = 0;
  function walk(node: PmNode, position: number) {
    if (node.isAtom && !node.isText) { cursor += 1; return; }
    if (node.isTextblock) {
      const start = cursor;
      const children: TextBlock["children"] = [];
      node.forEach((child, offset) => {
        if (child.isText && child.text) {
          children.push({ offset: cursor - start, text: child.text });
          for (let index = 0; index < child.text.length; index++) units.set(position + 1 + offset + index, cursor + index);
          cursor += child.text.length;
        } else { cursor += 1; }
      });
      blocks.push({ position: start - 1, children });
      cursor += 1; // Native editing projection's synthetic block newline.
      return;
    }
    node.forEach((child, offset) => walk(child, position + 1 + offset));
  }
  walk(document, -1);
  function mapRange(range: { from: number; to: number } | null) {
    if (!range) return null;
    const from = units.get(range.from);
    const last = units.get(range.to - 1);
    if (from === undefined || last === undefined) throw new Error("The original match did not point to text leaves.");
    return { from, to: last + 1 };
  }
  return { blocks, mapRange, lengthUtf16: cursor };
}

const inputs = [
  { name: "marks emoji combining and first match", html: '<p>Before <strong>support 🦊 <em>é</em></strong> after.</p><p>support 🦊 é again.</p>',
    quotes: [" support 🦊 é ", "support", "SUPPORT", "é", "after. support"] },
  { name: "JS whitespace and regex literals", html: '<p>Prelude 🦊 A\u00a0\ufeff<strong>B</strong> then a.*[b](c)?+${x}|^\\z.</p>',
    quotes: ["A B", "\u00a0A\t B\ufeff", "a.*[b](c)?+${x}|^\\z", "a.*[b](c)?+${x}|^\\Z", "\u00a0\ufeff\t "] },
  { name: "comment mark ends before unmarked footnote", html: '<p><span data-comment-id="writer-1" data-comment-author="Writer" data-comment-color="#722f37">A <strong>supporting passage</strong></span> remains.</p>',
    quotes: ["A supporting passage", "supporting passage", "remains."] },
  { name: "omitted inline atom and hard-break gaps", html: '<p>alpha<sup data-type="endnote" data-endnote-text="hidden-note-payload"></sup><br><span data-type="raw-typst-inline" data-typst-source="hidden-source-payload"></span><em>beta</em> tail.</p>',
    quotes: ["alphabeta", "alpha beta", "beta", "hidden-note-payload", "hidden-source-payload"] },
  { name: "no cross-paragraph and case sensitive", html: '<p>alpha</p><p>beta</p><p>Case matters</p>',
    quotes: ["alpha beta", "alphabeta", "Case matters", "case matters", ""] },
  { name: "container order and nested cell", html: '<h2>Earlier heading</h2><blockquote><p>First repeated phrase.</p></blockquote><ul><li><p>First repeated phrase.</p><ul><li><p>Nested 🦊 cell.</p></li></ul></li></ul><table><tbody><tr><td><p>Table 🦊 only.</p></td><td><p>Other cell.</p></td></tr></tbody></table>',
    quotes: ["First repeated", "Nested 🦊 cell.", "Table 🦊 only.", "only. Other", "Earlier heading First"] },
  { name: "block atoms omit caption and source", html: '<figure data-type="image"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" alt="hidden-alt"><figcaption>hidden-caption</figcaption></figure><div data-type="raw-typst" data-typst-source="hidden-block-source"></div><p>Visible supporting passage.</p>',
    quotes: ["hidden-alt", "hidden-caption", "hidden-block-source", "Visible supporting passage."] },
];
const noteText = 'A & "B" — 東京 🦊';
const cases: unknown[] = [];
for (const input of inputs) {
  await withEditor({ content: input.html, extensions: [EndnoteNode, RawTypst, RawTypstInline, ImageNode, ...createTableCoreExtensions({resizable:false})] }, ({editor}) => {
    const html = editor.getHTML();
    const projection = nativeProjection(editor.state.doc);
    const matches = input.quotes.map(quote => {
      const originalRange = findTextRange(editor.state.doc, quote);
      return { quote, originalPmRange: originalRange, nativeUtf16Range: projection.mapRange(originalRange) };
    });
    const first = matches.find(match => match.originalPmRange);
    let footnote = null;
    if (first?.originalPmRange) {
      const inserted = editor.chain().setTextSelection(first.originalPmRange.to).setFootnote({text:noteText}).run();
      if (!inserted) throw new Error("The original footnote command refused the first matched passage.");
      footnote = { quote: first.quote, text:noteText, html:editor.getHTML(), from:first.nativeUtf16Range!.from, to:first.nativeUtf16Range!.to };
    }
    cases.push({name:input.name,html,blocks:projection.blocks,lengthUtf16:projection.lengthUtf16,matches,footnote});
  });
}
const source = await Bun.file(`${import.meta.dir}/../../../../src/components/editor/twyne-editor.tsx`).text();
await Bun.write(`${import.meta.dir}/source-reference.json`, JSON.stringify({
  provenance: "Exact extracted Source findTextRange on actual ProseMirror documents, and actual EndnoteNode.setFootnote in isolated JSDOM. No browser, provider, user manuscript, or bibliography changed.",
  editorSourceSha256: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
  cases,
}, null, 2) + "\n");
console.log(`Wrote ${cases.length} original PM anchor/footnote cases with ${inputs.reduce((sum,input)=>sum+input.quotes.length,0)} match probes.`);
