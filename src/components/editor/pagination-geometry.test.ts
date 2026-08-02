import { describe, expect, test } from "bun:test";
import {
  buildNaturalStack,
  computePageGeometry,
  paginate,
  sameBreaks,
  type BlockMetric,
  type PageGeometry,
} from "./pagination-geometry";
import { DEFAULT_LAYOUT, type LayoutSettings } from "../../types";

/**
 * A deliberately round page so the arithmetic in each expectation is
 * checkable by eye: 1000px sheet, 100px margins top and bottom, 20px gap.
 * That leaves 800px of content per sheet and a grid period of 1020px.
 */
const GEO: PageGeometry = {
  pageH: 1000,
  pageW: 800,
  gap: 20,
  marginTop: 100,
  marginBottom: 100,
  marginLeft: 100,
  marginRight: 100,
  contentH: 800,
  contentW: 600,
};
const PERIOD = GEO.pageH + GEO.gap;

let nextPos = 1;
function block(height: number, extra: Partial<BlockMetric> = {}): BlockMetric {
  return {
    pos: nextPos++,
    height,
    marginTop: 0,
    marginBottom: 0,
    ...extra,
  };
}
function pageBreakBlock(): BlockMetric {
  return block(0, { forcedBreak: true });
}

/**
 * The property the whole design rests on. Every page's first block must land
 * exactly on `page * (pageH + gap)` once the spacers ahead of it are added in;
 * if this holds, the sheet gradient, the running header and the page numbers
 * are all correct by construction rather than by coincidence.
 */
function assertGridInvariant(
  metrics: readonly BlockMetric[],
  result: ReturnType<typeof paginate>,
) {
  const tops = buildNaturalStack(metrics);
  let cumulative = 0;
  for (const b of result.breaks) {
    cumulative += b.height;
    expect(tops[b.blockIndex] + cumulative).toBeCloseTo(b.page * PERIOD, 6);
  }
}

describe("buildNaturalStack", () => {
  test("adjacent margins collapse rather than sum", () => {
    // A paragraph's 0.85em bottom margin against a heading's 2.2rem top
    // margin — the real pair from global.css. The browser takes the larger;
    // an engine that added them would drift by 13.6px at every heading.
    const metrics = [
      block(100, { marginBottom: 13.6 }),
      block(50, { marginTop: 35.2 }),
    ];
    const tops = buildNaturalStack(metrics);
    expect(tops[0]).toBe(0);
    expect(tops[1]).toBe(135.2);
  });

  test("the first block's top margin applies rather than collapsing through", () => {
    // The page canvas has padding, so there is nothing for it to collapse
    // through — the margin is real space at the top of the page.
    const tops = buildNaturalStack([block(100, { marginTop: 35.2 })]);
    expect(tops[0]).toBe(35.2);
  });

  test("a forced break contributes no height and no margins", () => {
    const metrics = [
      block(100, { marginBottom: 20 }),
      pageBreakBlock(),
      block(100, { marginTop: 20 }),
    ];
    const tops = buildNaturalStack(metrics);
    expect(tops[1]).toBe(120);
    // The break itself occupies nothing, so the next block sits where the
    // break does — both land on the content top of the new page.
    expect(tops[2]).toBe(120);
  });

  test("an empty list produces an empty stack", () => {
    expect(buildNaturalStack([])).toEqual([]);
  });
});

