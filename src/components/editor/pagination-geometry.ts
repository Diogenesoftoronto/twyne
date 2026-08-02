/**
 * The pagination engine, with the DOM taken out of it.
 *
 * Everything here is arithmetic over plain numbers: measured block heights in,
 * page break positions and spacer heights out. Nothing in this file touches a
 * document, a view, or a stylesheet — which is the point. Pagination is the
 * one part of the editor where an off-by-a-few-pixels bug is invisible until
 * it isn't, so the part that can be wrong is the part that can be unit tested,
 * exactly as `popover-positioning.ts` did for the mark popovers.
 *
 * ## The invariant
 *
 * Spacers are sized so that every page's content top lands on a uniform grid:
 *
 *     renderedTop(page k) = k * (pageH + gap)
 *
 * measured from the top of page 0's content area. That single property is what
 * makes the rest of the feature cheap: the sheet edges can be painted with one
 * `repeating-linear-gradient` instead of N DOM nodes, and the running header
 * and page number for page k sit at a position you can compute with a multiply
 * rather than by asking the browser.
 *
 * ## Why the measure/decorate loop cannot oscillate
 *
 * The naive engine reads each block's `offsetTop`, inserts spacers, and finds
 * that every `offsetTop` has changed — so it measures again, forever. We never
 * read `offsetTop`. The caller reports only `height`, `marginTop` and
 * `marginBottom` per block, and {@link buildNaturalStack} reconstructs the
 * un-paginated stack from those. Because a spacer changes neither a block's
 * width nor its height, the inputs to this function are invariant under its
 * own output. The fixed point is structural, not a tuning parameter.
 *
 * This matters concretely: headings carry `margin-top: 2.2rem` which collapses
 * with the preceding paragraph's `margin-bottom`, and a spacer inserted between
 * them would stop that collapse. An engine reading `offsetTop` would shift by
 * ~15px at every heading break and never settle. One that computes the stack
 * is immune, because it models the collapse itself.
 */
import {
  DOC_WIDTH_REM,
  resolveMargins,
  resolvePageSetup,
  type LayoutSettings,
} from "../../types";
import { DEFAULT_ROOT_FONT_PX, inToPx, remToPx } from "../../utils/css-units";

/** Visual gap between two sheets, in rem. */
export const PAGE_GAP_REM = 1.5;

/**
 * A single top-level block, as measured in the rendered document.
 *
 * Heights are CSS pixels and come from `offsetHeight` (border box); margins
 * come from `getComputedStyle`. Never derive these from character counts or
 * an assumed column width — `indent.ts` narrows blocks by up to 16rem, and
 * only the rendered height knows what that did to the line wrapping.
 */
export interface BlockMetric {
  /** ProseMirror document position of the block's start. */
  pos: number;
  /** Rendered border-box height, CSS px. */
  height: number;
  /** Computed `margin-top`, CSS px. */
  marginTop: number;
  /** Computed `margin-bottom`, CSS px. */
  marginBottom: number;
  /**
   * This block is a `pageBreak` node. It forces a break before itself and
   * contributes no height of its own — the visible rule and label are drawn
   * by the page chrome overlay, in the gap, so a manual break never leaves a
   * stray line hanging at the top of the following page.
   */
  forcedBreak?: boolean;
  /**
   * This block must never be the last on a page — headings, in practice.
   * Mirrors `break-after: avoid` in the print stylesheet so screen and paper
   * make the same decision.
   */
  keepWithNext?: boolean;
}

/** The page, in CSS pixels. All derived from `LayoutSettings` + paper size. */
export interface PageGeometry {
  /** Full sheet height. */
  pageH: number;
  /** Full sheet width. */
  pageW: number;
  /** Gap painted between two sheets. */
  gap: number;
  /** Top page margin. */
  marginTop: number;
  /** Bottom page margin. */
  marginBottom: number;
  /** Left page margin. */
  marginLeft: number;
  /** Right page margin. */
  marginRight: number;
  /** `pageH - marginTop - marginBottom`; the usable height on one sheet. */
  contentH: number;
  /** `pageW - marginLeft - marginRight`; the text column width. */
  contentW: number;
}

export interface PageBreak {
  /** Index into the metrics array of the block that begins the new page. */
  blockIndex: number;
  /** ProseMirror position to hang the spacer widget on. */
  pos: number;
  /** Spacer height, CSS px. Always positive. */
  height: number;
  /** True when a `pageBreak` node caused this, rather than overflow. */
  forced: boolean;
  /** 0-based index of the page this break starts. */
  page: number;
}

