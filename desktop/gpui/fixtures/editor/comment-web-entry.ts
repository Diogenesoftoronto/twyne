import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { CommentMark } from "../../../../src/components/editor/extensions/comment-mark";
import { MarkAnchorWidgets } from "../../../../src/components/editor/extensions/mark-anchor-widgets";

(window as any).twyneLongWordEditor = new Editor({
  element: document.querySelector("#fixture")!,
  extensions: [StarterKit, CommentMark, MarkAnchorWidgets],
  content:
    '<p><span data-comment-id="one">An <strong>anchored</strong> passage <span data-comment-id="two" data-comment-color="red">shared</span> by two notes.</span> After.</p><p>Quiet carries <span data-comment-id="one">another passage</span>.</p><p><span data-comment-id="wrapped">' +
    "A passage crossing several rows. ".repeat(12) +
    "</span> Plain text follows.</p>",
});
