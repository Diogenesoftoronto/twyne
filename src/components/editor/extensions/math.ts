import {
  Node,
  mergeAttributes,
  type CommandProps,
  type NodeViewRenderer,
  type NodeViewRendererProps,
} from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { createMathSourceEditor } from "../math/math-source-editor";
import { renderLatex, type MathDisplayMode } from "../math/math-renderer";
import "../math/math.css";

export interface MathNodeOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface MathNodeAttributes {
  source: string;
}

export interface MathNodeView {
  dom: HTMLElement;
  update: (node: NodeViewRendererProps["node"]) => boolean;
  selectNode: () => void;
  deselectNode: () => void;
  stopEvent: (event: Event) => boolean;
  ignoreMutation: () => boolean;
  destroy: () => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      setInlineMath: (attrs: MathNodeAttributes) => ReturnType;
      setBlockMath: (attrs: MathNodeAttributes) => ReturnType;
      updateMathSource: (source: string) => ReturnType;
    };
  }
}

const portableAttributes = (source: string, display: MathDisplayMode) => ({
  "data-type": display === "block" ? "block-math" : "inline-math",
  "data-latex": source,
  "data-math-display": display,
  "aria-label": `${display === "block" ? "Block" : "Inline"} equation: ${
    source || "empty"
  }`,
});

function parseSource(element: HTMLElement): string {
  return element.getAttribute("data-latex") ?? element.textContent ?? "";
}

function parseRules(display: MathDisplayMode) {
  const tag = display === "block" ? "div" : "span";
  const type = display === "block" ? "block-math" : "inline-math";
  return [
    {
      tag: `${tag}[data-type="${type}"]`,
      getAttrs: (element: HTMLElement) => ({ source: parseSource(element) }),
    },
    {
      tag: `${tag}[data-math-display="${display}"][data-latex]`,
      getAttrs: (element: HTMLElement) => ({ source: parseSource(element) }),
    },
  ];
}

function createMathNodeView(
  props: NodeViewRendererProps,
  display: MathDisplayMode,
): MathNodeView {
  let currentNode = props.node;
  let renderGeneration = 0;
  let sourceEditor: ReturnType<typeof createMathSourceEditor> | null = null;

  const dom = document.createElement(display === "block" ? "div" : "span");
  dom.className = `twyne-math twyne-math-${display}`;
  dom.tabIndex = 0;

  const render = document.createElement("span");
  render.className = "twyne-math-render";
  dom.append(render);

  const setPortableDomAttributes = () => {
    const source = String(currentNode.attrs.source ?? "");
    const attributes = portableAttributes(source, display);
    for (const [name, value] of Object.entries(attributes)) {
      dom.setAttribute(name, value);
    }
    dom.title = source ? "Edit LaTeX equation" : "Add LaTeX equation";
  };

  const closeSourceEditor = () => {
    sourceEditor?.destroy();
    sourceEditor?.dom.remove();
    sourceEditor = null;
    render.hidden = false;
  };

  const openSourceEditor = () => {
    if (!props.editor.options.editable || sourceEditor) return;

    render.hidden = true;
    sourceEditor = createMathSourceEditor({
      editor: props.editor,
      getPos: props.getPos,
      nodeName: display === "block" ? "blockMath" : "inlineMath",
      source: String(currentNode.attrs.source ?? ""),
      label: `${display === "block" ? "Block" : "Inline"} LaTeX source`,
      onClose: closeSourceEditor,
    });
    dom.append(sourceEditor.dom);
    sourceEditor.focus();
  };

  const renderCurrentSource = async () => {
    const generation = ++renderGeneration;
    const source = String(currentNode.attrs.source ?? "");
    setPortableDomAttributes();

    render.className = "twyne-math-render twyne-math-loading";
    render.textContent = source ? "Rendering equation…" : "Empty equation";
    dom.removeAttribute("data-math-error");

    const result = await renderLatex(source, display);
    if (generation !== renderGeneration) return;

    if (result.error) {
      render.className = "twyne-math-render twyne-math-error";
      render.replaceChildren();

      const prefix = document.createElement("strong");
      prefix.textContent = "Invalid LaTeX";

      const raw = document.createElement("code");
      raw.className = "twyne-math-error-source";
      raw.textContent = source || "empty source";

      render.append(prefix, raw);
      render.title = result.error;
      dom.setAttribute("data-math-error", "true");
      return;
    }

    render.className = "twyne-math-render";
    render.innerHTML = result.html;
  };

  const click: EventListener = (event) => {
    const target = event.target;
    const control =
      target instanceof Element &&
      target.closest("button, textarea, [data-math-source-editor]");
    if (!control) {
      event.preventDefault();
      event.stopPropagation();
      const pos = props.getPos();
      if (typeof pos === "number") {
        props.editor.commands.setNodeSelection(pos);
      }
      openSourceEditor();
    }
  };

  const keydown: EventListener = (event) => {
    if (sourceEditor) return;
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      const pos = props.getPos();
      if (typeof pos === "number") {
        props.editor.commands.setNodeSelection(pos);
      }
      openSourceEditor();
    }
  };

  dom.addEventListener("click", click);
  dom.addEventListener("keydown", keydown);
  void renderCurrentSource();

  return {
    dom,
    update: (node) => {
      if (node.type !== currentNode.type) return false;
      currentNode = node;
      closeSourceEditor();
      void renderCurrentSource();
      return true;
    },
    selectNode: () => {
      dom.classList.add("ProseMirror-selectednode");
    },
    deselectNode: () => {
      dom.classList.remove("ProseMirror-selectednode");
      if (!sourceEditor?.dom.contains(document.activeElement)) {
        closeSourceEditor();
      }
    },
    stopEvent: (event) =>
      sourceEditor?.dom.contains(event.target as globalThis.Node) ?? false,
    ignoreMutation: () => true,
    destroy: () => {
      renderGeneration++;
      closeSourceEditor();
      dom.removeEventListener("click", click);
      dom.removeEventListener("keydown", keydown);
    },
  };
}