export interface PaginationResult {
  breaks: PageBreak[];
  /** Total sheets, including any the tail element spills onto. */
  pageCount: number;
}

export interface PaginateOptions {
  /**
   * Height of content rendered after the editor but inside the page canvas —
   * the manuscript notes block. It is not a ProseMirror block, so the engine
   * cannot measure it as one, but it still has to fit on a sheet.
   */
  tailHeight?: number;
  /**
   * Hard ceiling on sheets. Past this the caller should fall back to a
   * continuous column rather than paint a thousand page frames.
   */
  maxPages?: number;
}

/** Resolve the page box from a layout, in CSS pixels. */
export function computePageGeometry(
  layout: LayoutSettings,
  rootPx: number = DEFAULT_ROOT_FONT_PX,
  gapRem: number = PAGE_GAP_REM,
): PageGeometry {
  const setup = resolvePageSetup(layout);
  const m = resolveMargins(layout);

  const marginTop = remToPx(m.top, rootPx);
  const marginBottom = remToPx(m.bottom, rootPx);
  const marginLeft = remToPx(m.left, rootPx);
  const marginRight = remToPx(m.right, rootPx);

  // In continuous mode there is no sheet, so the "page" is the text column
  // the writer chose and height is irrelevant. Callers check `pagination`
  // before using this, but returning something coherent keeps the type honest.
  const pageW =
    setup.pagination === "continuous"
      ? remToPx(DOC_WIDTH_REM[layout.width], rootPx) + marginLeft + marginRight
      : inToPx(setup.widthIn);
  const pageH = inToPx(setup.heightIn);

  // A writer can drag the margins until they meet. Never hand back a
  // non-positive content box: every downstream division would produce
  // Infinity and the engine would allocate pages until the tab died.
  const MIN_CONTENT = 1;
  return {
    pageH,
    pageW,
    gap: remToPx(gapRem, rootPx),
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    contentH: Math.max(MIN_CONTENT, pageH - marginTop - marginBottom),
    contentW: Math.max(MIN_CONTENT, pageW - marginLeft - marginRight),
  };
}

/**
 * Reconstruct the un-paginated vertical stack from per-block measurements.
 *
 * Returns the top edge of each block's border box, in CSS px, relative to the
 * top of the content area. Adjacent margins collapse — `max(mB[i], mT[i+1])`
 * rather than the sum — because that is what the browser does and the whole
 * point of computing this ourselves is to model the layout we are not reading.
 *
 * `forcedBreak` blocks are normalised to zero height and zero margins here, so
 * that a manual page break occupies no space on the page it opens.
 */
export function buildNaturalStack(metrics: readonly BlockMetric[]): number[] {
  const tops: number[] = new Array(metrics.length);
  let y = 0;
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const mt = m.forcedBreak ? 0 : m.marginTop;
    if (i === 0) {
      // The container has padding, so the first block's top margin does not
      // collapse through it — it applies as-is.
      y = mt;
    } else {
      const prev = metrics[i - 1];
      const prevMb = prev.forcedBreak ? 0 : prev.marginBottom;
      const prevH = prev.forcedBreak ? 0 : prev.height;
      // A margin against a page break is truncated, the way CSS truncates
      // margins at any fragmentation boundary. Without this the first
      // paragraph after a manual break floats its own margin-top below the
      // page's content top, and the break looks mis-aligned by a line.
      const collapsed = prev.forcedBreak ? 0 : Math.max(prevMb, mt);
      y = tops[i - 1] + prevH + collapsed;
    }
    tops[i] = y;
  }
  return tops;
}

/** Bottom edge of the last block's ink, relative to the content origin. */
function stackInkBottom(
  metrics: readonly BlockMetric[],
  tops: readonly number[],
  index: number,
): number {
  const m = metrics[index];
  return tops[index] + (m.forcedBreak ? 0 : m.height);
}

/**
 * Decide where the pages break and how tall each spacer must be.
 *
 * The contract, stated plainly because it is easy to lose: blocks break
 * **atomically**. A paragraph or a table is never split across a sheet. A
 * block taller than one page starts a fresh page and then bleeds through the
 * gap onto the sheets below. That is the fidelity ceiling of a decoration-based
 * engine, and it is the same ceiling every browser-based word processor has;
 * pretending otherwise would mean splitting `<tbody>` with a `<div>`, which
 * the HTML parser simply refuses to do.
 */
