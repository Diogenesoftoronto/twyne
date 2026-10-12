import fs from "node:fs";
import path from "node:path";
const own = import.meta.dir;
const read = (file: string): any => JSON.parse(fs.readFileSync(path.join(own, file), "utf8"));
const value = (row: any, suffix: string) => row.geometry.find((item: any) => item.selector.endsWith(suffix));
const projection = (item: any) => ({ box: item.box, fontSize: item.styles?.["font-size"], lineHeight: item.styles?.["line-height"], display: item.styles?.display, faces: item.fonts?.fonts });
const rows = [];
for (const profile of ["original", "candidate"]) for (const width of [1280, 620]) {
  const suffix = width === 1280 ? "" : `-${width}`;
  const nodes = read(`${profile}-nodes${suffix}.json`);
  const previews = read(`${profile}-previews${suffix}.json`);
  for (const row of nodes.rows) {
    const preview = previews.rows.find((item: any) => item.id === row.id);
    rows.push({ profile, width, id: row.id, source: row.source, display: row.display,
      node: projection(value(row, " .twyne-math")),
      strut: projection(value(row, " .katex-strut")),
      sizing: projection(value(row, " .katex-sizing")),
      formulaFont: projection(value(row, " .mord.mathnormal")),
      prose: projection(value(row, " .ProseMirror")),
      form: projection(value(preview, " .twyne-math-source-editor")),
      preview: projection(value(preview, " .twyne-math-source-preview-output")),
      previewStrut: projection(value(preview, " .twyne-math-source-preview .katex-strut")),
      previewSizing: projection(value(preview, " .twyne-math-source-preview .katex-sizing")),
    });
  }
}
fs.writeFileSync(path.join(own, "measurements.json"), JSON.stringify({
  evidence: "Projection of retained actual inspect/CDP records. Node rectangles are Source NodeView/line boxes, not a standalone TeX advance/ink baseline. Empty/invalid previews intentionally have no KaTeX box.", rows,
}, null, 2) + "\n");
console.log({ nodeObservations: rows.length, sourcePreviews: rows.length });
