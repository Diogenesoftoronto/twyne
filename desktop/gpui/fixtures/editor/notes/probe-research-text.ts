/** e.getText() from the exact installed schema, not PM textBetween. */
import { withEditor } from "../../../../../src/components/editor/test-harness";
import { InlineNoteNode } from "../../../../../src/components/editor/extensions/inline-note-popover";
import { RawTypst,RawTypstInline } from "../../../../../src/components/editor/extensions/raw-typst";
import { InlineMath,BlockMath } from "../../../../../src/components/editor/extensions/math";
import { MermaidDiagram } from "../../../../../src/components/editor/extensions/mermaid-node";
import { ImageNode } from "../../../../../src/components/editor/extensions/image-node";
import { createTableCoreExtensions } from "../../../../../src/components/editor/extensions/table-format";
const inputs = [
  {name:"prose hardbreak and notes",html:'<h2>東京 🦊 é</h2><p>A<br>B<sup data-type="footnote" data-endnote-text="hidden"></sup>C</p><p></p><p>tail</p>'},
  {name:"image and source/math atoms",html:'<p>inline <span data-type="inline-math" data-latex="x + y"></span> <span data-type="raw-typst-inline" data-typst-source="#unknown[hidden]"></span> end.</p><figure data-type="image"><img src="file:///offline.png" alt="東京 🦊"><figcaption>hidden caption</figcaption></figure><div data-type="block-math" data-latex="z^2"></div><div data-type="raw-typst" data-typst-source="#unknown[hidden]"></div><div data-type="mermaid-diagram" data-mermaid-source="graph TD;A-->B"></div><p>after</p>'},
  {name:"nested blocks and code",html:'<blockquote><p>quote</p><p>next</p></blockquote><ul><li><p>list1</p></li><li><p>list2</p><ul><li><p>nested</p></li></ul></li></ul><table><tbody><tr><td><p>cell1</p></td><td><p>cell2</p></td></tr></tbody></table><pre><code>A\nB\t🦊</code></pre>'},
  {name:"empty atoms separators",html:'<figure data-type="image"><img src="file:///offline.png" alt=""></figure><div data-type="page-break"></div><hr><p></p><p>A</p>'},
];
const cases: unknown[]=[];
for(const input of inputs)await withEditor({content:input.html,extensions:[InlineNoteNode,RawTypst,RawTypstInline,InlineMath,BlockMath,MermaidDiagram,ImageNode,...createTableCoreExtensions({resizable:false})]},({editor})=>{
  cases.push({name:input.name,html:editor.getHTML(),text:editor.getText(),json:editor.getJSON()});
});
await Bun.write(`${import.meta.dir}/research-text-reference.json`,JSON.stringify({provenance:"Actual current Tiptap Editor.getText() with the original active note/image/math/source/mermaid/table extensions, in isolated JSDOM; exact schema text serializers, including HardBreak and image/math renderText.",cases},null,2)+"\n");
console.log(`Recorded ${cases.length} original schema getText cases.`);
