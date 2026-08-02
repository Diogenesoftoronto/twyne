import { describe, expect, test } from "bun:test";
import {
  contrastRatio,
  HIGHLIGHT_SWATCHES,
  INK_SWATCHES,
  MANUSCRIPT_INK,
  TEXT_SWATCHES,
  normalizeHex,
  parseHex,
  readableInkOn,
  swatchByHex,
  swatchesFor,
} from "./palette";

describe("the palette is actually a palette", () => {
  test("no two ink swatches are the same paint", () => {
    // The list this replaced had six entries and four colours: "wine" was
    // mustard and "indigo" was cobalt. A picker that offers the same colour
    // twice under different names is worse than one with fewer choices.
    const hexes = INK_SWATCHES.map((s) => s.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  test("no two highlight swatches are the same paint", () => {
    const hexes = HIGHLIGHT_SWATCHES.map((s) => s.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  test("ids are unique and stable-looking", () => {
    for (const list of [INK_SWATCHES, TEXT_SWATCHES, HIGHLIGHT_SWATCHES]) {
      const ids = list.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test("every swatch carries a literal colour, not only a variable", () => {
    // A mark styled with var(--color-mustard) renders nothing in an exported
    // standalone HTML file. Colour that leaves the app has to be a literal.
    for (const s of [...INK_SWATCHES, ...TEXT_SWATCHES, ...HIGHLIGHT_SWATCHES]) {
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.cssVar).toMatch(/^var\(--/);
    }
  });
});

describe("highlights stay readable", () => {
  test("manuscript ink clears WCAG AA on every highlight", () => {
    // The whole point of a highlight is that you can still read the sentence.
    for (const s of HIGHLIGHT_SWATCHES) {
      const ratio = contrastRatio(s.hex, MANUSCRIPT_INK);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("every text colour clears WCAG AA against paper", () => {
    // This is why the text list exists separately from the ink list: mustard
    // scores 2.0:1 on paper and blush 1.7:1. Both are good badges and neither
    // is text, and a single palette serving both jobs offers the writer
    // colours their readers cannot read.
    const paper = "#f4ecd8";
    for (const s of TEXT_SWATCHES) {
      expect(contrastRatio(s.hex, paper)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the ink list still carries the accents that failed as text", () => {
    // Losing them entirely would be the wrong fix — they are the persona
    // colours, and a chip is not a paragraph.
    const ids = INK_SWATCHES.map((s) => s.id);
    expect(ids).toContain("mustard");
    expect(ids).toContain("blush");
  });

  test("no text swatch is the same paint as another", () => {
    const hexes = TEXT_SWATCHES.map((s) => s.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe("contrast maths", () => {
  test("black on white is the maximum ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  test("a colour against itself is 1", () => {
    expect(contrastRatio("#c1272d", "#c1272d")).toBeCloseTo(1, 5);
  });

  test("readableInkOn flips to white only when ink would vanish", () => {
    expect(readableInkOn("#fbeaa8")).toBe(MANUSCRIPT_INK);
    expect(readableInkOn("#1a1a1a")).toBe("#ffffff");
  });
});

describe("hex handling", () => {
  test("shorthand expands", () => {
    expect(parseHex("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  test("a leading hash is optional", () => {
    expect(parseHex("c1272d")).toEqual({ r: 0xc1, g: 0x27, b: 0x2d });
  });

  test("nonsense is rejected rather than coerced", () => {
    expect(parseHex("rebeccapurple")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(normalizeHex("not a colour")).toBeNull();
  });

  test("normalizeHex produces the canonical form", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("C1272D")).toBe("#c1272d");
  });
});

describe("lookup", () => {
  test("a stored colour resolves back to its swatch", () => {
    expect(swatchByHex("#C1272D", "ink")?.id).toBe("vermilion");
    expect(swatchByHex("#fbeaa8", "highlight")?.id).toBe("butter");
  });

  test("a custom colour resolves to nothing rather than the nearest swatch", () => {
    // The picker allows arbitrary colours; pretending one of them is
    // "vermilion" would mislabel it everywhere it is shown.
    expect(swatchByHex("#123456", "ink")).toBeUndefined();
  });

  test("the two palettes are kept separate", () => {
    expect(swatchesFor("ink")).toBe(INK_SWATCHES);
    expect(swatchesFor("highlight")).toBe(HIGHLIGHT_SWATCHES);
    expect(swatchByHex("#c1272d", "highlight")).toBeUndefined();
  });
});
