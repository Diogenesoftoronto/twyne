import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LAYOUT,
  PAPER_SIZE_IN,
  resolvePageSetup,
  type LayoutSettings,
} from "../types";
import {
  formatMargin,
  inToPx,
  pxToIn,
  pxToRem,
  remToPx,
} from "./css-units";

/**
 * Page setup arrived after pagination did, which means every folio written
 * before it exists without a single one of these fields. The contract that
 * matters most here is the boring one: an old document must still open onto
 * the page its writer expected, not onto a blank default.
 */
describe("resolvePageSetup", () => {
  const legacy: LayoutSettings = {
    width: "normal",
    margin: "normal",
    runningHeader: false,
    pageNumbers: true,
  };

  test("a document written before pagination resolves to Letter portrait", () => {
    const s = resolvePageSetup(legacy);
    expect(s.paper).toBe("letter");
    expect(s.orientation).toBe("portrait");
    // Continuous is the default *view* — writers draft by scrolling. The
    // sheet dimensions are still resolved, because export and the Pages
    // toggle both need to know what paper this document is set on.
    expect(s.pagination).toBe("continuous");
    expect(s.marginUnit).toBe("rem");
    expect(s.widthIn).toBe(8.5);
    expect(s.heightIn).toBe(11);
  });

  test("paginated mode is honoured rather than overridden", () => {
    const s = resolvePageSetup({ ...legacy, pagination: "paginated" });
    expect(s.pagination).toBe("paginated");
  });

  test("landscape swaps the sheet dimensions", () => {
    const s = resolvePageSetup({ ...legacy, orientation: "landscape" });
    expect(s.widthIn).toBe(11);
    expect(s.heightIn).toBe(8.5);
  });

  test("A4 is 210 x 297 mm", () => {
    // The stored inches are the source of truth; check they round-trip to
    // the millimetre figures the rest of the world uses for A4.
    const s = resolvePageSetup({ ...legacy, paper: "a4" });
    expect(s.widthIn * 25.4).toBeCloseTo(210, 1);
    expect(s.heightIn * 25.4).toBeCloseTo(297, 1);
  });

  test("legal is letter-width but taller", () => {
    const s = resolvePageSetup({ ...legacy, paper: "legal" });
    expect(s.widthIn).toBe(PAPER_SIZE_IN.letter.w);
    expect(s.heightIn).toBe(14);
  });

  test("continuous mode is honoured rather than overridden", () => {
    const s = resolvePageSetup({ ...legacy, pagination: "continuous" });
    expect(s.pagination).toBe("continuous");
  });

  test("an unrecognised paper falls back to Letter instead of NaN", () => {
    // Defensive: a hand-edited or future-versioned folio must not produce a
    // page of undefined height, which would divide the whole engine by zero.
    const s = resolvePageSetup({
      ...legacy,
      paper: "tabloid" as LayoutSettings["paper"],
    });
    expect(s.widthIn).toBe(8.5);
    expect(s.heightIn).toBe(11);
  });

  test("the default layout resolves to its own declared values", () => {
    const s = resolvePageSetup(DEFAULT_LAYOUT);
    expect(s.paper).toBe("letter");
    expect(s.orientation).toBe("portrait");
    expect(s.pagination).toBe("continuous");
  });
});

/**
 * The unit bridge. If these drift, screen and print drift with them.
 */
describe("css-units", () => {
  test("rem and px agree at a 16px root", () => {
    expect(remToPx(3)).toBe(48);
    expect(pxToRem(48)).toBe(3);
  });

  test("px and inches agree at the spec-fixed 96/in", () => {
    expect(pxToIn(48)).toBe(0.5);
    expect(inToPx(8.5)).toBe(816);
  });

  test("a non-default root font size scales rem but not inches", () => {
    // This is the one knowing divergence between screen and print: the
    // reader's text scaling moves the margins, while the sheet stays 8.5in.
    expect(remToPx(3, 20)).toBe(60);
    expect(inToPx(8.5)).toBe(816);
  });

  test("formatMargin speaks all three units", () => {
    expect(formatMargin(3, "rem")).toBe("3.00 rem");
    expect(formatMargin(3, "in")).toBe("0.50 in");
    expect(formatMargin(3, "mm")).toBe("12.7 mm");
  });
});
