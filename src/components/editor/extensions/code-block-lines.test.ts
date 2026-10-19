import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import {
  normalizeLineRanges,
  parseLineRanges,
} from "../../../utils/code-lines";

describe("line ranges", () => {
  test("parse and normalise", () => {
    expect(parseLineRanges("3, 5-7")).toEqual([3, 5, 6, 7]);
    expect(parseLineRanges("7-5,0,x,2")).toEqual([2]);
    expect(normalizeLineRanges("5-6, 3,4,9")).toBe("3-6,9");
    expect(normalizeLineRanges("nonsense")).toBe("");
  });
});

describe("CodeBlockLines", () => {
  test("setCodeHighlightLines stores, renders and re-parses the attribute", async () => {
    await withEditor(
      {
        content:
          '<pre><code class="language-ts">a\nb\nc\nd</code></pre>',
      },
      ({ editor, html }) => {
        editor.commands.setTextSelection(2);
        expect(editor.commands.setCodeHighlightLines("2, 3-4")).toBe(true);
        expect(html()).toContain('data-highlight-lines="2-4"');
        expect(html()).toContain("language-ts");
        const saved = html();
        editor.commands.setContent(saved);
        expect(html()).toBe(saved);
        editor.commands.setTextSelection(2);
        expect(editor.commands.setCodeHighlightLines("")).toBe(true);
        expect(html()).not.toContain("data-highlight-lines");
      },
    );
  });

  test("highlighted lines are decorated in the editor", async () => {
    await withEditor(
      { content: "<pre><code>a\nb\nc</code></pre>" },
      ({ editor, host }) => {
        editor.commands.setTextSelection(2);
        editor.commands.setCodeHighlightLines("2");
        const marked = host.querySelectorAll(".twyne-code-line-hl");
        expect(marked.length).toBe(1);
        expect(marked[0].textContent).toBe("b");
      },
    );
  });

  test("the command does nothing outside a code block", async () => {
    await withEditor({ content: "<p>x</p>" }, ({ editor }) => {
      expect(editor.commands.setCodeHighlightLines("1")).toBe(false);
    });
  });
});
