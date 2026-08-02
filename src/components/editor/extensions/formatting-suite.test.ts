import { describe, expect, test } from "bun:test";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { withEditor } from "../test-harness";
import { ParagraphFormat } from "./paragraph-format";
import { recaseTextSegments } from "../../../utils/typography-options";

const formattingExtensions = [
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  TextStyleKit.configure({
    lineHeight: false,
  }),
  TextAlign.configure({
    types: ["paragraph", "heading"],
    alignments: ["left", "center", "right", "justify"],
  }),
  ParagraphFormat,
];

describe("character formatting suite", () => {
  test("text colour, family and point size serialize together", async () => {
    await withEditor(
      {
        content: "<p>Specimen</p>",
        extensions: formattingExtensions,
      },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 9 });
        editor.commands.setColor("#964f40");
        editor.commands.setFontFamily('"Lora", Georgia, serif');
        editor.commands.setFontSize("14pt");
        expect(editor.getAttributes("textStyle").color).toBe("#964f40");
        expect(editor.getHTML()).toContain("font-family");
        expect(editor.getHTML()).toContain("font-size: 14pt");
      },
    );
  });

  test("multicolour highlight stores the selected literal colour", async () => {
    await withEditor(
      {
        content: "<p>Specimen</p>",
        extensions: formattingExtensions,
      },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 9 });
        editor.commands.setHighlight({ color: "#cfe0f2" });
        expect(editor.getHTML()).toContain('data-color="#cfe0f2"');
        expect(editor.getAttributes("highlight").color).toBe("#cfe0f2");
      },
    );
  });

  test("subscript and superscript can be made mutually exclusive", async () => {
    await withEditor(
      {
        content: "<p>x2</p>",
        extensions: formattingExtensions,
      },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 2, to: 3 });
        editor.commands.setSubscript();
        expect(editor.isActive("subscript")).toBe(true);
        editor.chain().unsetSubscript().setSuperscript().run();
        expect(editor.isActive("subscript")).toBe(false);
        expect(editor.isActive("superscript")).toBe(true);
      },
    );
  });

  test("line height and justification are paragraph properties", async () => {
    await withEditor(
      {
        content: "<p>One</p>",
        extensions: formattingExtensions,
      },
      ({ editor }) => {
        editor.commands.setTextSelection(2);
        editor.commands.setParagraphLineHeight("1.5");
        editor.commands.setTextAlign("justify");
        expect(editor.getHTML()).toContain("line-height: 1.5");
        expect(editor.getHTML()).toContain("text-align: justify");
      },
    );
  });

  test("case changes can retain every text node's existing marks", async () => {
    await withEditor(
      {
        content: "<p><strong>the fall</strong> of <em>the house</em></p>",
        extensions: formattingExtensions,
      },
      ({ editor }) => {
        editor.commands.selectAll();
        const { from, to } = editor.state.selection;
        const segments: Array<{
          from: number;
          to: number;
          text: string;
          marks: readonly any[];
        }> = [];
        editor.state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText || !node.text) return;
          segments.push({
            from: Math.max(from, pos),
            to: Math.min(to, pos + node.nodeSize),
            text: node.text,
            marks: node.marks,
          });
        });
        const edits = recaseTextSegments(segments, "title");
        let tr = editor.state.tr;
        for (let i = edits.length - 1; i >= 0; i--) {
          const edit = edits[i];
          tr = tr.replaceWith(
            edit.from,
            edit.to,
            editor.state.schema.text(edit.text, segments[i].marks),
          );
        }
        editor.view.dispatch(tr);
        expect(editor.getHTML()).toBe(
          "<p><strong>The Fall</strong> of <em>the House</em></p>",
        );
      },
    );
  });
});
