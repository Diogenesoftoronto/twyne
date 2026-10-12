// Reuse the frozen fixture assembly. It imports the actual Source NodeViews;
// no editor, source form, transaction or renderer behavior is copied here.
import "../nodeview/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MathExtensions } from "../../../../../src/components/editor/extensions/math";

// Additional assembly exercises the same original NodeViews at more than one
// inherited size; no Source math rendering or editing logic is duplicated.
const additional = [
  {
    id: "inline-matrix",
    source: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    fontSizePx: 18,
  },
  {
    id: "ascii-text",
    source: String.raw`\text{a small equation}\quad\alpha`,
    fontSizePx: 18,
  },
  { id: "small-fraction", source: String.raw`\frac{a+b}{c-d}`, fontSizePx: 12 },
  { id: "large-scripts", source: String.raw`u^{n+1}_{i}`, fontSizePx: 32 },
  {
    id: "nested-fraction",
    source: String.raw`\frac{\frac{a}{b}+x^2}{\sqrt{1+y}}`,
    fontSizePx: 18,
  },
  {
    id: "delimited-fraction",
    source: String.raw`\left(\frac{a+b}{c+d}\right)`,
    fontSizePx: 18,
  },
  {
    id: "unicode-math",
    source: String.raw`\text{A}\quad\alpha+\beta+\Gamma`,
    fontSizePx: 18,
  },
];
const editors = new Map<string, Editor>();
for (const row of additional) {
  const section = document.createElement("section");
  section.dataset.case = row.id;
  section.className = "fixture-case";
  const heading = document.createElement("h2");
  heading.className = "fixture-caption";
  heading.textContent = `${row.id} / inline / ${row.fontSizePx}px`;
  const target = document.createElement("div");
  target.className = "twyne-editor";
  section.append(heading, target);
  document.querySelector("#cases")!.append(section);
  editors.set(
    row.id,
    new Editor({
      element: target,
      extensions: [StarterKit, ...MathExtensions],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Before " },
              { type: "inlineMath", attrs: { source: row.source } },
              { type: "text", text: " after." },
            ],
          },
        ],
      },
      editorProps: {
        attributes: {
          class: "ProseMirror",
          style: `font-size:${row.fontSizePx}px;line-height:1.8`,
        },
      },
    }),
  );
}

const context = new OffscreenCanvas(1, 1).getContext("2d")!;
// Pure font measurement API, not DOM/style evaluation. The CDP observer passes
// the actual selected leaf's font/size/text after Source fonts have settled.
(globalThis as any).currentCssFixture = {
  data: () =>
    additional.map((row) => ({
      ...row,
      display: "inline",
      html: editors.get(row.id)!.getHTML(),
      json: editors.get(row.id)!.getJSON(),
    })),
  measure(font: string, text: string) {
    context.font = font;
    const metrics = context.measureText(text);
    return {
      font: context.font,
      width: metrics.width,
      fontAscent: metrics.fontBoundingBoxAscent,
      fontDescent: metrics.fontBoundingBoxDescent,
      inkAscent: metrics.actualBoundingBoxAscent,
      inkDescent: metrics.actualBoundingBoxDescent,
      inkLeft: metrics.actualBoundingBoxLeft,
      inkRight: metrics.actualBoundingBoxRight,
    };
  },
};
