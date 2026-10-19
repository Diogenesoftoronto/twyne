/**
 * Code blocks with optional highlighted lines ("3,5-7"). The attribute lives
 * on the <pre> as `data-highlight-lines`, so HTML persistence and sync carry
 * it; the editor paints it with decorations and the Typst exporter turns it
 * into `#twyne-code(highlight: …)` for the technical kit.
 */
import CodeBlock from "@tiptap/extension-code-block";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  normalizeLineRanges,
  parseLineRanges,
} from "../../../utils/code-lines";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    codeBlockLines: {
      /** Empty ranges clear the highlight. */
      setCodeHighlightLines: (ranges: string) => ReturnType;
    };
  }
}

export const CodeBlockLines = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      highlightLines: {
        default: "",
        parseHTML: (el) =>
          normalizeLineRanges(el.getAttribute("data-highlight-lines")),
        renderHTML: (attrs) =>
          attrs.highlightLines
            ? { "data-highlight-lines": attrs.highlightLines }
            : {},
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setCodeHighlightLines:
        (ranges) =>
        ({ commands, editor }) =>
          editor.isActive(this.name)
            ? commands.updateAttributes(this.name, {
                highlightLines: normalizeLineRanges(ranges),
              })
            : false,
    };
  },
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("codeBlockLines"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== name) return;
              const lines = parseLineRanges(node.attrs.highlightLines);
              if (!lines.length) return false;
              const marked = new Set(lines);
              let offset = pos + 1;
              node.textContent.split("\n").forEach((line, index) => {
                if (marked.has(index + 1) && line.length)
                  decorations.push(
                    Decoration.inline(offset, offset + line.length, {
                      class: "twyne-code-line-hl",
                    }),
                  );
                offset += line.length + 1;
              });
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
