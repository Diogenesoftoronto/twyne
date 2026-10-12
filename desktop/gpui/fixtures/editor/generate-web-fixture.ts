// Run from the repository root:
//   bun desktop/gpui/fixtures/editor/generate-web-fixture.ts
// This fixture comes from the real web editor extensions' getHTML(), not a
// hand-written approximation of their serialization contract.
import { withEditor } from "../../../../src/components/editor/test-harness";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TextAlign } from "@tiptap/extension-text-align";
import { ImageNode } from "../../../../src/components/editor/extensions/image-node";
import { EndnoteNode } from "../../../../src/components/editor/extensions/endnote-node";
import { RawTypst, RawTypstInline } from "../../../../src/components/editor/extensions/raw-typst";
import { MermaidDiagram } from "../../../../src/components/editor/extensions/mermaid-node";
import { ParagraphFormat } from "../../../../src/components/editor/extensions/paragraph-format";
import { Indent } from "../../../../src/components/editor/extensions/indent";
import { createTableCoreExtensions } from "../../../../src/components/editor/extensions/table-format";
import { TableCellFormat } from "../../../../src/components/editor/extensions/table-cell-format";
import { MathExtensions } from "../../../../src/components/editor/extensions/math";

const content = `<h1 style="text-align: center">The notebook</h1>
<p data-indent="2" data-space-after="12" data-keep-with-next="true" style="margin-left: 4rem; margin-bottom: 12pt; line-height: 1.5; break-after: avoid; page-break-after: avoid">“<strong><em>Élan 🦊</em></strong>,” <span style="font-family: 'Libre Baskerville'; font-size: 18px; color: #224466">the page</span> came alive with <u>underlining</u>, <s>striking</s>, <mark data-color="#ffee88" style="background-color: #ffee88; color: inherit">light</mark>, H<sub>2</sub>O and x<sup>2</sup>.</p>
<p><span data-comment-id="writer-1" data-comment-author="Writer" data-comment-color="#a93226">A <strong>grounded</strong> comment</span> and <span data-persona-note-id="cast-1" data-persona-note-author="Virginia" data-persona-note-label="Image" data-persona-note-note="Stay concrete." data-persona-note-quote="the page" data-persona-note-brief="">the page</span>; <span data-suggestion-id="proposal-1" data-suggestion-versionId="branch-1" data-suggestion-replacement="A patient opening" data-suggestion-rationale="Let the room carry it.">An opening</span>.</p>
<ul><li><p>First</p></li><li><p>Second <em>nested</em></p><ol start="3"><li><p>Third</p></li></ol></li></ul>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Completed</p></li><li data-type="taskItem" data-checked="false"><p>Pending</p></li></ul>
<blockquote><p>Keep the opening concrete.</p></blockquote>
<pre><code class="language-rust">let answer = 42;\nprintln!("{answer}");</code></pre>
<table data-table-caption="Results"><tbody><tr><th colspan="2" data-cell-background="#f4ecd8"><p>Measure</p></th></tr><tr><td colwidth="120"><p>Alpha</p></td><td data-cell-background="#ffeedd"><p>βeta</p></td></tr></tbody></table>
<figure data-type="image" data-image-align="right" data-image-width="50" data-image-aspect-ratio="1.5" data-image-id="image-1" data-image-offline="true" data-upload-status="failed" data-upload-error="Offline"><img src="data:image/png;base64,aGVsbG8=" alt="A landscape"><figcaption>The view from the train</figcaption></figure>
<p>Notes<sup data-type="footnote" data-endnote-text="A &amp; &quot;B&quot;"></sup><sup data-type="endnote" data-endnote-text="An endnote."></sup> and <span data-type="raw-typst-inline" data-typst-source="#custom[opaque]"></span>; <span data-type="inline-math" data-latex="\\frac{a}{b}"></span>.</p>
<div data-type="block-math" data-latex="x^2 + y^2 = z^2"></div>
<div data-type="raw-typst" data-typst-source="#let answer = 42; // keep the authored comment"></div>
<div data-type="mermaid-diagram" data-mermaid-source="graph LR; A--&gt;B"></div>
<div data-type="page-break"></div><hr><p>Page two.<br>Still here.</p>`;

await withEditor({ content, extensions: [
  Highlight.configure({ multicolor: true }), Subscript, Superscript,
  TextStyleKit.configure({ lineHeight: false }), TextAlign.configure({ types: ["heading", "paragraph"] }),
  TaskList.configure({ HTMLAttributes: { class: "twyne-task-list" } }), TaskItem.configure({ nested: true }),
  ImageNode, EndnoteNode, RawTypst, RawTypstInline, MermaidDiagram, ParagraphFormat, Indent,
  ...createTableCoreExtensions({ resizable: false }), TableCellFormat,
  ...MathExtensions,
] }, async ({ editor }) => {
  const html = editor.getHTML();
  await Bun.write(new URL("web-rich-document.html", import.meta.url), html);
});
