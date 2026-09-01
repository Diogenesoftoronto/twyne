import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MANUSCRIPT_FONT_LABEL,
  DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL,
  FONT_CHOICES,
  FONT_SIZES,
  LINE_SPACINGS,
  recase,
  recaseTextSegments,
} from "./typography-options";

describe("font choices", () => {
  test("names the actual default family and size instead of hiding them", () => {
    expect(DEFAULT_MANUSCRIPT_FONT_LABEL).toBe("Lora (default)");
    expect(DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL).toBe("13.5");
  });

  test("every family the menu offers is one the app actually loads", () => {
    // A font menu is a promise about what the document will look like on
    // someone else's machine. Offering a family root.tsx never loads means the
    // writer sees it locally and their reader gets a fallback.
    const loaded = [
      "Lora",
      "Libre Baskerville",
      "DM Sans",
      "Special Elite",
      "ui-monospace",
    ];
    for (const f of FONT_CHOICES) {
      expect(loaded.some((v) => f.stack.includes(v))).toBe(true);
    }
  });

  test("every stack carries a fallback", () => {
    // A custom property alone resolves to nothing in an exported document.
    for (const f of FONT_CHOICES) {
      expect(f.stack.split(",").length).toBeGreaterThan(1);
    }
  });

  test("ids are unique", () => {
    const ids = FONT_CHOICES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sizes and spacings", () => {
  test("font sizes ascend", () => {
    const values = FONT_SIZES.map((s) => parseFloat(s.value));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  test("sizes are real points so labels and printed output agree", () => {
    for (const s of FONT_SIZES) {
      expect(s.value).toBe(`${s.label}pt`);
    }
  });

  test("line-spacing labels describe their actual values", () => {
    expect(LINE_SPACINGS).toEqual([
      { label: "Single", value: "1" },
      { label: "1.15", value: "1.15" },
      { label: "1.5", value: "1.5" },
      { label: "Double", value: "2" },
    ]);
  });

  test("spacings ascend", () => {
    const values = LINE_SPACINGS.map((s) => parseFloat(s.value));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe("recase", () => {
  test("upper and lower are the obvious thing", () => {
    expect(recase("The Quick Fox", "upper")).toBe("THE QUICK FOX");
    expect(recase("The Quick Fox", "lower")).toBe("the quick fox");
  });

  test("title case keeps minor words lowercase", () => {
    expect(recase("the fall of the house of usher", "title")).toBe(
      "The Fall of the House of Usher",
    );
  });

  test("a minor word still capitalises when it opens or closes", () => {
    // Every style guide agrees on this, and it is the case a naive
    // capitalise-every-word implementation gets wrong in the other direction.
    expect(recase("the thing we walked in", "title")).toBe(
      "The Thing We Walked In",
    );
    expect(recase("a room of one's own", "title")).toBe("A Room of One's Own");
  });

  test("a minor word is recognised through attached punctuation", () => {
    // "on," has to match the minor-word list despite the comma, or the comma
    // alone would decide the capitalisation. "against" is long enough to
    // capitalise under the AP-style line this list draws.
    expect(recase("notes on, and against, the novel", "title")).toBe(
      "Notes on, and Against, the Novel",
    );
  });

  test("original spacing is preserved rather than tidied", () => {
    // Selecting a line with a double space is not a request to reflow it.
    expect(recase("one  two", "title")).toBe("One  Two");
  });

  test("sentence case capitalises after terminal punctuation", () => {
    expect(recase("first one. second one! third one? fourth", "sentence")).toBe(
      "First one. Second one! Third one? Fourth",
    );
  });

  test("empty and whitespace input do not throw", () => {
    expect(recase("", "title")).toBe("");
    expect(recase("   ", "title")).toBe("   ");
  });
});

describe("recaseTextSegments", () => {
  test("keeps the original document ranges", () => {
    expect(
      recaseTextSegments(
        [
          { from: 2, to: 5, text: "one" },
          { from: 8, to: 11, text: "two" },
        ],
        "upper",
      ),
    ).toEqual([
      { from: 2, to: 5, text: "ONE" },
      { from: 8, to: 11, text: "TWO" },
    ]);
  });

  test("title case considers words across mark boundaries", () => {
    const result = recaseTextSegments(
      [
        { from: 1, to: 9, text: "the fall" },
        { from: 9, to: 22, text: " of the house" },
      ],
      "title",
    );
    expect(result.map((part) => part.text).join("")).toBe(
      "The Fall of the House",
    );
  });
});
