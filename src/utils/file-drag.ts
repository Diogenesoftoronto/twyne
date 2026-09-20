/**
 * Distinguishing a file drag from a text drag.
 *
 * The manuscript surface accepts dropped files (plates, tabulars) anywhere on
 * the page, but the editor inside it also has to support the ordinary thing a
 * writer does with a selection: drag it somewhere else in the prose. Those two
 * gestures arrive as the same event type and are told apart only by what the
 * drag is carrying.
 */

/** The `dataTransfer` entry the browser sets when the drag carries files. */
const FILE_DRAG_TYPE = "Files";

/**
 * True when the drag carries files rather than a text selection.
 *
 * `DataTransfer.types` is a `DOMStringList` in some browsers and a plain array
 * in others, and it is absent entirely on synthetic events in tests, so the
 * read is defensive rather than `types.includes(...)`.
 */
export function isFileDrag(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  const types = transfer.types;
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes(FILE_DRAG_TYPE);
}
