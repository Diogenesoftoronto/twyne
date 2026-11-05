import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import {
  DRAFT_SAVED_EVENT,
  DRYING_INK_HIGHLIGHT,
  WET_INK_HIGHLIGHT,
  WetInk,
  getWetInk,
  mergeInkRanges,
} from "./wet-ink";

const extensions = [WetInk];

/** Stand-in for `CSS.highlights` and `Highlight`, which JSDOM lacks. */
function installHighlights() {
  const registry = new Map<string, { ranges: Range[] }>();
  const previousCss = (globalThis as { CSS?: unknown }).CSS;
  (globalThis as { CSS?: unknown }).CSS = { highlights: registry };
  (window as unknown as { Highlight: unknown }).Highlight = class {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  };
  return {
    registry,
    restore: () => {
      (globalThis as { CSS?: unknown }).CSS = previousCss;
    },
  };
}

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("mergeInkRanges", () => {
  test("sorts, merges touching ranges and drops empty ones", () => {
    expect(
      mergeInkRanges([
        { from: 9, to: 12 },
        { from: 1, to: 3 },
        { from: 3, to: 5 },
        { from: 7, to: 7 },
      ]),
    ).toEqual([
      { from: 1, to: 5 },
      { from: 9, to: 12 },
    ]);
  });
});

describe("WetInk", () => {
  test("words set by hand are wet; existing text is not", async () => {
    await withEditor(
      { content: "<p>The ledger</p>", extensions },
      ({ editor }) => {
        expect(getWetInk(editor.state)).toEqual([]);
        editor.commands.setTextSelection(11);
        editor.commands.insertContent(" kept");
        const wet = getWetInk(editor.state);
        expect(wet).toHaveLength(1);
        expect(editor.state.doc.textBetween(wet[0].from, wet[0].to)).toBe(
          " kept",
        );
      },
    );
  });

  test("ink follows its words when text is inserted before it", async () => {
    await withEditor(
      { content: "<p>salt roads</p>", extensions },
      ({ editor }) => {
        editor.commands.setTextSelection(11);
        editor.commands.insertContent(" inland");
        editor.view.dispatch(
          editor.state.tr.insertText("The ", 1).setMeta("addToHistory", false),
        );
        const wet = getWetInk(editor.state);
        expect(wet).toHaveLength(1);
        expect(editor.state.doc.textBetween(wet[0].from, wet[0].to)).toBe(
          " inland",
        );
      },
    );
  });

  test("consecutive keystrokes merge into one stroke", async () => {
    await withEditor({ content: "<p>a</p>", extensions }, ({ editor }) => {
      editor.commands.setTextSelection(2);
      for (const ch of "bcde") editor.commands.insertContent(ch);
      const wet = getWetInk(editor.state);
      expect(wet).toHaveLength(1);
      expect(editor.state.doc.textBetween(wet[0].from, wet[0].to)).toBe(
        "bcde",
      );
    });
  });

  test("programmatic rewrites, undo and pastes arrive dry", async () => {
    await withEditor({ content: "<p>a</p>", extensions }, ({ editor }) => {
      editor.view.dispatch(
        editor.state.tr.insertText("x", 2).setMeta("addToHistory", false),
      );
      expect(getWetInk(editor.state)).toEqual([]);
      editor.view.dispatch(
        editor.state.tr.insertText("pasted", 2).setMeta("paste", true),
      );
      expect(getWetInk(editor.state)).toEqual([]);
    });
  });

  test("a stored draft dries the ink", async () => {
    await withEditor({ content: "<p>a</p>", extensions }, ({ editor }) => {
      editor.commands.setTextSelection(2);
      editor.commands.insertContent("bc");
      expect(getWetInk(editor.state)).toHaveLength(1);
      window.dispatchEvent(new window.Event(DRAFT_SAVED_EVENT));
      expect(getWetInk(editor.state)).toEqual([]);
    });
  });

  test("paints wet ink through the highlight registry, then dries it", async () => {
    await withEditor({ content: "<p>a</p>", extensions }, async ({ editor }) => {
      const { registry, restore } = installHighlights();
      try {
        editor.commands.setTextSelection(2);
        editor.commands.insertContent("bc");
        await nextFrame();
        const wet = registry.get(WET_INK_HIGHLIGHT);
        expect(wet?.ranges).toHaveLength(1);
        expect(wet?.ranges[0].toString()).toBe("bc");

        window.dispatchEvent(new window.Event(DRAFT_SAVED_EVENT));
        expect(registry.has(WET_INK_HIGHLIGHT)).toBe(false);
        expect(registry.get(DRYING_INK_HIGHLIGHT)?.ranges[0].toString()).toBe(
          "bc",
        );
      } finally {
        restore();
      }
    });
  });

  test("still motion never paints ink", async () => {
    await withEditor({ content: "<p>a</p>", extensions }, async ({ editor }) => {
      const { registry, restore } = installHighlights();
      document.documentElement.setAttribute("data-motion", "still");
      try {
        editor.commands.setTextSelection(2);
        editor.commands.insertContent("bc");
        await nextFrame();
        expect(registry.has(WET_INK_HIGHLIGHT)).toBe(false);
      } finally {
        document.documentElement.removeAttribute("data-motion");
        restore();
      }
    });
  });
});
