/**
 * A hard page break — the writer's explicit "start the next page here".
 *
 * The node deliberately renders as nothing. It carries no height and no
 * margins, and {@link buildNaturalStack} normalises it away; the visible
 * dashed rule and its "Page break" label are painted by the page chrome
 * overlay, in the gap between the two sheets. Drawing it as a real element
 * inside the flow would leave a stray line hanging at the top of the page it
 * opens, which is precisely where a page break should be invisible.
 *
 * It is a block atom rather than a leaf with content so that selecting and
 * deleting it is a single keystroke, and so a stray cursor cannot end up
 * "inside" a break.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

export interface PageBreakOptions {
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

export const PageBreakNode = Node.create<PageBreakOptions>({
  name: "pageBreak",

  group: "block",

  atom: true,

  selectable: true,

  draggable: false,

  // Beat the hard-break and exit-code bindings on Mod-Enter. `indent.ts`
  // uses the same lever to win Tab from the list keymap.
  priority: 200,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "page-break",
        class: "twyne-page-break",
        // Export and print read this rather than the class, so a manuscript
        // opened outside Twyne still breaks in the right place.
        "data-page-break": "true",
      }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({ type: this.name })
            .command(({ tr, editor, dispatch }) => {
              // Mid-paragraph the split already leaves the caret in the
              // remainder. At the end of the document there is nothing to
              // split, so the selection lands *on* the atom — and the
              // writer's next keystroke would replace the break they just
              // asked for.
              //
              // StarterKit's trailing-node plugin does eventually append a
              // paragraph here, but it runs in appendTransaction, i.e. after
              // this chain has already committed its selection. So make the
              // landing place ourselves rather than racing it; trailing-node
              // then sees a document already ending in a textblock and adds
              // nothing.
              const sel = tr.selection;
              if (
                !dispatch ||
                !(sel instanceof NodeSelection) ||
                sel.node.type.name !== this.name
              ) {
                return true;
              }
              const at = sel.to;
              tr.insert(at, editor.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, at + 1));
              return true;
            })
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        // Mod-Enter is already spoken for twice: HardBreak binds it via
        // StarterKit, and @tiptap/core binds it to exitCode. Escaping a code
        // block is the more urgent of the two and has no other keystroke, so
        // yield there and take the binding everywhere else. Hard break keeps
        // Shift-Enter, which is the one writers actually reach for.
        if (this.editor.isActive("codeBlock")) return false;
        return this.editor.commands.setPageBreak();
      },
    };
  },
});