export function paginate(
  metrics: readonly BlockMetric[],
  geometry: PageGeometry,
  options: PaginateOptions = {},
): PaginationResult {
  const { tailHeight = 0, maxPages = Number.POSITIVE_INFINITY } = options;

  if (metrics.length === 0) {
    return { breaks: [], pageCount: 1 };
  }

  const tops = buildNaturalStack(metrics);
  const { contentH, pageH, gap } = geometry;
  const period = pageH + gap;

  const breaks: PageBreak[] = [];
  // Index of the first block on the page currently being filled, and that
  // page's 0-based number. `pageOf` trails `breaks` by one entry.
  let runStart = 0;
  let runPage = 0;

  const closeRun = (nextStart: number, forced: boolean) => {
    // How far the ink on this page actually reaches.
    const inkExtent = stackInkBottom(metrics, tops, nextStart - 1) - tops[runStart];
    // How far the *stack* advances before the next page's first block, which
    // includes the margin collapsing at the boundary. The grid is defined on
    // this, because it is what shifts the following blocks.
    const used = tops[nextStart] - tops[runStart];

    // How many sheets this run visually occupies. One, unless a single block
    // was taller than the page and overflowed. The loop rather than a bare
    // ceil() guarantees a strictly positive spacer even when the content
    // happens to land exactly on a sheet boundary; it terminates because each
    // pass adds a full `period`.
    let spanned = Math.max(1, Math.ceil(inkExtent / period));
    while (spanned * period - used < gap) spanned++;

    const height = spanned * period - used;
    breaks.push({
      blockIndex: nextStart,
      pos: metrics[nextStart].pos,
      height,
      forced,
      page: runPage + spanned,
    });
    runStart = nextStart;
    runPage += spanned;
  };

  for (let i = 1; i < metrics.length; i++) {
    if (runPage >= maxPages) break;

    const forced = metrics[i].forcedBreak === true;
    // Overflow test. Measured from the first block on this page to the ink
    // bottom of the candidate: if the candidate's ink clears the content box,
    // it belongs on the next sheet. `i > runStart` is guaranteed by the loop,
    // so the block that opens a page can never be pushed off it — which is
    // what stops an oversized block from looping forever.
    const overflows =
      stackInkBottom(metrics, tops, i) - tops[runStart] > contentH;

    if (!forced && !overflows) continue;

    let breakAt = i;
    if (!forced) {
      // keepWithNext: a heading must not be stranded as the last block on a
      // page. Walk the break backwards over any run of them. Stop at
      // `runStart + 1` — moving further would leave the page empty, so the
      // constraint is dropped rather than allowed to loop.
      while (breakAt > runStart + 1 && metrics[breakAt - 1].keepWithNext) {
        breakAt--;
      }
    }

    closeRun(breakAt, forced);

    // A backwards keepWithNext walk can leave `i` on the new page already;
    // re-test it there rather than skipping it.
    if (breakAt < i) i = breakAt;
  }

  // The final run, plus whatever the page canvas renders after the editor.
  const lastIndex = metrics.length - 1;
  const finalInk =
    stackInkBottom(metrics, tops, lastIndex) - tops[runStart] + tailHeight;
  const finalSpanned = Math.max(1, Math.ceil(finalInk / period));
  const pageCount = Math.min(runPage + finalSpanned, maxPages);

  return { breaks, pageCount };
}

/**
 * Whether two break lists are identical.
 *
 * The engine skips its dispatch when they are. With the fixed-point property
 * above this should never actually fire, which is exactly why it is worth
 * keeping: it is the cheap guard that makes an infinite measure/decorate loop
 * structurally impossible rather than merely unlikely.
 */
export function sameBreaks(
  a: readonly PageBreak[],
  b: readonly PageBreak[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].blockIndex !== b[i].blockIndex ||
      a[i].pos !== b[i].pos ||
      a[i].page !== b[i].page ||
      a[i].forced !== b[i].forced ||
      // A tolerance rather than a rounding: `Math.round` disagrees with
      // itself either side of a .5 boundary, which would report movement
      // for a fifth of a pixel of font-metric noise.
      Math.abs(a[i].height - b[i].height) >= SPACER_EPSILON_PX
    ) {
      return false;
    }
  }
  return true;
}

/** Sub-pixel spacer movement below this is font-metric noise, not a relayout. */
export const SPACER_EPSILON_PX = 0.5;