describe("paginate — the ordinary cases", () => {
  test("an empty document is one page with no breaks", () => {
    expect(paginate([], GEO)).toEqual({ breaks: [], pageCount: 1 });
  });

  test("content that fits on one sheet does not break", () => {
    const metrics = [block(300), block(300)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toEqual([]);
    expect(result.pageCount).toBe(1);
  });

  test("an exact fit spaces by gap + both margins", () => {
    // Two 800px blocks against an 800px content box. The spacer has to carry
    // the bottom margin of page 1, the visual gap, and the top margin of
    // page 2 — 100 + 20 + 100.
    const metrics = [block(800), block(800)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].height).toBe(
      GEO.gap + GEO.marginTop + GEO.marginBottom,
    );
    expect(result.breaks[0].page).toBe(1);
    expect(result.pageCount).toBe(2);
    assertGridInvariant(metrics, result);
  });

  test("a block one pixel past the content box moves to the next page", () => {
    const metrics = [block(800), block(1)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].blockIndex).toBe(1);
  });

  test("many small blocks fill pages in order", () => {
    const metrics = Array.from({ length: 20 }, () => block(100));
    const result = paginate(metrics, GEO);
    // 8 blocks of 100px per 800px page → breaks at 8 and 16, three pages.
    expect(result.breaks.map((b) => b.blockIndex)).toEqual([8, 16]);
    expect(result.pageCount).toBe(3);
    assertGridInvariant(metrics, result);
  });

  test("every spacer is strictly positive", () => {
    const metrics = Array.from({ length: 40 }, (_, i) => block(50 + i * 7));
    const result = paginate(metrics, GEO);
    expect(result.breaks.length).toBeGreaterThan(0);
    for (const b of result.breaks) expect(b.height).toBeGreaterThan(0);
  });
});

describe("paginate — blocks taller than a page", () => {
  test("an oversized block keeps its page and spans several sheets", () => {
    // 2500px of ink against a 1020px grid period → it covers three sheets,
    // so the block after it opens page 3.
    const metrics = [block(2500), block(100)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].blockIndex).toBe(1);
    expect(result.breaks[0].page).toBe(3);
    expect(result.breaks[0].height).toBeGreaterThan(0);
    expect(result.pageCount).toBe(4);
    assertGridInvariant(metrics, result);
  });

  test("a block taller than three pages does not loop or go negative", () => {
    const metrics = [block(PERIOD * 3), block(100)];
    const result = paginate(metrics, GEO);
    expect(result.breaks[0].page).toBe(4);
    expect(result.breaks[0].height).toBeGreaterThanOrEqual(GEO.gap);
    assertGridInvariant(metrics, result);
  });

  test("an oversized block bleeds from where it falls, without a hole before it", () => {
    // This is the case that would loop forever in a naive engine: the block
    // does not fit, so move it to the next page, where it still does not fit.
    //
    // It is also the case that used to leave a hole. A 5000px block bleeds
    // across sheets wherever it starts, so pushing it to a fresh page bought
    // nothing and wasted the 600px still free on the page before. It now
    // begins in place; only the block *after* it takes a break.
    const metrics = [block(200), block(5000), block(200)];
    const result = paginate(metrics, GEO);
    expect(result.breaks.map((b) => b.blockIndex)).toEqual([2]);
    assertGridInvariant(metrics, result);
  });

  test("a heading is never marooned on a blank page by the paragraph it opens", () => {
    // The reported bug. The backwards keepWithNext walk cannot move here —
    // the heading is already the first block after `runStart` — so the run
    // used to close with nothing on the sheet but the heading, once per
    // oversized paragraph.
    const metrics = [
      block(700),
      block(50, { keepWithNext: true }),
      block(2000),
      block(100),
    ];
    const result = paginate(metrics, GEO);
    // No break lands on the paragraph, so nothing strands the heading before it.
    expect(result.breaks.map((b) => b.blockIndex)).not.toContain(2);
    assertGridInvariant(metrics, result);
  });

  test("consecutive oversized blocks each get their own run", () => {
    const metrics = [block(2000), block(2000), block(2000)];
    const result = paginate(metrics, GEO);
    expect(result.breaks.map((b) => b.blockIndex)).toEqual([1, 2]);
    for (const b of result.breaks) expect(b.height).toBeGreaterThan(0);
    assertGridInvariant(metrics, result);
  });
});

