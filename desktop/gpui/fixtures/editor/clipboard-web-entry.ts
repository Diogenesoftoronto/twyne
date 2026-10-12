// Execute the original PM clipboard serializer and paste handler locally.
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { CommentMark } from "../../../../src/components/editor/extensions/comment-mark";
import { EndnoteNode } from "../../../../src/components/editor/extensions/endnote-node";
import { MathExtensions } from "../../../../src/components/editor/extensions/math";
import {
  RawTypst,
  RawTypstInline,
} from "../../../../src/components/editor/extensions/raw-typst";

const extensions = [
  StarterKit,
  CommentMark,
  EndnoteNode,
  ...MathExtensions,
  RawTypst,
  RawTypstInline,
];
function editor(content: string) {
  return new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions,
    content,
  });
}
const cases: unknown[] = [];
function copy(name: string, input: string, from: number, to: number) {
  const source = editor(input);
  // TextSelection.content uses includeParents=true; whole-document slices
  // remain closed. This retains the real PM list/context annotation.
  const slice = source.state.doc.slice(from, to, true);
  const copied = source.view.serializeForClipboard(slice);
  const destination = editor("<p>LeftRight</p>");
  destination.commands.setTextSelection(5);
  const transfer = new DataTransfer();
  transfer.setData("text/plain", copied.text);
  transfer.setData("text/html", copied.dom.innerHTML);
  destination.view.dom.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }),
  );
  cases.push({
    name,
    input: source.getHTML(),
    html: copied.dom.innerHTML,
    text: copied.text,
    openStart: slice.openStart,
    openEnd: slice.openEnd,
    pasted: destination.getHTML(),
  });
  destination.destroy();
  source.destroy();
}
const rich = `<p>A<span data-comment-id="comment-1"><strong>🦊é</strong></span><span data-type="inline-math" data-latex="E=mc^2"></span><sup data-type="endnote" data-endnote-text="Authored note"></sup><span data-type="raw-typst-inline" data-typst-source="#keep[原稿]"></span>Z</p>`;
{
  const source = editor(rich);
  const end = source.state.doc.content.size;
  source.destroy();
  copy("inline-rich", rich, 2, end - 2);
  copy("complete-paragraph", rich, 0, end);
}
copy(
  "open-paragraphs",
  "<p>One<strong>Bold</strong></p><h2>Two <em>End</em></h2>",
  3,
  13,
);
copy("deep-list-context", "<ul><li><p>One</p></li></ul>", 4, 5);
copy("complete-list", "<ul><li><p>One</p></li></ul>", 0, 9);
const plain = editor("<p>LeftRight</p>");
plain.commands.setTextSelection(5);
const transfer = new DataTransfer();
transfer.setData("text/plain", "A\r\n\r\nB\rC");
plain.view.dom.dispatchEvent(
  new ClipboardEvent("paste", {
    clipboardData: transfer,
    bubbles: true,
    cancelable: true,
  }),
);
const plainPasted = plain.getHTML();
plain.destroy();
(window as any).twyneClipboardReference = { cases, plainPasted };
