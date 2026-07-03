import { Node, mergeAttributes } from "@tiptap/core";

export interface EndnoteNodeOptions {
  HTMLAttributes: Record<string, any>;
}

export type NoteKind = "endnote" | "footnote";

export interface EndnoteNodeAttributes {
  text: string;
  kind?: NoteKind;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    endnoteNode: {
      setEndnote: (attrs: EndnoteNodeAttributes) => ReturnType;
      setFootnote: (attrs: { text: string }) => ReturnType;
    };
  }
}

/**
 * Inline atom for manuscript notes. `kind` distinguishes endnotes
 * (collected in the exported "Notes" section) from footnotes
 * (collected in the exported "Footnotes" section, ahead of the
 * bibliography). Both render as a superscript marker in the draft.
 */
export const EndnoteNode = Node.create<EndnoteNodeOptions>({
  name: "endnote",

  group: "inline",

  inline: true,

  atom: true,

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-endnote-text") ?? "",
        renderHTML: (attributes) => {
          if (!attributes.text) return {};
          return { "data-endnote-text": attributes.text };
        },
      },
      kind: {
        default: "endnote" as NoteKind,
        parseHTML: (element) =>
          element.getAttribute("data-type") === "footnote"
            ? "footnote"
            : "endnote",
        // Emitted by the node-level renderHTML as data-type.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'sup[data-type="endnote"]' },
      { tag: 'sup[data-type="footnote"]' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind: NoteKind =
      node.attrs.kind === "footnote" ? "footnote" : "endnote";
    return [
      "sup",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": kind,
        class: "twyne-endnote",
        // The visible marker (number/dagger) comes from CSS counters;
        // the title surfaces the note text on hover.
        title: node.attrs.text || undefined,
      }),
    ];
  },

  addCommands() {
    return {
      setEndnote:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { text: attrs.text, kind: attrs.kind ?? "endnote" },
            })
            .run();
        },
      setFootnote:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { text: attrs.text, kind: "footnote" },
            })
            .run();
        },
    };
  },
});
