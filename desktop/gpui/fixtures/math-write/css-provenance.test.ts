import { expect, test } from "bun:test";
import { mathCssConsumers } from "../../tools/math-css-provenance";
import original from "../../../../src/components/editor/math/katex.min.css" with { type: "text" };
import candidate from "./mermaid/scoped-vendor-candidate.css" with { type: "text" };

test("mixed vendor styles identify equation and preview separately from global Mermaid", () => {
  expect(mathCssConsumers(original)).toEqual({ globalMermaid: "0.16.47", equation: "0.16.47", sourcePreview: "0.16.47" });
  expect(mathCssConsumers(candidate)).toEqual({ globalMermaid: "0.16.47", equation: "0.18.1", sourcePreview: "0.18.1" });
});

test("an equation-only overlay cannot certify the sibling source preview", () => {
  const overlay = '.twyne-math .katex .katex-version:after {content:"0.18.1"}';
  expect(mathCssConsumers(original + overlay)).toEqual({ globalMermaid: "0.16.47", equation: "0.18.1", sourcePreview: "0.16.47" });
});

test("CSS declaration importance and specificity beat unrelated marker order", () => {
  expect(mathCssConsumers(candidate + '.katex .katex-version:after {content:"1.2.3"}'))
    .toEqual({ globalMermaid: "1.2.3", equation: "0.18.1", sourcePreview: "0.18.1" });
  expect(mathCssConsumers(candidate + '.katex .katex-version:after {content:"1.2.3" !important}'))
    .toEqual({ globalMermaid: "1.2.3", equation: "1.2.3", sourcePreview: "1.2.3" });
});

test("missing, invalid or conditional supported markers remain unresolved", () => {
  expect(mathCssConsumers("")).toEqual({ globalMermaid: "unknown", equation: "unknown", sourcePreview: "unknown" });
  expect(mathCssConsumers('.katex .katex-version:after {content:var(--version)}').equation).toBe("unknown");
  expect(mathCssConsumers(candidate + '@media print {.twyne-math .katex .katex-version:after {content:"1.2.3"}}').equation).toBe("unknown");
});
