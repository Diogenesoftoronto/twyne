// Verification only: execute the current Tiptap/PM primitives and read the
// same StepMap counts as the original flow-conductor.ts transaction observer.
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EndnoteNode } from "../../../../src/components/editor/extensions/endnote-node";
import { ImageNode } from "../../../../src/components/editor/extensions/image-node";
import { MathExtensions } from "../../../../src/components/editor/extensions/math";
import { MermaidDiagram } from "../../../../src/components/editor/extensions/mermaid-node";
import {
  RawTypst,
  RawTypstInline,
} from "../../../../src/components/editor/extensions/raw-typst";
import { countWords } from "../../../../src/utils/document";

const cases: Array<{
  name: string;
  documentChanged: boolean;
  focused: boolean;
  inserted: number;
  deleted: number;
  html: string;
}> = [];
let phase = "";
const extensions = [
  StarterKit,
  EndnoteNode,
  ImageNode,
  ...MathExtensions,
  MermaidDiagram,
  RawTypst,
  RawTypstInline,
];

function editor(content: string) {
  const element = document.body.appendChild(document.createElement("div"));
  const instance = new Editor({ element, extensions, content });
  instance.on("transaction", ({ transaction }) => {
    if (!phase) return;
    let inserted = 0;
    let deleted = 0;
    for (const map of transaction.mapping.maps) {
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        deleted += oldEnd - oldStart;
        inserted += newEnd - newStart;
      });
    }
    cases.push({
      name: phase,
      documentChanged: transaction.docChanged,
      focused: instance.view.hasFocus(),
      inserted,
      deleted,
      html: instance.getHTML(),
    });
  });
  instance.view.focus();
  return instance;
}
function record(name: string, command: () => unknown) {
  phase = name;
  try {
    command();
  } finally {
    phase = "";
  }
}

{
  const instance = editor("<p>A🦊中</p>");
  record("same-length-emoji", () =>
    instance.view.dispatch(instance.state.tr.insertText("🚀", 2, 4)),
  );
  record("same-length-undo", () => instance.commands.undo());
  record("same-length-redo", () => instance.commands.redo());
  record("caret", () => instance.commands.setTextSelection(4));
  instance.commands.setTextSelection({ from: 2, to: 5 });
  record("format", () => instance.commands.toggleBold());
  record("format-undo", () => instance.commands.undo());
  instance.destroy();
}
{
  const instance = editor("<p>A🦊中</p>");
  record("ime-first-candidate", () =>
    instance.view.dispatch(instance.state.tr.insertText("に", 4, 4)),
  );
  record("ime-replace-candidate", () =>
    instance.view.dispatch(instance.state.tr.insertText("日本", 4, 5)),
  );
  record("ime-group-undo", () => instance.commands.undo());
  record("ime-group-redo", () => instance.commands.redo());
  instance.destroy();
}
{
  const instance = editor("<p>A🦊B</p>");
  instance.commands.setTextSelection(4);
  record("paragraph-enter", () => instance.commands.splitBlock());
  instance.commands.setTextSelection(
    instance.state.doc.firstChild!.nodeSize + 1,
  );
  record("paragraph-join", () => instance.commands.joinBackward());
  instance.destroy();
}
{
  const instance = editor("<ul><li><p>A🦊B</p></li></ul>");
  instance.commands.setTextSelection(6);
  record("list-enter", () => instance.commands.splitListItem("listItem"));
  const passages: number[] = [];
  instance.state.doc.descendants((node, position) => {
    if (node.isTextblock) passages.push(position + 1);
  });
  instance.commands.setTextSelection(passages[1]);
  record("list-join", () => instance.commands.joinBackward());
  instance.destroy();
}
{
  const instance = editor("<ul><li><p>A🦊</p></li><li><p>B</p></li></ul>");
  const passages: number[] = [];
  instance.state.doc.descendants((node, position) => {
    if (node.isTextblock) passages.push(position + 1);
  });
  instance.commands.setTextSelection(passages[1]);
  record("list-backspace", () =>
    instance.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        keyCode: 8,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  instance.destroy();
}
{
  const instance = editor("<pre><code>AB</code></pre>");
  instance.commands.setTextSelection(2);
  record("code-enter", () => instance.commands.newlineInCode());
  record("code-delete-newline", () =>
    instance.view.dispatch(instance.state.tr.delete(2, 3)),
  );
  instance.destroy();
}
{
  const instance = editor("<p>AB</p>");
  instance.view.dom.blur();
  record("unfocused-programmatic-replace", () =>
    instance.view.dispatch(instance.state.tr.insertText("X", 1, 2)),
  );
  instance.destroy();
}
{
  const instance = editor("<p>XY</p>");
  const { paragraph, endnote } = instance.schema.nodes;
  const first = paragraph.create(null, [
    instance.schema.text("🦊", [instance.schema.marks.italic.create()]),
    endnote.create({ text: "Source preserved" }),
  ]);
  const last = paragraph.create(null, instance.schema.text("日本"));
  instance.commands.setTextSelection({ from: 1, to: 2 });
  record("inline-rich-paste", () =>
    instance.view.dispatch(
      instance.state.tr.replaceSelection(new Slice(first.content, 0, 0)),
    ),
  );
  record("inline-rich-paste-undo", () => instance.commands.undo());
  instance.commands.setTextSelection(2);
  record("open-paragraph-paste", () =>
    instance.view.dispatch(
      instance.state.tr.replaceSelection(
        new Slice(Fragment.fromArray([first, last]), 1, 1),
      ),
    ),
  );
  record("open-paragraph-paste-undo", () => instance.commands.undo());
  instance.destroy();
}

const inputHtml = `<h1>Title!</h1><p>A<br>B<sup data-type="endnote" data-endnote-text="hidden words"></sup><span data-type="inline-math" data-latex="hidden words"></span><span data-type="raw-typst-inline" data-typst-source="hidden words"></span>C&nbsp;D—E</p><figure data-type="image"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lN1UvAAAAABJRU5ErkJggg==" alt="hidden words"></figure><div data-type="raw-typst" data-typst-source="hidden words"></div><div data-type="block-math" data-latex="hidden words"></div><div data-type="mermaid" data-mermaid-source="hidden words"></div><p></p><blockquote><p>F</p></blockquote><pre><code>G\nH I</code></pre>`;
const boundary = editor(inputHtml);
const boundaryHtml = boundary.getHTML();
const boundaryText = boundary.state.doc.textBetween(
  0,
  boundary.state.doc.content.size,
  " ",
);
const atomLeafText = Object.fromEntries(
  Object.entries(boundary.schema.nodes)
    .filter(([, type]) => type.spec.atom || type.name === "hardBreak")
    .map(([name, type]) => [
      name,
      { leafText: typeof type.spec.leafText, toText: typeof type.spec.toText },
    ]),
);
boundary.destroy();

(window as any).twyneFlowReference = {
  cases,
  boundaryHtml,
  boundaryText,
  boundaryWords: countWords(boundaryText),
  atomLeafText,
};
