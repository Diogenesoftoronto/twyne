import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { CommentMark } from "../../../../src/components/editor/extensions/comment-mark";
import { MarkAnchorWidgets } from "../../../../src/components/editor/extensions/mark-anchor-widgets";
import { IlluminatedInitial } from "../../../../src/components/editor/extensions/illuminated-initial";
import { SectionReorder } from "../../../../src/components/editor/extensions/section-reorder";

(window as any).twyneNotebookEditor = new Editor({
  element: document.querySelector("#fixture")!,
  extensions: [StarterKit, CommentMark, MarkAnchorWidgets, IlluminatedInitial, SectionReorder],
  content: (window as any).twyneNotebookHtml,
});
