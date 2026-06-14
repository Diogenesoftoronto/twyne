import { Mark } from "@tiptap/core";

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
        default: "var(--color-mustard)",
        parseHTML: (element) => element.getAttribute("data-comment-color"),
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
    return [
      "span",
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        class: "twyne-comment-mark",
        style: `background: color-mix(in srgb, ${HTMLAttributes["data-comment-color"] ?? "var(--color-mustard)"} 18%, transparent); border-bottom: 2px solid ${HTMLAttributes["data-comment-color"] ?? "var(--color-mustard)"}; cursor: pointer;`,
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
              color: attrs.color ?? "var(--color-mustard)",
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
