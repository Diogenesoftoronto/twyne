import { describe, expect, test } from "bun:test";
import { EndnoteNode } from "./extensions/endnote-node";
import { InlineNoteNode } from "./extensions/inline-note-popover";
import {
  adjacentInlineNote,
  collectInlineNotes,
  convertInlineNote,
  deleteInlineNote,
  focusInlineNoteReference,
  updateInlineNote,
} from "./note-editing";
import { withEditor } from "./test-harness";

const NOTES_HTML =
  '<p>A<sup data-endnote-text="Alpha" data-type="endnote"></sup> ' +
  'B<sup data-endnote-text="Beta" data-type="footnote"></sup> ' +
  'C<sup data-endnote-text="Gamma" data-type="endnote"></sup></p>';

describe("inline note editing utilities", () => {
  test("derives independent footnote and endnote numbering from document order", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [EndnoteNode] },
      ({ editor }) => {
        expect(collectInlineNotes(editor.state.doc)).toEqual([
          { kind: "endnote", number: 1, pos: 2, text: "Alpha" },
          { kind: "footnote", number: 1, pos: 5, text: "Beta" },
          { kind: "endnote", number: 2, pos: 8, text: "Gamma" },
        ]);
      },
    );
  });

  test("edits note text in place and survives HTML round-trip reopening", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [EndnoteNode] },
      ({ editor }) => {
        const first = collectInlineNotes(editor.state.doc)[0]!;
        expect(updateInlineNote(editor, first.pos, { text: `A & "B"` })).toBe(
          true,
        );

        const saved = editor.getHTML();
        expect(saved).toContain('data-endnote-text="A &amp; &quot;B&quot;"');

        editor.commands.setContent(saved);
        expect(collectInlineNotes(editor.state.doc)[0]?.text).toBe(`A & "B"`);
        expect(editor.getHTML()).toBe(saved);
      },
    );
  });

  test("converts kind without storing a number and renumbers both groups", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [EndnoteNode] },
      ({ editor }) => {
        const third = collectInlineNotes(editor.state.doc)[2]!;
        expect(convertInlineNote(editor, third.pos, "footnote")).toBe(true);

        expect(collectInlineNotes(editor.state.doc)).toEqual([
          { kind: "endnote", number: 1, pos: 2, text: "Alpha" },
          { kind: "footnote", number: 1, pos: 5, text: "Beta" },
          { kind: "footnote", number: 2, pos: 8, text: "Gamma" },
        ]);
        expect(editor.getHTML()).not.toContain("data-inline-note-number");
      },
    );
  });

  test("delete removes only the selected note and closes numbering gaps", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [EndnoteNode] },
      ({ editor }) => {
        const first = collectInlineNotes(editor.state.doc)[0]!;
        expect(deleteInlineNote(editor, first.pos)).toBe(true);
        expect(collectInlineNotes(editor.state.doc)).toEqual([
          { kind: "footnote", number: 1, pos: 4, text: "Beta" },
          { kind: "endnote", number: 1, pos: 7, text: "Gamma" },
        ]);
        expect(editor.getText()).toBe("A B C");
      },
    );
  });

  test("navigation follows reading order across note kinds and stops at boundaries", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [EndnoteNode] },
      ({ editor }) => {
        const [first, second, third] = collectInlineNotes(editor.state.doc);
        expect(
          adjacentInlineNote(editor.state.doc, first!.pos, "previous"),
        ).toBeNull();
        expect(
          adjacentInlineNote(editor.state.doc, first!.pos, "next")?.pos,
        ).toBe(second!.pos);
        expect(
          adjacentInlineNote(editor.state.doc, second!.pos, "previous")?.pos,
        ).toBe(first!.pos);
        expect(
          adjacentInlineNote(editor.state.doc, second!.pos, "next")?.pos,
        ).toBe(third!.pos);
        expect(
          adjacentInlineNote(editor.state.doc, third!.pos, "next"),
        ).toBeNull();
      },
    );
  });

  test("focus selects the atomic reference and safely rejects stale positions", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [EndnoteNode] },
      ({ editor }) => {
        const first = collectInlineNotes(editor.state.doc)[0]!;
        expect(focusInlineNoteReference(editor, first.pos)).toBe(true);
        expect(editor.state.selection.constructor.name).toBe("NodeSelection");
        expect(editor.state.selection.from).toBe(first.pos);

        expect(updateInlineNote(editor, 999, { text: "stale" })).toBe(false);
        expect(deleteInlineNote(editor, 999)).toBe(false);
        expect(focusInlineNoteReference(editor, 999)).toBe(false);
      },
    );
  });

  test("the adapter preserves the existing endnote schema and HTML contract", async () => {
    await withEditor(
      { content: NOTES_HTML, extensions: [InlineNoteNode] },
      ({ editor }) => {
        const html = editor.getHTML();
        expect(html).toContain('data-type="endnote"');
        expect(html).toContain('data-type="footnote"');
        expect(html).toContain('data-endnote-text="Alpha"');

        editor.commands.setContent(html);
        expect(editor.getHTML()).toBe(html);
        expect(collectInlineNotes(editor.state.doc)).toHaveLength(3);
      },
    );
  });
});
