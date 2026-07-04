/**
 * TipTap extension that paints a small hit-tested chip at the end of
 * every contiguous run of three "comment-like" marks: writer comments
 * (`.twyne-comment-mark`), persona notes (`.twyne-persona-note`), and
 * editor proposals (`.twyne-suggestion`).
 *
 * Why a widget and not a CSS pseudo-element:
 *   - Multi-span marks can interleave with bold/italic/links etc.,
 *     leaving no single DOM "last span" the CSS can target.
 *   - Pseudo-elements can't be hit-tested, so a chip clicked by
 *     the reader can't open the right popover.
 *   - Widgets are real DOM nodes owned by ProseMirror and survive
 *     mapping across transactions.
 *
 * The chip carries `data-anchor-kind` (note|comment|suggestion) and
 * `data-anchor-id`; the editor's click handler reads those and
 * forwards to the matching popover opener using the chip's own
 * getBoundingClientRect() (sidestepping multi-span rect issues).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type AnchorKind = "note" | "comment" | "suggestion";

const anchorPluginKey = new PluginKey<DecorationSet>("twyneMarkAnchors");

/** Helper for both compilers: name → kind. */
function kindFor(name: string): AnchorKind | null {
  switch (name) {
    case "personaNote":
      return "note";
    case "commentMark":
      return "comment";
    case "suggestion":
      return "suggestion";
    default:
      return null;
  }
}

function idForMark(mark: Mark): string | null {
  const id = mark.attrs?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildDecorations(doc: PmNode): DecorationSet {
  const decos: Decoration[] = [];

  // Walk every text node in document order. For each text node we
  // inspect its marks; for the first anchored mark we find, we emit
  // a widget at the *end* of the contiguous (kind, id) run that
  // begins at this text node's start position.
  doc.descendants((node: PmNode, pos: number) => {
    if (!node.isText || !node.marks.length) return true;

    for (const mark of node.marks) {
      const kind = kindFor(mark.type.name);
      if (!kind) continue;
      const id = idForMark(mark);
      if (!id) continue;

      // Detect whether this text node continues a previous run of
      // the same (kind, id) marks. We only need the immediately
      // preceding position; if it carries the same mark, this node
      // is a continuation and the chip is emitted from the *start*
      // of the run (handled by the first node in the run).
      const prevPos = pos - 1;
      const continues =
        prevPos >= 0 &&
        doc
          .resolve(prevPos)
          .marks()
          .some(
            (m) => kindFor(m.type.name) === kind && idForMark(m) === id,
          );
      if (continues) continue;

      // Otherwise this is the start of a new run: scan forward to
      // find the run end. The simplest correct definition: walk
      // forward from this node's end position; the latest position
      // at which the (kind, id) marks still appear is the run end.
      const runStart = pos;
      const runEnd = findRunEnd(doc, kind, id, runStart);
      // Place the chip *at* the run end (after the last character
      // of the marked span) with side: 1 so it sits outside the
      // marked text rather than inside the next character.
      decos.push(
        Decoration.widget(runEnd, () => createChip(kind, id), {
          side: 1,
          ignoreSelection: true,
        }),
      );
    }
    return true;
  });

  return DecorationSet.create(doc, decos);
}

function findRunEnd(
  doc: PmNode,
  kind: AnchorKind,
  id: string,
  fromPos: number,
): number {
  let last = fromPos;
  doc.descendants((node, pos) => {
    if (pos + node.nodeSize <= fromPos) return true;
    if (!node.isText) return true;
    const has = node.marks.some(
      (m) => kindFor(m.type.name) === kind && idForMark(m) === id,
    );
    if (has) last = pos + node.nodeSize;
    return true;
  });
  return last;
}

function createChip(kind: AnchorKind, id: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "twyne-mark-anchor";
  btn.setAttribute("data-anchor-kind", kind);
  btn.setAttribute("data-anchor-id", id);
  btn.setAttribute("aria-label", `Open ${kind}`);
  btn.contentEditable = "false";
  return btn;
}

export const MarkAnchorWidgets = Extension.create({
  name: "markAnchorWidgets",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: anchorPluginKey,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply(tr, old, _oldState, newState) {
            if (tr.docChanged) {
              // On doc changes, rebuild — the set of runs and the
              // text nodes they live on may all have shifted, so a
              // plain mapping isn't faithful.
              return buildDecorations(newState.doc);
            }
            return old.map(tr.mapping, tr.doc);
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
