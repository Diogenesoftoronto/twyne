/** Isolated Source command edges, separate from passage-matching fixtures. */
import { withEditor } from "../../../../src/components/editor/test-harness";
import { EndnoteNode } from "../../../../src/components/editor/extensions/endnote-node";
import { findTextRange } from "../../tools/semantic-citation-anchor.generated";

const cases: unknown[] = [];
for (const input of [
  { name:"code block target", content:"<pre><code>Supporting code passage.</code></pre>",quote:"Supporting code passage." },
  { name:"stored bold at same target caret", content:"<p>Supporting passage.</p>",quote:"Supporting passage." },
]) {
  await withEditor({content:input.content,extensions:[EndnoteNode]},({editor})=>{
    const before = editor.getHTML();
    const range = findTextRange(editor.state.doc,input.quote)!;
    if (input.name.includes("stored bold")) {
      editor.commands.setTextSelection(range.to);
      editor.commands.setBold();
    }
    const marksBefore = editor.state.storedMarks?.map(mark=>mark.type.name) ?? null;
    let inserted: boolean | null = null;
    let error: string | null = null;
    try { inserted = editor.chain().setTextSelection(range.to).setFootnote({text:"Source edge note"}).run(); }
    catch(value) { error = value instanceof Error ? value.message : String(value); }
    const after = editor.getHTML();
    const marksAfter = editor.state.storedMarks?.map(mark=>mark.type.name) ?? null;
    editor.commands.insertContent("X");
    cases.push({name:input.name,before,range,marksBefore,inserted,error,after,marksAfter,afterTyping:editor.getHTML()});
  });
}
await Bun.write(`${import.meta.dir}/source-command-edges.json`,JSON.stringify({
  provenance:"Original Tiptap/EndnoteNode command chain in isolated JSDOM; no browser, bibliography or user manuscript modified.",cases,
},null,2)+"\n");
console.log(JSON.stringify(cases,null,2));
