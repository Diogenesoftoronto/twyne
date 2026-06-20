import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Remote cursors overlay — shows where other collaborators are in the document.
 *
 * Each collaborator with a `cursorPos` gets a thin colored caret widget at
 * that position, plus their name in a small label above it. Selections
 * (anchor ≠ head) are highlighted with a translucent color.
 *
 * The presence data is pushed in via the `setRemoteCursors` command, called
 * by the editor whenever the Convex presence subscription updates.
 */

export interface RemoteCursor {
  userId: string;
  displayName: string;
  color: string;
  cursorPos?: number;
  selectionAnchor?: number;
  selectionHead?: number;
}

const cursorPluginKey = new PluginKey<DecorationSet>("remoteCursors");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    remoteCursors: {
      setRemoteCursors: (cursors: RemoteCursor[]) => ReturnType;
    };
  }
}

export const RemoteCursors = Extension.create<{
  cursors: RemoteCursor[];
}>({
  name: "remoteCursors",

  addOptions() {
    return { cursors: [] };
  },

  addCommands() {
    return {
      setRemoteCursors:
        (cursors: RemoteCursor[]) =>
        ({ tr }: CommandProps) => {
          tr.setMeta(cursorPluginKey, { cursors });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const initialCursors = this.options.cursors;
    return [
      new Plugin<DecorationSet>({
        key: cursorPluginKey,
        state: {
          init(_, state) {
            return buildDecorations(state, initialCursors);
          },
          apply(tr, old, _oldState, newState) {
            const meta = tr.getMeta(cursorPluginKey);
            if (meta?.cursors) {
              return buildDecorations(newState, meta.cursors);
            }
            // If the doc changed, re-map existing decorations to new positions.
            if (tr.docChanged) {
              return old.map(tr.mapping, tr.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(
  state: { doc: { resolve: (pos: number) => any } },
  cursors: RemoteCursor[],
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const c of cursors) {
    // Selection highlight (anchor ≠ head).
    if (
      c.selectionAnchor != null &&
      c.selectionHead != null &&
      c.selectionAnchor !== c.selectionHead
    ) {
      const from = Math.min(c.selectionAnchor, c.selectionHead);
      const to = Math.max(c.selectionAnchor, c.selectionHead);
      const safeFrom = Math.max(0, Math.min(from, state.doc.resolve(0).end()));
      const safeTo = Math.max(
        safeFrom,
        Math.min(to, state.doc.resolve(0).end()),
      );
      decorations.push(
        Decoration.inline(safeFrom, safeTo, {
          style: `background-color: ${c.color}33;`,
          class: "remote-selection",
        }),
      );
    }

    // Caret widget.
    if (c.cursorPos != null && c.cursorPos >= 0) {
      const pos = c.cursorPos;
      try {
        const safePos = Math.min(pos, state.doc.resolve(0).end() + 1);
        decorations.push(
          Decoration.widget(safePos, () => {
            const el = document.createElement("span");
            el.className = "remote-cursor";
            el.style.cssText = `position:relative;display:inline-block;width:2px;height:1.4em;background:${c.color};vertical-align:text-bottom;margin-left:-1px;`;
            const label = document.createElement("span");
            label.style.cssText = `position:absolute;top:-1.2em;left:0;white-space:nowrap;font-size:9px;line-height:1;padding:1px 4px;border-radius:2px;background:${c.color};color:#fff;font-family:var(--font-typewriter,monospace);pointer-events:none;`;
            label.textContent = c.displayName.charAt(0).toUpperCase();
            el.appendChild(label);
            return el;
          }),
        );
      } catch {
        // Position out of bounds — skip this cursor.
      }
    }
  }

  return DecorationSet.create(state.doc as any, decorations);
}
