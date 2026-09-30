import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project.
import { JSDOM } from "jsdom";
import {
  htmlToTypst,
  typstToHtml,
  reconcileTypstSource,
  TYPST_DOCUMENT_PREAMBLE,
} from "./document";

const previousParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
afterAll(() => {
  if (previousParser)
    Object.defineProperty(globalThis, "DOMParser", previousParser);
  else Reflect.deleteProperty(globalThis, "DOMParser");
});
beforeAll(() => {
  const dom = new JSDOM();
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });
});
const canonical = (html: string) =>
  new DOMParser().parseFromString(html, "text/html").body.innerHTML;

describe("Typst document source", () => {
  test("reconstructs rich structure and attributes from source", () => {
    const html =
      '<h2 style="text-align: center">Title</h2><p data-indent="2">A <strong>bold <em>word</em></strong> with <a href="https://example.com">a link</a>.<sup data-type="footnote" data-endnote-text="A note"></sup></p><table data-table-caption="Data"><tbody><tr><th colspan="2"><p>Head</p></th></tr><tr><td><p>One</p></td><td data-cell-background="#ff0000"><p>Two</p></td></tr></tbody></table><figure><img src="https://example.com/a.png" alt="A picture"><figcaption>A caption</figcaption></figure>';
    expect(canonical(typstToHtml(htmlToTypst(html)))).toBe(canonical(html));
  });
  test("actual edited body is authoritative", () => {
    const source = htmlToTypst("<p>Hello <strong>world</strong></p>");
    expect(
      typstToHtml(source.replace('#text("world")', '#text("universe")')),
    ).toBe("<p>Hello <strong>universe</strong></p>");
  });
  test("source helper arguments update math and diagram attributes", () => {
    const source = htmlToTypst(
      '<div data-type="block-math" data-latex="x^2">x^2</div><div data-type="mermaid-diagram" data-mermaid-source="graph TD; A-->B">graph TD; A--&gt;B</div>',
    );
    const updated = source
      .replace('#twyne-math("x^2",', '#twyne-math("x^3",')
      .replace(
        '#twyne-mermaid("graph TD; A-->B")',
        '#twyne-mermaid("graph TD; A-->C")',
      );
    const dom = new DOMParser().parseFromString(
      typstToHtml(updated),
      "text/html",
    );
    expect(dom.querySelector("[data-latex]")?.getAttribute("data-latex")).toBe(
      "x^3",
    );
    expect(
      dom
        .querySelector("[data-mermaid-source]")
        ?.getAttribute("data-mermaid-source"),
    ).toBe("graph TD; A-->C");
  });
  test("imports native prose, headings, lists and marks", () => {
    expect(
      typstToHtml("= Title\n\nHello *bold* and _italic_.\n\n- First\n- Second"),
    ).toBe(
      "<h1>Title</h1><p>Hello <strong>bold</strong> and <em>italic</em>.</p><ul><li><p>First</p></li><li><p>Second</p></li></ul>",
    );
  });
  test("unknown inline and block syntax survives rich edits verbatim", () => {
    const source =
      "// comment\n#let custom = [hello]\n\nA #custom beside $x^2$.\n\nLast";
    const html = typstToHtml(source);
    expect(reconcileTypstSource(source, html)).toBe(source);
    const updated = reconcileTypstSource(
      source,
      html.replace("<p>Last</p>", "<p>Edited</p>"),
    );
    expect(updated).toContain("// comment\n#let custom = [hello]");
    expect(updated).toContain("A #custom beside $x^2$.");
    expect(typstToHtml(updated)).toContain("Edited");
  });
  test("malformed wrappers survive without interpreting HTML or Javascript", () => {
    const source = '#twyne-node("p", "{}")[';
    const html = typstToHtml(source);
    expect(
      new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("[data-typst-source]")
        ?.getAttribute("data-typst-source"),
    ).toBe(source);
    expect(typstToHtml('#text("<script>alert(1)</script>")')).not.toContain(
      "<script>",
    );
  });
  test("changed preamble is preserved as authored source", () => {
    const source = htmlToTypst("<p>Text</p>").replace(
      "width: 100%",
      "width: 90%",
    );
    expect(reconcileTypstSource(source, typstToHtml(source))).toBe(source);
  });
  test("preserves escaped strings, unicode and nested delimiters", () => {
    const html =
      '<p>"Back\\slash" [bracket] {brace} #hash 💚 &lt;angle&gt;</p>';
    expect(canonical(typstToHtml(htmlToTypst(html)))).toBe(canonical(html));
    expect(htmlToTypst(html)).toStartWith(TYPST_DOCUMENT_PREAMBLE);
  });
  test("bounds input and depth", () => {
    expect(() => typstToHtml("x".repeat(5_000_001))).toThrow("5 MB");
    expect(() =>
      htmlToTypst("<div>".repeat(150) + "x" + "</div>".repeat(150)),
    ).toThrow("nesting");
  });
});

test("canonical source compiles rich content with the real Typst compiler", async () => {
  const { createTypstCompiler } = await import(
    "@myriaddreamin/typst.ts/compiler"
  );
  const { loadFonts } = await import("@myriaddreamin/typst.ts/options.init");
  const { readFile } = await import("node:fs/promises");
  const compiler = createTypstCompiler();
  const font = await readFile(
    new URL("../../assets/typst/LibertinusSerif-Regular.otf", import.meta.url),
  );
  await compiler.init({
    getModule: () =>
      readFile(
        new URL(
          "../../../node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm",
          import.meta.url,
        ),
      ),
    beforeBuild: [loadFonts([font], { assets: false })],
  });
  compiler.addSource(
    "/main.typ",
    htmlToTypst(
      '<h1>Title</h1><p>A <strong>bold</strong> thought with a <sup data-type="footnote" data-endnote-text="Citation"></sup>.</p><ul><li><p>One</p></li><li><p>Two</p></li></ul><ol><li><p>First</p></li><li><p>Second</p></li></ol><table><tbody><tr><th colspan="2"><p>Title</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>',
    ),
  );
  await compiler.runWithWorld(
    { mainFilePath: "/main.typ", inputs: {} },
    async (world) => {
      const result = await world.pdf({ diagnostics: "full" });
      expect(
        result.diagnostics?.filter((d) => d.severity === "error") ?? [],
      ).toEqual([]);
      expect(result.result).toBeDefined();
    },
  );
}, 30000);
