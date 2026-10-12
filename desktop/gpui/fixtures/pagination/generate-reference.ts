/** Runs the existing arithmetic unchanged. No browser or manuscript access. */
import { writeFile } from "node:fs/promises";
import {
  buildNaturalStack,
  computePageGeometry,
  paginate,
  sameBreaks,
  type BlockMetric,
  type PageGeometry,
  type PaginateOptions,
} from "../../../../src/components/editor/pagination-geometry";
import { DEFAULT_LAYOUT, type LayoutSettings } from "../../../../src/types";

const geometry: PageGeometry = {
  pageH: 1000, pageW: 800, gap: 20,
  marginTop: 100, marginBottom: 100, marginLeft: 100, marginRight: 100,
  contentH: 800, contentW: 600,
};
const block = (height: number, extra: Partial<BlockMetric> = {}): BlockMetric => ({
  pos: 0, height, marginTop: 0, marginBottom: 0, ...extra,
});
const pageBreak = (extra: Partial<BlockMetric> = {}) =>
  block(0, { forcedBreak: true, ...extra });

const cases: Array<{
  name: string; metrics: BlockMetric[]; geometry: PageGeometry;
  options: PaginateOptions; naturalTops: number[];
  result: ReturnType<typeof paginate>; renderedTops: number[];
}> = [];
function observe(
  name: string, metrics: BlockMetric[], options: PaginateOptions = {},
  page: PageGeometry = geometry,
) {
  let position = 0;
  metrics = metrics.map(metric => {
    const next = { ...metric, pos: position };
    position += metric.forcedBreak ? 1 : 3;
    return next;
  });
  const naturalTops = buildNaturalStack(metrics);
  const result = paginate(metrics, page, options);
  const renderedTops = naturalTops.map((top, index) =>
    top + result.breaks.filter(b => b.blockIndex <= index).reduce((sum, b) => sum + b.height, 0));
  if (!sameBreaks(result.breaks, paginate(metrics, page, options).breaks)) {
    throw new Error(`Unstable original output: ${name}`);
  }
  for (const b of result.breaks) {
    if (!(b.height > 0)) throw new Error(`Nonpositive fixture spacer: ${name}`);
  }
  cases.push({ name, metrics, geometry: page, options, naturalTops, result, renderedTops });
}

observe("empty", []);
observe("empty-tail-is-ignored-by-source", [], { tailHeight: 4000 });
observe("one-empty-paragraph", [block(0)]);
observe("one-sheet", [block(300), block(300)]);
observe("exact-fit", [block(800), block(800)]);
observe("one-pixel-overflow", [block(800), block(1)]);
observe("many-small", Array.from({ length: 20 }, () => block(100)));
observe("collapsed-margins", [block(100, { marginBottom: 13.6 }), block(50, { marginTop: 35.2 })]);
observe("first-margin-applies", [block(100, { marginTop: 48 }), block(750)]);
observe("fractional-native-inputs", [block(44, { marginTop: 48, marginBottom: 18 }), block(32.4, { marginBottom: 8.1 }), block(729.61)]);
observe("forced-margins-truncated", [block(100, { marginBottom: 20 }), pageBreak({ height: 80, marginTop: 90, marginBottom: 90 }), block(100, { marginTop: 20 })]);
observe("manual-mid-page", [block(100), pageBreak(), block(100)]);
observe("consecutive-manual", [block(100), pageBreak(), pageBreak(), block(100)]);
observe("leading-break", [pageBreak(), block(100)]);
observe("only-break", [pageBreak()]);
observe("trailing-break", [block(100), pageBreak()]);
observe("leading-consecutive-breaks", [pageBreak(), pageBreak(), block(100)]);
observe("oversized-opener", [block(2500), block(100)]);
observe("oversized-exact-period", [block(3060), block(100)]);
observe("oversized-in-place", [block(200), block(5000), block(200)]);
observe("heading-before-oversized", [block(700), block(50, { keepWithNext: true }), block(2000), block(100)]);
observe("consecutive-oversized", [block(2000), block(2000), block(2000)]);
observe("heading-kept", [block(700), block(50, { keepWithNext: true }), block(100)]);
observe("heading-chain", [block(600), block(50, { keepWithNext: true }), block(50, { keepWithNext: true }), block(200)]);
observe("keep-never-empties-page", [block(700, { keepWithNext: true }), block(200)]);
observe("backward-walk-retests", [block(700), block(50, { keepWithNext: true }), block(780), block(100)]);
observe("zero-height", Array.from({ length: 200 }, () => block(0)));
observe("max-pages", Array.from({ length: 500 }, () => block(400)), { maxPages: 10 });
observe("tight-content", Array.from({ length: 50 }, () => block(100)), {}, { ...geometry, contentH: 1 });
observe("tail-spill", [block(700)], { tailHeight: 1500 });
observe("tail-fit", [block(100)], { tailHeight: 200 });
observe("terminal-break-with-tail", [block(100), pageBreak()], { tailHeight: 1100 });
observe("negative-margin-source-max", [block(100, { marginBottom: -8 }), block(700, { marginTop: -12 }), block(100)]);
observe("large-margin-still-positive", [block(100, { marginBottom: 2500 }), block(100)]);

// Deterministic measured inputs test the arithmetic, not prose-height guesses.
let seed = 0x71a9;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
for (let caseIndex = 0; caseIndex < 64; caseIndex++) {
  observe(`measured-seed-${caseIndex}`, Array.from({ length: 5 + Math.floor(random() * 24) }, () =>
    random() < 0.12 ? pageBreak() : block(
      Math.round(random() * 2600) / 2,
      { marginTop: Math.round(random() * 96) / 2, marginBottom: Math.round(random() * 64) / 2, keepWithNext: random() < 0.25 },
    )), { tailHeight: Math.floor(random() * 800), maxPages: 100 });
}

const layouts: Array<[string, LayoutSettings, number, number]> = [
  ["letter-default", { ...DEFAULT_LAYOUT, pagination: "paginated" }, 16, 1.5],
  ["a4-landscape", { ...DEFAULT_LAYOUT, pagination: "paginated", paper: "a4", orientation: "landscape" }, 16, 1.5],
  ["legal-portrait", { ...DEFAULT_LAYOUT, pagination: "paginated", paper: "legal" }, 16, 1.5],
  ["legacy-unset-continuous", { width: "normal", margin: "normal", runningHeader: false, pageNumbers: true }, 16, 1.5],
  ["wide-continuous", { ...DEFAULT_LAYOUT, pagination: "continuous", width: "wide" }, 16, 1.5],
  ["narrow-root20", { ...DEFAULT_LAYOUT, pagination: "continuous", width: "narrow" }, 20, 2],
  ["independent-margins", { ...DEFAULT_LAYOUT, pagination: "paginated", marginLeft: 2.25, marginRight: 3.5, marginTop: 1.75, marginBottom: 4.25 }, 16, 1.5],
  ["margins-meet", { ...DEFAULT_LAYOUT, pagination: "paginated", marginTop: 40, marginBottom: 40, marginLeft: 40, marginRight: 40 }, 16, 1.5],
];
const geometries = layouts.map(([name, layout, rootPx, gapRem]) => ({
  name, layout, rootPx, gapRem, geometry: computePageGeometry(layout, rootPx, gapRem),
}));
const output = {
  authority: "src/components/editor/pagination-geometry.ts (executed unchanged)",
  semantics: "Top-level blocks are atomic; no paragraph-line splitting. Spacers are presentation only.",
  cases, geometries,
};
await writeFile(new URL("./source-geometry.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ cases: cases.length, geometries: geometries.length, output: "source-geometry.json" }));
