import type { MathWriteOutput } from "../../../tools/math-write";

/** Expected positions come from retained CDP boxes plus the browser's selected
 * font metrics. Nothing here calculates a fraction, script or matrix layout. */
export function compareGlyphs(row: any, output: MathWriteOutput) {
  if (!output.vector || !output.cssGeometry)
    return { id: row.id, refused: output.issues, glyphRuns: [] };
  const vector = output.vector,
    base = row.nodes[".katex-base"],
    rootBaseline = base.box.y + base.fontMetrics.fontAscent;
  let at = 0;
  const glyphRuns = row.glyphs.map((leaf: any) => {
    const text = leaf.text.replace(/\u200b/g, ""),
      chars = [...text],
      actual = vector.glyphs.slice(at, at + chars.length);
    at += chars.length;
    const expected = {
      text,
      x: leaf.box.x - base.box.x,
      baseline: leaf.box.y + leaf.fontMetrics.fontAscent - rootBaseline,
      font: leaf.fonts.fonts[0].postScriptName.replace(/^KaTeX_/, ""),
      cssFontSize: Number.parseFloat(leaf.styles["font-size"]),
      advance: leaf.fontMetrics.width,
      occupiedWidth: leaf.box.width,
    };
    return {
      expected,
      actual: {
        text: actual.map((g) => g.text).join(""),
        x: actual[0]?.x,
        baseline: actual[0]?.baseline,
        font: actual[0]?.font,
        fontSize: actual[0]?.fontSize,
        advance: actual.reduce((sum, g) => sum + g.advance, 0),
      },
      maxInternalBaselineError: Math.max(
        0,
        ...actual.map((g) => Math.abs(g.baseline - expected.baseline)),
      ),
      xError: (actual[0]?.x ?? NaN) - expected.x,
      baselineError: (actual[0]?.baseline ?? NaN) - expected.baseline,
      advanceError:
        actual.reduce((sum, g) => sum + g.advance, 0) - expected.advance,
    };
  });
  if (at !== vector.glyphs.length)
    throw new Error(`Unmatched native glyphs: ${row.id}`);
  return {
    id: row.id,
    widthError: vector.widthPx - row.nodes[".katex-html"].box.width,
    ascentError: vector.ascentPx - base.fontMetrics.fontAscent,
    descentError: vector.descentPx - base.fontMetrics.fontDescent,
    spanHeightError: vector.heightPx - base.box.height,
    glyphRuns,
  };
}
