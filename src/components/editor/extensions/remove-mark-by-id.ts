import type { Editor } from "@tiptap/core";

/**
 * Remove every span of one mark instance, found by its `id` attribute,
 * without disturbing other marks of the same type on the same text.
 * Returns whether anything was removed.
 */
export function removeMarkById(
  editor: Editor,
  markName: string,
  id: string,
): boolean {
  const { state, view } = editor;
  const type = state.schema.marks[markName];
  if (!type) return false;

  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type === type && mark.attrs.id === id) {
        tr.removeMark(pos, pos + node.nodeSize, mark);
      }
    }
    return true;
  });
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}
