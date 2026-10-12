/** Exact project note helpers and ProseMirror parsing, in isolated JSDOM. */
import { withEditor } from "../../../../../src/components/editor/test-harness";
import { InlineNoteNode } from "../../../../../src/components/editor/extensions/inline-note-popover";
import { collectInlineNotes, updateInlineNote, convertInlineNote, deleteInlineNote, focusInlineNoteReference } from "../../../../../src/components/editor/note-editing";

const html = '<p>A 🦊<sup data-type="endnote" data-endnote-text="Alpha"></sup> <strong>B é</strong><sup data-type="footnote" data-endnote-text="Beta"></sup> C<sup data-type="endnote" data-endnote-text="Gamma"></sup></p>';
const steps: unknown[] = [];
await withEditor({content: html, extensions: [InlineNoteNode]}, ({editor}) => {
  const record = (action: string) => steps.push({action, html: editor.getHTML(), notes: collectInlineNotes(editor.state.doc), selection: editor.state.selection.toJSON()});
  record("initial");
  const first = collectInlineNotes(editor.state.doc)[0]!;
  focusInlineNoteReference(editor, first.pos);
  record("selected");
  updateInlineNote(editor, first.pos, {text:'A & "B" — 東京 🦊'});
  record("updated");
  convertInlineNote(editor, first.pos, "footnote");
  record("converted");
  updateInlineNote(editor, first.pos, {text:""});
  record("empty");
  deleteInlineNote(editor, first.pos);
  record("deleted");
});

const inputs = [
  {name:"host apparatus trailing LF",html:await Bun.file(`${import.meta.dir}/../../host-apparatus/native-manuscript.html`).text()},
  {name:"inter-block ASCII whitespace",html:" \t\r\n<h1>Title</h1>\n \t<p>A</p>\n\f\r<p>B</p>\n"},
  {name:"meaningful top-level text",html:"before<p>A</p>after"},
  {name:"inside prose and pre",html:"<p> A\n B \t</p>\n<pre><code> A\n B \t</code></pre>\n"},
  {name:"top-level NBSP is meaningful",html:"<p>A</p>\u00a0"},
];
const parser: unknown[] = [];
for (const input of inputs) {
  await withEditor({content: input.html,extensions:[InlineNoteNode]}, ({editor}) => {
    parser.push({...input,htmlAfterParse:editor.getHTML(),json:editor.getJSON()});
  });
}
await Bun.write(`${import.meta.dir}/source-reference.json`, JSON.stringify({
  provenance:"Actual active InlineNoteNode, original note-editing.ts helpers and current StarterKit ProseMirror parser in isolated JSDOM; no browser/user manuscript/provider mutation.",
  sourceFiles:["src/components/editor/extensions/inline-note-popover.ts","src/components/editor/note-editing.ts","src/components/editor/extensions/endnote-node.ts"],steps,parser,
},null,2)+"\n");
console.log(`Recorded ${steps.length} actual note command states and ${parser.length} Source parser cases.`);
