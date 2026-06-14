import { Node, mergeAttributes } from "@tiptap/core";

export interface MermaidDiagramOptions {
  HTMLAttributes: Record<string, any>;
}

export interface MermaidDiagramAttributes {
  source: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaidDiagram: {
      setMermaidDiagram: (attrs: MermaidDiagramAttributes) => ReturnType;
    };
  }
}

export const MermaidDiagram = Node.create<MermaidDiagramOptions>({
  name: "mermaidDiagram",

  group: "block",

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-mermaid-source"),
        renderHTML: (attributes) => {
          if (!attributes.source) return {};
          return { "data-mermaid-source": attributes.source };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid-diagram"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mermaid-diagram",
        class: "mermaid twyne-mermaid-diagram",
      }),
      HTMLAttributes["data-mermaid-source"] ?? "",
    ];
  },

  addCommands() {
    return {
      setMermaidDiagram:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { source: attrs.source },
            })
            .run();
        },
    };
  },
});
