import { Extension, type CommandProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    twyneIndent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/** Indent step, in rem. One tab stop. */
export const INDENT_STEP_REM = 2;

/** How far a paragraph may be pushed before it stops being a paragraph. */
export const MAX_INDENT_LEVEL = 8;

/** Block types that can carry an indent. */
const INDENTABLE = ["paragraph", "heading"];

/** Wrappers whose child paragraph belongs to the list, not to the writer. */
const LIST_ITEMS = ["listItem", "taskItem"];

/**
 * Tab indentation for the manuscript.
 *
 * Tab did nothing in the editor: inside a list Tiptap already nested the item,
 * but everywhere else the key fell through to the browser and moved focus out
 * of the document entirely — pressing Tab while writing a paragraph threw the
 * writer out of their own draft.
 *
 * The rule now matches a word processor: Tab indents the current block one
 * stop, Shift+Tab takes it back, and lists and tables keep the behaviour they
 * already had (nest the item, move to the next cell). The indent is stored as
 * an attribute and rendered as a left margin, so it survives a round-trip
 * through HTML and travels into exports and the PDF rather than being a
 * screen-only affectation.
 *
 * Tab is deliberately swallowed inside the editor even when it cannot indent
 * any further, because a Tab that sometimes indents and sometimes ejects you
 * from the document is worse than one that consistently does nothing. Escape
 * releases focus so keyboard users are not trapped.
 */
export const Indent = Extension.create({
  name: "twyneIndent",

  // Above the list and table extensions, so this decides who handles Tab.
  priority: 200,

  addGlobalAttributes() {
    return [
      {
        types: [...INDENTABLE],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.getAttribute("data-indent");
              const level = raw ? Number.parseInt(raw, 10) : 0;
              return Number.isFinite(level) && level > 0
                ? Math.min(level, MAX_INDENT_LEVEL)
                : 0;
            },
            renderHTML: (attributes) => {
              const level = Number(attributes.indent) || 0;
              if (level <= 0) return {};
              return {
                "data-indent": String(level),
                style: `margin-left: ${level * INDENT_STEP_REM}rem`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    /**
     * Shift every indentable block touched by the selection. Operating on the
     * range rather than the cursor's block is what makes Tab work the way it
     * does in a word processor when several paragraphs are selected.
     */
    const shift =
      (delta: number) =>
      ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        let changed = false;

        state.doc.nodesBetween(
          from,
          to,
          (
            node: ProseMirrorNode,
            pos: number,
            parent: ProseMirrorNode | null,
          ) => {
            if (!INDENTABLE.includes(node.type.name)) return;
            // A paragraph inside a list item is the item's layout wrapper, not a
            // block of prose. Indenting it would push the text away from its own
            // bullet; nesting the item is the list's job, and the Tab keymap
            // routes there. Guarded here too so a toolbar button or a
            // multi-block selection cannot get it wrong.
            if (parent && LIST_ITEMS.includes(parent.type.name)) return;
            const current = Number(node.attrs.indent) || 0;
            const next = Math.min(
              Math.max(current + delta, 0),
              MAX_INDENT_LEVEL,
            );
            if (next === current) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          },
        );

        if (changed && dispatch) dispatch(tr);
        return changed;
      };

    return {
      indent: () => shift(1),
      outdent: () => shift(-1),
    };
  },

  addKeyboardShortcuts() {
    const inList = () =>
      this.editor.isActive("listItem") || this.editor.isActive("taskItem");

    return {
      Tab: () => {
        // Tables own Tab — it walks to the next cell.
        if (this.editor.isActive("table")) return false;
        if (inList()) {
          // Nest the item. The first item of a list has no sibling to nest
          // under, so this legitimately fails; swallow the key regardless.
          return (
            this.editor.commands.sinkListItem("listItem") ||
            this.editor.commands.sinkListItem("taskItem") ||
            true
          );
        }
        return this.editor.commands.indent() || true;
      },

      "Shift-Tab": () => {
        if (this.editor.isActive("table")) return false;
        if (inList()) {
          return (
            this.editor.commands.liftListItem("listItem") ||
            this.editor.commands.liftListItem("taskItem") ||
            true
          );
        }
        return this.editor.commands.outdent() || true;
      },

      /**
       * The escape hatch that makes swallowing Tab acceptable. With Tab bound
       * to indentation there is otherwise no keyboard route out of the
       * document, which is a keyboard trap (WCAG 2.1.2). Returns false so the
       * editor's own Escape handling — closing popovers — still runs.
       */
      Escape: () => {
        this.editor.commands.blur();
        return false;
      },
    };
  },
});