describe("paginate — manual page breaks", () => {
  test("a page break forces a break even mid-page", () => {
    const metrics = [block(100), pageBreakBlock(), block(100)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].forced).toBe(true);
    expect(result.breaks[0].blockIndex).toBe(1);
    expect(result.pageCount).toBe(2);
    assertGridInvariant(metrics, result);
  });

  test("the block after a manual break sits at the new page's content top", () => {
    const metrics = [block(100), pageBreakBlock(), block(100)];
    const result = paginate(metrics, GEO);
    const tops = buildNaturalStack(metrics);
    // The break node and the block after it share a natural top, so once the
    // spacer is added both land exactly on the grid.
    expect(tops[2] + result.breaks[0].height).toBe(PERIOD);
  });

  test("consecutive manual breaks produce consecutive pages", () => {
    const metrics = [
      block(100),
      pageBreakBlock(),
      pageBreakBlock(),
      block(100),
    ];
    const result = paginate(metrics, GEO);
    expect(result.breaks.map((b) => b.page)).toEqual([1, 2]);
    expect(result.pageCount).toBe(3);
    assertGridInvariant(metrics, result);
  });

  test("a break at the very top of the document does nothing", () => {
    const metrics = [pageBreakBlock(), block(100)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toEqual([]);
    expect(result.pageCount).toBe(1);
  });

  test("a trailing break opens an empty final page", () => {
    const metrics = [block(100), pageBreakBlock()];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.pageCount).toBe(2);
  });

  test("a forced break is not moved by keepWithNext", () => {
    // The writer put the break there deliberately; leaving the heading as the
    // last thing on the page is what they asked for.
    const metrics = [
      block(100),
      block(50, { keepWithNext: true }),
      pageBreakBlock(),
      block(100),
    ];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].blockIndex).toBe(2);
  });
});

describe("paginate — keepWithNext", () => {
  test("a heading stranded at the foot of a page moves down with its text", () => {
    const metrics = [
      block(700),
      block(100, { keepWithNext: true }),
      block(200),
    ];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].blockIndex).toBe(1);
    assertGridInvariant(metrics, result);
  });

  test("a run of consecutive headings moves as a unit", () => {
    const metrics = [
      block(600),
      block(60, { keepWithNext: true }),
      block(60, { keepWithNext: true }),
      block(200),
    ];
    const result = paginate(metrics, GEO);
    expect(result.breaks[0].blockIndex).toBe(1);
    assertGridInvariant(metrics, result);
  });

  test("the constraint is dropped rather than emptying a page", () => {
    // The heading is the only block on its page and still does not fit. There
    // is nowhere to move it to, so keepWithNext yields instead of looping.
    const metrics = [block(900, { keepWithNext: true }), block(100)];
    const result = paginate(metrics, GEO);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].blockIndex).toBe(1);
  });

  test("a heading run taller than a page drops the constraint", () => {
    const metrics = [
      block(100),
      ...Array.from({ length: 12 }, () => block(100, { keepWithNext: true })),
      block(100),
    ];
    const result = paginate(metrics, GEO);
    expect(result.breaks.length).toBeGreaterThan(0);
    for (const b of result.breaks) expect(b.height).toBeGreaterThan(0);
    assertGridInvariant(metrics, result);
  });

  test("the block re-tested after a backwards walk is not skipped", () => {
    // Moving the break back to the heading leaves the following paragraph on
    // the new page; it must still be measured there rather than assumed to fit.
    // 780px fits on a sheet of its own, so it is a candidate for a break;
    // it just does not fit in the 750px left under the heading it follows.
    const metrics = [
      block(700),
      block(50, { keepWithNext: true }),
      block(780),
      block(100),
    ];
    const result = paginate(metrics, GEO);
    // The break at 2 is the re-test: block 2 moved to the new page with the
    // heading, was measured there, and still did not fit.
    expect(result.breaks.map((b) => b.blockIndex)).toEqual([1, 2, 3]);
    assertGridInvariant(metrics, result);
  });
});

describe("paginate — degenerate input", () => {
  test("zero-height blocks do not loop or invent pages", () => {
    const metrics = Array.from({ length: 200 }, () => block(0));
    const result = paginate(metrics, GEO);
    expect(result.breaks).toEqual([]);
    expect(result.pageCount).toBe(1);
  });

  test("a single empty paragraph is one page", () => {
    const result = paginate([block(0)], GEO);
    expect(result).toEqual({ breaks: [], pageCount: 1 });
  });

  test("maxPages caps the work rather than running away", () => {
    const metrics = Array.from({ length: 500 }, () => block(400));
    const result = paginate(metrics, GEO, { maxPages: 10 });
    expect(result.pageCount).toBeLessThanOrEqual(10);
    expect(result.breaks.length).toBeLessThanOrEqual(10);
  });

  test("a content box narrower than one block still terminates", () => {
    const tight: PageGeometry = { ...GEO, contentH: 1 };
    const metrics = Array.from({ length: 50 }, () => block(100));
    const result = paginate(metrics, tight);
    expect(result.breaks).toHaveLength(49);
    for (const b of result.breaks) expect(b.height).toBeGreaterThan(0);
  });
});

