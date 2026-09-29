import { Node, mergeAttributes } from "@tiptap/core";

/** Lossless source atom: unknown Typst is never evaluated or silently flattened. */
export const RawTypst = Node.create({
  name: "rawTypst",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-typst-source") ?? "",
        renderHTML: (attributes) => ({
          "data-typst-source": attributes.source,
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="raw-typst"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "raw-typst",
        class: "twyne-raw-typst",
        title: "Edit this Typst block in source view",
        contenteditable: "false",
      }),
      ["pre", {}, String(HTMLAttributes["data-typst-source"] || "Typst block")],
    ];
  },
});

export const RawTypstInline = RawTypst.extend({
  name: "rawTypstInline",
  group: "inline",
  inline: true,
  parseHTML() {
    return [{ tag: 'span[data-type="raw-typst-inline"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "raw-typst-inline",
        class: "twyne-raw-typst-inline",
        title: "Edit this Typst expression in source view",
        contenteditable: "false",
      }),
      String(HTMLAttributes["data-typst-source"] || "Typst"),
    ];
  },
});
