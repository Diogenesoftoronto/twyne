import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

export type InlineNoteKind = "endnote" | "footnote";

export interface InlineNoteReference {
  kind: InlineNoteKind;
  number: number;
  pos: number;
  text: string;
}

export type InlineNoteDirection = "previous" | "next";

export type NotePosition = number | (() => number | undefined);

function resolvePosition(position: NotePosition): number | null {
  const resolved = typeof position === "function" ? position() : position;
  return typeof resolved === "number" ? resolved : null;
}

function noteNodeAt(
  doc: ProseMirrorNode,
  position: NotePosition,
): { pos: number; node: ProseMirrorNode } | null {
  const pos = resolvePosition(position);
  if (pos === null || pos < 0 || pos >= doc.content.size) return null;

  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== "endnote") return null;
  return { pos, node };
}

export function normalizeInlineNoteKind(value: unknown): InlineNoteKind {
  return value === "footnote" ? "footnote" : "endnote";
}

/**
 * Collect notes in reading order. Numbering is deliberately derived from the
 * current document rather than stored in node attributes, so insertions,
 * deletions, moves, and kind conversions always renumber without migration.
 */
export function collectInlineNotes(
  doc: ProseMirrorNode,
): InlineNoteReference[] {
  const notes: InlineNoteReference[] = [];
  let endnoteNumber = 0;
  let footnoteNumber = 0;

  doc.descendants((node, pos) => {
    if (node.type.name !== "endnote") return true;

    const kind = normalizeInlineNoteKind(node.attrs.kind);
    const number = kind === "footnote" ? ++footnoteNumber : ++endnoteNumber;
    notes.push({
      kind,
      number,
      pos,
      text: typeof node.attrs.text === "string" ? node.attrs.text : "",
    });
    return true;
  });

  return notes;
}

export function findInlineNote(
  doc: ProseMirrorNode,
  position: NotePosition,
): InlineNoteReference | null {
  const pos = resolvePosition(position);
  if (pos === null) return null;
  return collectInlineNotes(doc).find((note) => note.pos === pos) ?? null;
}

export function updateInlineNote(
  editor: Editor,
  position: NotePosition,
  patch: { text?: string; kind?: InlineNoteKind },
): boolean {
  const current = noteNodeAt(editor.state.doc, position);
  if (!current) return false;
  const { pos, node } = current;

  const attrs = {
    ...node.attrs,
    ...(patch.text === undefined ? {} : { text: patch.text }),
    ...(patch.kind === undefined
      ? {}
      : { kind: normalizeInlineNoteKind(patch.kind) }),
  };

  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, attrs));
  return true;
}

export function convertInlineNote(
  editor: Editor,
  position: NotePosition,
  kind: InlineNoteKind,
): boolean {
  return updateInlineNote(editor, position, { kind });
}

export function deleteInlineNote(
  editor: Editor,
  position: NotePosition,
): boolean {
  const current = noteNodeAt(editor.state.doc, position);
  if (!current) return false;
  const { pos, node } = current;

  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  return true;
}

export function focusInlineNoteReference(
  editor: Editor,
  position: NotePosition,
): boolean {
  const current = noteNodeAt(editor.state.doc, position);
  if (!current) return false;
  const { pos } = current;

  const selection = NodeSelection.create(editor.state.doc, pos);
  editor.view.dispatch(
    editor.state.tr.setSelection(selection).scrollIntoView(),
  );
  editor.view.focus();
  return true;
}

export function adjacentInlineNote(
  doc: ProseMirrorNode,
  position: NotePosition,
  direction: InlineNoteDirection,
): InlineNoteReference | null {
  const pos = resolvePosition(position);
  if (pos === null) return null;

  const notes = collectInlineNotes(doc);
  const index = notes.findIndex((note) => note.pos === pos);
  if (index === -1) return null;

  const targetIndex = direction === "previous" ? index - 1 : index + 1;
  return notes[targetIndex] ?? null;
}

export function navigateInlineNote(
  editor: Editor,
  position: NotePosition,
  direction: InlineNoteDirection,
): InlineNoteReference | null {
  const target = adjacentInlineNote(editor.state.doc, position, direction);
  if (!target) return null;
  return focusInlineNoteReference(editor, target.pos) ? target : null;
}
