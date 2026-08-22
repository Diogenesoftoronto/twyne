import { Mark, type Editor } from "@tiptap/core";

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, any>;
}

export interface CommentMarkAttributes {
  id: string;
  author?: string;
  color?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      setComment: (attrs: CommentMarkAttributes) => ReturnType;
      unsetComment: () => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: "commentMark",

  // Margin threads are independent even when they quote the same passage.
  // Allow multiple comment marks to coexist instead of letting the newest one
  // replace the first at an identical selection.
  excludes: "",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-comment-id": attributes.id };
        },
      },
      author: {
        default: "You",
        parseHTML: (element) => element.getAttribute("data-comment-author"),
        renderHTML: (attributes) => {
          if (!attributes.author) return {};
          return { "data-comment-author": attributes.author };
        },
      },
      color: {
        default: "var(--color-writer-note)",
        parseHTML: (element) => {
          const color = element.getAttribute("data-comment-color");
          // Migrate comments saved before writer notes received their own
          // semantic color. Mustard belongs to M. Le Stylo.
          return !color || color === "var(--color-mustard)"
            ? "var(--color-writer-note)"
            : color;
        },
        renderHTML: (attributes) => {
          if (!attributes.color) return {};
          return { "data-comment-color": attributes.color };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-comment-id]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const color =
      HTMLAttributes["data-comment-color"] ?? "var(--color-writer-note)";
    return [
      "span",
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        class: "twyne-comment-mark",
        style: `background: color-mix(in srgb, ${color} 18%, transparent); border-bottom: 2px solid ${color}; cursor: text;`,
      },
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .setMark("commentMark", {
              id: attrs.id,
              author: attrs.author ?? "You",
              color: attrs.color ?? "var(--color-writer-note)",
            })
            .run();
        },
      unsetComment:
        () =>
        ({ chain }) => {
          return chain().unsetMark("commentMark").run();
        },
    };
  },
});

/** Remove one comment id without disturbing another mark on the same quote. */
export function removeCommentMarkById(
  editor: Editor,
  commentId: string,
): boolean {
  const { state, view } = editor;
  const type = state.schema.marks.commentMark;
  if (!type) return false;

  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type === type && mark.attrs.id === commentId) {
        tr.removeMark(pos, pos + node.nodeSize, mark);
      }
    }
    return true;
  });
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}