describe("paginate — the tail element", () => {
  test("the manuscript notes block can push the page count up", () => {
    const metrics = [block(700)];
    expect(paginate(metrics, GEO).pageCount).toBe(1);
    expect(paginate(metrics, GEO, { tailHeight: 1500 }).pageCount).toBe(3);
  });

  test("a tail that fits changes nothing", () => {
    const metrics = [block(100)];
    expect(paginate(metrics, GEO, { tailHeight: 200 }).pageCount).toBe(1);
  });
});

describe("paginate — stability", () => {
  const metrics = [
    block(300),
    block(120, { keepWithNext: true, marginTop: 35.2 }),
    block(400, { marginBottom: 13.6 }),
    block(900),
    pageBreakBlock(),
    block(250),
    block(250),
  ];

  test("running it twice gives an identical result", () => {
    const a = paginate(metrics, GEO);
    const b = paginate(metrics, GEO);
    expect(b).toEqual(a);
    expect(sameBreaks(a.breaks, b.breaks)).toBe(true);
  });

  test("editing a late block leaves earlier breaks untouched", () => {
    // This is the property that lets the extension remeasure only from the
    // first dirty block downward instead of walking the whole document.
    const before = paginate(metrics, GEO);
    const edited = metrics.map((m, i) =>
      i === metrics.length - 1 ? { ...m, height: m.height + 40 } : m,
    );
    const after = paginate(edited, GEO);
    const shared = before.breaks.filter((b) => b.blockIndex < 5);
    expect(after.breaks.slice(0, shared.length)).toEqual(shared);
  });

  test("sameBreaks tolerates sub-pixel jitter but not real movement", () => {
    const a = paginate(metrics, GEO);
    const jittered = a.breaks.map((b) => ({ ...b, height: b.height + 0.2 }));
    expect(sameBreaks(a.breaks, jittered)).toBe(true);
    const moved = a.breaks.map((b) => ({ ...b, height: b.height + 5 }));
    expect(sameBreaks(a.breaks, moved)).toBe(false);
  });
});

describe("computePageGeometry", () => {
  // Explicit: an unset mode resolves to continuous now that the editor
  // defaults to scrolling, and continuous takes its width from the text
  // column rather than the sheet. These are the sheet numbers.
  const layout: LayoutSettings = { ...DEFAULT_LAYOUT, pagination: "paginated" };

  test("Letter portrait at a 16px root is 816 x 1056 CSS px", () => {
    const g = computePageGeometry(layout, 16);
    expect(g.pageW).toBe(816);
    expect(g.pageH).toBe(1056);
    // 1rem top + 1rem bottom = 32px of margin.
    expect(g.contentH).toBe(1056 - 16 - 16);
  });

  test("A4 landscape swaps the sheet", () => {
    const g = computePageGeometry(
      { ...layout, paper: "a4", orientation: "landscape" },
      16,
    );
    expect(g.pageW).toBeGreaterThan(g.pageH);
  });

  test("margins that meet still leave a positive content box", () => {
    // Otherwise every downstream division becomes Infinity and the engine
    // allocates pages until the tab dies.
    const g = computePageGeometry(
      { ...layout, marginTop: 40, marginBottom: 40 },
      16,
    );
    expect(g.contentH).toBeGreaterThan(0);
  });

  test("a legacy layout with no paper field still gets a Letter sheet", () => {
    const g = computePageGeometry(
      {
        width: "normal",
        margin: "normal",
        runningHeader: false,
        pageNumbers: true,
      },
      16,
    );
    expect(g.pageH).toBe(1056);
  });

  test("continuous mode sizes the page to the chosen column instead", () => {
    const g = computePageGeometry(
      { ...layout, pagination: "continuous", width: "wide" },
      16,
    );
    expect(g.pageW).toBe(62 * 16 + 32 + 32);
  });
});
