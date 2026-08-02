import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import { ParagraphFormat } from "./paragraph-format";

describe("ParagraphFormat", () => {
  test("writes spacing as points and round-trips the attributes", async () => {
    await withEditor(
      {
        content: "<p>One</p>",
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        expect(editor.commands.setSpaceBefore(12)).toBe(true);
        expect(editor.commands.setSpaceAfter(18)).toBe(true);
        expect(editor.getHTML()).toContain('data-space-before="12"');
        expect(editor.getHTML()).toContain('data-space-after="18"');
        expect(editor.getHTML()).toContain("margin-top: 12pt");
        expect(editor.getHTML()).toContain("margin-bottom: 18pt");
      },
    );
  });

  test("line height belongs to the whole paragraph, not a text span", async () => {
    await withEditor(
      {
        content: "<p>One</p>",
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        editor.commands.setParagraphLineHeight("1.5");
        expect(editor.getHTML()).toBe('<p style="line-height: 1.5;">One</p>');
        expect(editor.getHTML()).not.toContain("<span");
      },
    );
  });

  test("explicit zero is preserved instead of falling back to the theme", async () => {
    await withEditor(
      {
        content: "<p>One</p>",
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        editor.commands.setSpaceAfter(0);
        expect(editor.getHTML()).toContain('data-space-after="0"');
        expect(editor.getHTML()).toContain("margin-bottom: 0pt");
      },
    );
  });

  test("null restores the manuscript default", async () => {
    await withEditor(
      {
        content: '<p data-space-before="12" data-space-after="18">One</p>',
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        editor.commands.setSpaceBefore(null);
        editor.commands.setSpaceAfter(null);
        expect(editor.getHTML()).not.toContain("data-space-before");
        expect(editor.getHTML()).not.toContain("data-space-after");
      },
    );
  });

  test("updates every paragraph and heading touched by a selection", async () => {
    await withEditor(
      {
        content: "<p>One</p><h2>Two</h2><p>Three</p>",
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.selectAll();
        editor.commands.setSpaceAfter(6);
        expect(editor.getHTML().match(/data-space-after="6"/g)).toHaveLength(3);
      },
    );
  });

  test("keep-with-next survives HTML and can be cleared", async () => {
    await withEditor(
      {
        content: "<p>Lead</p><p>Body</p>",
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        editor.commands.setKeepWithNext(true);
        expect(editor.getHTML()).toContain('data-keep-with-next="true"');
        expect(editor.getHTML()).toContain("break-after: avoid");

        editor.commands.setKeepWithNext(false);
        expect(editor.getHTML()).not.toContain("data-keep-with-next");
      },
    );
  });

  test("clamps imported and commanded spacing to a safe range", async () => {
    await withEditor(
      {
        content: '<p data-space-before="999">One</p>',
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        expect(editor.getAttributes("paragraph").spaceBefore).toBe(144);
        editor.commands.setTextSelection(2);
        editor.commands.setSpaceAfter(-5);
        expect(editor.getAttributes("paragraph").spaceAfter).toBe(0);
      },
    );
  });

  test("unsetParagraphFormat clears all three paragraph settings", async () => {
    await withEditor(
      {
        content:
          '<p data-space-before="6" data-space-after="12" data-keep-with-next="true">One</p>',
        extensions: [ParagraphFormat],
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        editor.commands.unsetParagraphFormat();
        expect(editor.getAttributes("paragraph")).toMatchObject({
          lineHeight: null,
          spaceBefore: null,
          spaceAfter: null,
          keepWithNext: false,
        });
      },
    );
  });
});