function sharedAttributes() {
  return {
    source: {
      default: "",
      parseHTML: (element: HTMLElement) => parseSource(element),
      renderHTML: () => ({}),
    },
  };
}

const updateSelectedMathSource =
  (source: string) =>
  ({ state, tr, dispatch }: CommandProps) => {
    if (!(state.selection instanceof NodeSelection)) return false;
    const node = state.selection.node;
    if (node.type.name !== "inlineMath" && node.type.name !== "blockMath") {
      return false;
    }

    if (dispatch) {
      tr.setNodeMarkup(state.selection.from, undefined, {
        ...node.attrs,
        source,
      });
    }
    return true;
  };

export const InlineMath = Node.create<MathNodeOptions>({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes: sharedAttributes,
  parseHTML: () => parseRules("inline"),

  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.source ?? "");
    return [
      "span",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        portableAttributes(source, "inline"),
        { class: "twyne-math twyne-math-inline" },
      ),
      source,
    ];
  },

  renderText: ({ node }) => `$${String(node.attrs.source ?? "")}$`,
  addCommands() {
    return {
      setInlineMath:
        (attrs) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            attrs: { source: attrs.source },
          }),
      updateMathSource: (source) => updateSelectedMathSource(source),
    };
  },
  addNodeView() {
    return ((props) => createMathNodeView(props, "inline")) as NodeViewRenderer;
  },
});

export const BlockMath = Node.create<MathNodeOptions>({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes: sharedAttributes,
  parseHTML: () => parseRules("block"),

  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.source ?? "");
    return [
      "div",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        portableAttributes(source, "block"),
        {
          class: "twyne-math twyne-math-block",
          style: "break-inside: avoid; page-break-inside: avoid;",
        },
      ),
      source,
    ];
  },

  renderText: ({ node }) => `$$${String(node.attrs.source ?? "")}$$`,
  addCommands() {
    return {
      setBlockMath:
        (attrs) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            attrs: { source: attrs.source },
          }),
      updateMathSource: (source) => updateSelectedMathSource(source),
    };
  },
  addNodeView() {
    return ((props) => createMathNodeView(props, "block")) as NodeViewRenderer;
  },
});

export const MathExtensions = [InlineMath, BlockMath];
