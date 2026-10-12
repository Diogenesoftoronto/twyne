/** Pure, unmounted adoption arithmetic. This does not render KaTeX, validate
 * helper SVG, implement Source inline-flex flow, or authorize product images. */
export const SOURCE_CSS_SHA256 =
  "1d0be692cde606a132f39e5150d8c81d83649ab0e6825329e93c2a6dcffcbe0d";

export interface DiagnosticSpan {
  advance: number;
  ascent: number;
  descent: number;
  paintWidth: number;
  paintHeight: number;
  paintOffsetX: number;
  paintOffsetY: number;
  paintBaseline: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagnosticPlacement {
  logical: Rect;
  paint: Rect;
  baseline: number;
}

/** Input is an already validated MathWriteOutput. The narrow guard keeps this
 * fixture from silently treating an engine diagnostic as current Source. */
export function diagnosticSpan(output: any): DiagnosticSpan | null {
  if (
    output.profile !== "currentSourceCssDiagnostic" ||
    output.fidelity !== "currentSourceCssDerivedDiagnostic" ||
    output.display !== "inline" ||
    output.sourceCssSha256 !== SOURCE_CSS_SHA256 ||
    output.cssGeometry?.scope !== "katexBaseInlineSpan" ||
    output.cssGeometry?.layoutModel !== "blink150Linux64ths" ||
    output.originalError !== null ||
    output.issues.length !== 0 ||
    !output.vector
  )
    return null;
  const v = output.vector;
  return {
    advance: v.widthPx,
    ascent: v.ascentPx,
    descent: v.descentPx,
    paintWidth: v.paintWidthPx,
    paintHeight: v.paintHeightPx,
    paintOffsetX: v.paintOffsetXPx,
    paintOffsetY: v.paintOffsetYPx,
    paintBaseline: v.paintBaselinePx,
  };
}

/** originX is the natural span's left; baseline is its KaTeX font baseline.
 * Neither is the outer NodeView's origin. Paint never changes the advance. */
export function placeSpan(
  span: DiagnosticSpan,
  originX: number,
  baseline: number,
): DiagnosticPlacement {
  const values = [...Object.values(span), originX, baseline];
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error("Non-finite diagnostic geometry");
  if (
    span.advance <= 0 ||
    span.ascent < 0 ||
    span.descent < 0 ||
    span.ascent + span.descent <= 0 ||
    span.paintWidth <= 0 ||
    span.paintHeight <= 0 ||
    span.paintOffsetX > 0 ||
    span.paintOffsetY > 0 ||
    Math.abs(span.paintBaseline + span.paintOffsetY - span.ascent) > 0.001
  )
    throw new Error("Incoherent diagnostic geometry");
  const logical = {
    x: originX,
    y: baseline - span.ascent,
    width: span.advance,
    height: span.ascent + span.descent,
  };
  const paint = {
    x: logical.x + span.paintOffsetX,
    y: logical.y + span.paintOffsetY,
    width: span.paintWidth,
    height: span.paintHeight,
  };
  if ([...Object.values(logical), ...Object.values(paint)].some((v) => !Number.isFinite(v)))
    throw new Error("Diagnostic placement overflow");
  return { logical, paint, baseline };
}

export function atomEdge(span: DiagnosticSpan, scalarOffset: 0 | 1): number {
  return scalarOffset === 0 ? 0 : span.advance;
}

/** Supplied accepted wrapper metrics are a future producer's responsibility.
 * This fixture demonstrates row aggregation only, not how Source obtains them. */
export function rowExtents(
  boxes: ReadonlyArray<{ above: number; below: number }>,
): { above: number; below: number; height: number } {
  if (boxes.some((box) => [box.above, box.below].some((v) => !Number.isFinite(v) || v < 0)))
    throw new Error("Invalid supplied row box");
  const above = Math.max(0, ...boxes.map((box) => box.above));
  const below = Math.max(0, ...boxes.map((box) => box.below));
  return { above, below, height: above + below };
}

export interface CompletionToken {
  owner: string;
  rendererEpoch: number;
  requestId: string;
  generation: number;
  expectedNode: string;
  scalar: number;
  payloadKey: string;
}

/** The expected node is a model identity token, not serialized manuscript. */
export function completionMatches(a: CompletionToken, b: CompletionToken): boolean {
  return a.owner === b.owner &&
    a.rendererEpoch === b.rendererEpoch &&
    a.requestId === b.requestId &&
    a.generation === b.generation &&
    a.expectedNode === b.expectedNode &&
    a.scalar === b.scalar &&
    a.payloadKey === b.payloadKey;
}

/** Raster policy is separate from geometry reuse. No platform is approved by
 * this model. The stamp includes DPR even when the logical bounds are equal. */
export interface RasterIdentity {
  vectorDigest: string;
  rendererPolicy: string;
  dpr: number;
  deviceWidth: number;
  deviceHeight: number;
}

export function rasterKey(stamp: RasterIdentity): string {
  if (!Number.isFinite(stamp.dpr) || stamp.dpr <= 0 ||
      !Number.isSafeInteger(stamp.deviceWidth) || stamp.deviceWidth <= 0 ||
      !Number.isSafeInteger(stamp.deviceHeight) || stamp.deviceHeight <= 0)
    throw new Error("Invalid raster identity");
  return JSON.stringify(stamp);
}

/** Deliberately closed: even accepted diagnostics lack wrapper/paragraph and
 * native raster admission. Product Source Write acceptance requires a new
 * explicit reviewed policy, not changing this function to return true. */
export function productWriteAdmitted(_output: unknown): false {
  return false;
}
