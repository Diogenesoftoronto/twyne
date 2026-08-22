import { describe, expect, test } from "bun:test";
import { withEditor } from "./test-harness";
import { MarkAnchorWidgets } from "./extensions/mark-anchor-widgets";
import { removePersonaNoteMarkById } from "./extensions/persona-note-mark";

/**
 * The PersonaNoteMark and SuggestionMark are the editor-side
 * counterparts to the inline note popovers. Like the CommentMark
 * they round-trip their data attributes through Tiptap; unlike
 * comments, they are not driven by a Tiptap command — the editor
 * applies the mark programmatically when a note arrives.
 *
 * These tests pin the parseHTML / renderHTML contract. The
 * positioning math for the popover itself (buildNotePopover) is
 * covered separately in `popover-positioning.test.ts`.
 */
describe("PersonaNoteMark", () => {
  test("parseHTML round-trips id, author, color, label, note, quote", async () => {
    await withEditor(
      {
        content:
          '<p><span data-persona-note-id="n-1" data-persona-note-author="Editor" data-persona-note-color="red" data-persona-note-label="focus" data-persona-note-note="too long" data-persona-note-quote="the long sentence" data-persona-note-brief="Title">highlighted</span></p>',
      },
      ({ editor }) => {
        const html = editor.getHTML();
        expect(html).toContain('data-persona-note-id="n-1"');
        expect(html).toContain('data-persona-note-author="Editor"');
        expect(html).toContain('data-persona-note-color="red"');
        expect(html).toContain('data-persona-note-label="focus"');
        expect(html).toContain('data-persona-note-note="too long"');
        expect(html).toContain('data-persona-note-quote="the long sentence"');
        expect(html).toContain('data-persona-note-brief="Title"');
      },
    );
  });

  test("renderHTML applies the persona-note class", async () => {
    await withEditor(
      {
        content:
          '<p><span data-persona-note-id="n-1" data-persona-note-author="Editor" data-persona-note-color="red" data-persona-note-label="focus" data-persona-note-note="x" data-persona-note-quote="q">a note</span></p>',
      },
      ({ editor }) => {
        const html = editor.getHTML();
        expect(html).toContain("twyne-persona-note");
      },
    );
  });

  test("overlapping quoted passages survive reload and delete independently", async () => {
    await withEditor(
      {
        content: "<p>one shared passage for both readers</p>",
        extensions: [MarkAnchorWidgets],
      },
      ({ editor, host }) => {
        editor.commands.setTextSelection({ from: 1, to: 19 });
        editor.commands.setPersonaNote({
          id: "n-first",
          author: "First editor",
          color: "red",
          label: "conflict",
          note: "First reading",
          quote: "one shared passage",
        });
        editor.commands.setTextSelection({ from: 1, to: 19 });
        editor.commands.setPersonaNote({
          id: "n-second",
          author: "Second editor",
          color: "blue",
          label: "conflict",
          note: "Second reading",
          quote: "one shared passage",
        });

        const html = editor.getHTML();
        expect(html).toContain('data-persona-note-id="n-first"');
        expect(html).toContain('data-persona-note-id="n-second"');
        expect(
          Array.from(
            host.querySelectorAll<HTMLElement>(
              '.twyne-mark-anchor[data-anchor-kind="note"]',
            ),
          ).map((chip) => chip.dataset.anchorId),
        ).toEqual(["n-first", "n-second"]);

        editor.commands.setContent(html);
        expect(editor.getHTML()).toContain('data-persona-note-id="n-first"');
        expect(editor.getHTML()).toContain('data-persona-note-id="n-second"');

        expect(removePersonaNoteMarkById(editor, "n-first")).toBe(true);
        expect(editor.getHTML()).not.toContain('data-persona-note-id="n-first"');
        expect(editor.getHTML()).toContain('data-persona-note-id="n-second"');
        expect(
          Array.from(
            host.querySelectorAll<HTMLElement>(
              '.twyne-mark-anchor[data-anchor-kind="note"]',
            ),
          ).map((chip) => chip.dataset.anchorId),
        ).toEqual(["n-second"]);
      },
    );
  });
});

describe("SuggestionMark", () => {
  test("parseHTML round-trips id, version, author, color, replacement, rationale", async () => {
    await withEditor(
      {
        content:
          '<p><span data-suggestion-id="s-1" data-suggestion-versionid="v-1" data-suggestion-author="Editor" data-suggestion-color="red" data-suggestion-replacement="replacement text" data-suggestion-rationale="because">original text</span></p>',
      },
      ({ editor }) => {
        const html = editor.getHTML();
        expect(html).toContain('data-suggestion-id="s-1"');
        expect(html).toMatch(/data-suggestion-versionid="v-1"/);
        expect(html).toContain('data-suggestion-author="Editor"');
        expect(html).toContain('data-suggestion-color="red"');
        expect(html).toContain(
          'data-suggestion-replacement="replacement text"',
        );
        expect(html).toContain('data-suggestion-rationale="because"');
      },
    );
  });

  test("renderHTML applies the suggestion class", async () => {
    await withEditor(
      {
        content:
          '<p><span data-suggestion-id="s-1" data-suggestion-versionId="v-1" data-suggestion-author="Editor" data-suggestion-color="red" data-suggestion-replacement="r" data-suggestion-rationale="why">text</span></p>',
      },
      ({ editor }) => {
        const html = editor.getHTML();
        expect(html).toContain("twyne-suggestion");
      },
    );
  });

  test("setSuggestion applies the mark programmatically", async () => {
    await withEditor({ content: "<p>original text</p>" }, ({ editor }) => {
      editor.commands.setTextSelection({ from: 1, to: 7 });
      editor.commands.setSuggestion({
        id: "s-1",
        versionId: "v-1",
        author: "Editor",
        color: "red",
        replacement: "replacement",
        rationale: "because",
      });
      const html = editor.getHTML();
      expect(html).toContain('data-suggestion-id="s-1"');
      expect(html).toContain('data-suggestion-replacement="replacement"');
    });
  });

  test("deleting the marked passage leaves no mark behind", async () => {
    await withEditor({ content: "<p>kill me</p>" }, ({ editor }) => {
      editor.commands.setTextSelection({ from: 1, to: 8 });
      editor.commands.setSuggestion({
        id: "s-1",
        versionId: "v-1",
        author: "Editor",
        color: "red",
        replacement: "r",
        rationale: "why",
      });
      editor.commands.deleteSelection();
      expect(editor.getHTML()).not.toContain("data-suggestion-id");
    });
  });
});
