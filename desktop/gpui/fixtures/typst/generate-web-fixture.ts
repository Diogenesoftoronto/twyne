// Run from the repository root: bun desktop/gpui/fixtures/typst/generate-web-fixture.ts
// The page setup and rich opening paragraph come from the actual web serializer.
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import { serializeTypst } from "../../../../src/utils/typst/serialize";
import { DEFAULT_LAYOUT } from "../../../../src/types";

const dom = new JSDOM("", { url: "https://twyne.test/" });
Object.defineProperty(globalThis, "DOMParser", {
  configurable: true,
  value: dom.window.DOMParser,
});

const html = `<h1>Native proof parity</h1>
<p>At the edge of the writing desk, <strong>the manuscript keeps its own voice</strong>. Every letter belongs to the author; every ornament belongs to the page. An <em>illuminated opening</em> sits beside the first lines without swallowing their words, and a <a href="https://twyne.app/">quiet link</a> remains part of the sentence. The long opening makes the rich-text wrap observable: lines leave the artwork behind and continue across the full measure. The proof is a record of the same source, with bold, italic, and ordinary text sharing one paragraph.</p>
<p>Local writing continues without a browser, a font download, or a publishing service. The original Lora face carries these paragraphs; Libre Baskerville carries the heading. The running footer counts the physical sheets. Saved source can be reopened, compiled, and exported on the same machine.</p>
<h2>Evidence on the page</h2>
<blockquote><p>A proof should show what the compiler made, including the places where a manuscript asks for something unavailable.</p></blockquote>
<ul><li>The first paragraph wraps beside its original artwork.</li><li>Rich text survives the serializer and the native compiler.</li><li>Images and mathematics share the same paged document.</li></ul>
<table><thead><tr><th>Surface</th><th>Evidence</th></tr></thead><tbody><tr><td>Proof</td><td>Paged SVG</td></tr><tr><td>Export</td><td>Searchable PDF</td></tr></tbody></table>`;

const document = serializeTypst({
  title: "Native proof parity",
  html,
  layout: {
    ...DEFAULT_LAYOUT,
    pageBorder: "illuminated",
    openingInitial: {
      mode: "illuminated",
      collection: "botanical",
      size: "medium",
    },
  },
});

// These are literal Typst features, not a substitute HTML projection or
// browser-only MathJax helper. They intentionally exercise the Rust compiler.
const source =
  document.source +
  `
#pagebreak()
= Mathematics and original artwork

The exact compiler renders a native equation with Libertinus Math:

$ integral_0^1 x^2 dif x = 1/3 quad "and" quad sum_(k=1)^n k = (n(n+1))/2 $

#align(center)[#image("/assets/griffin-mark.svg", width: 72pt, alt: "Original Twyne griffin")]

#text(font: "DM Sans")[DM Sans: labels remain legible.]

#text(font: "Special Elite")[Special Elite: department labels.]

#text(font: "Fraunces")[Fraunces: original variable display face.]

#raw("let source = canonical;", block: true)
`;

await Bun.write(new URL("web-editorial.typ", import.meta.url), source);
await Bun.write(
  new URL("web-editorial.provenance.json", import.meta.url),
  JSON.stringify(
    {
      serializer: "src/utils/typst/serialize.ts",
      pageSetup: "src/utils/typst/theme.ts",
      assets: document.assets,
      additionalFeatures: [
        "native Typst math",
        "original griffin SVG",
        "original font samples",
      ],
    },
    null,
    2,
  ) + "\n",
);
dom.window.close();
