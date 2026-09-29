import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import {
  createTypstCompiler,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts/compiler";
import { loadFonts } from "@myriaddreamin/typst.ts/options.init";
import { serializeTypst, typstString } from "./serialize";
import { DEFAULT_LAYOUT } from "../../types";
import { exportTypst } from "./export";
import { prepareTypstAssets } from "./render-assets";
import { createTypstRenderer } from "@myriaddreamin/typst.ts/renderer";
import { splitProofPages } from "./client";
import { htmlToTypst } from "./document";

const dom = new JSDOM("", { url: "https://twyne.test/" });
const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
let compiler: TypstCompiler;

beforeAll(async () => {
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });
  compiler = createTypstCompiler();
  const fonts = await Promise.all(
    [
      "LibertinusSerif-Regular.otf",
      "LibertinusSerif-Bold.otf",
      "LibertinusSerif-Italic.otf",
      "LibertinusSerif-BoldItalic.otf",
      "DejaVuSansMono.ttf",
    ].map((name) =>
      readFile(new URL(`../../assets/typst/${name}`, import.meta.url)),
    ),
  );
  await compiler.init({
    getModule: () =>
      readFile(
        new URL(
          "../../../node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm",
          import.meta.url,
        ),
      ),
    beforeBuild: [loadFonts(fonts, { assets: false })],
  });
}, 30000);

afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
  else Reflect.deleteProperty(globalThis, "DOMParser");
  dom.window.close();
});

async function compile(source: string) {
  compiler.addSource(
    "/main.typ",
    "#show text: it => { metadata(it.text); it }\n" + source,
  );
  return compiler.runWithWorld(
    { mainFilePath: "/main.typ", inputs: {} },
    async (world) => {
      const result = await world.pdf({ diagnostics: "full" });
      expect(
        result.diagnostics?.filter((d) => d.severity === "error") ?? [],
      ).toEqual([]);
      expect(result.result).toBeDefined();
      expect(new TextDecoder().decode(result.result!.slice(0, 5))).toBe(
        "%PDF-",
      );
      return world.query<string[]>({ selector: "metadata", field: "value" });
    },
  );
}

describe("Typst serializer with the real bundled compiler", () => {
  test("keeps markup-like manuscript text literal instead of executing it", async () => {
    const malicious =
      '#panic("manuscript executed") [brackets] \\ slash $math$ @reference';
    const el = dom.window.document.createElement("p");
    el.textContent = malicious;
    const { source } = serializeTypst({
      title: "Literal manuscript",
      html: el.outerHTML,
    });
    expect((await compile(source)).join("")).toContain(malicious);
  });

  test("escapes control characters using syntax accepted by Typst", async () => {
    const value = 'Quotes " backslash \\ tabs\tnewlines\nreturn\rcontrol\u0001';
    await compile(
      `#set text(font: "Libertinus Serif")\n#text(${typstString(value)})`,
    );
  });

  test("compiles rich prose, lists, colors, code, notes, and custom page setup", async () => {
    const { source } = serializeTypst({
      title: "Typeset manuscript",
      header: "Running head",
      footer: "Private draft",
      layout: {
        ...DEFAULT_LAYOUT,
        paper: "a4",
        orientation: "landscape",
        marginLeft: 3,
        marginRight: 4,
      },
      html: `
      <h1>Typeset manuscript</h1>
      <p data-indent="2" data-space-before="6" data-space-after="12" data-keep-with-next="true" style="text-align:justify;line-height:1.6">Plain <strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <sup>super</sup><sub>sub</sub> <mark style="background-color:#ffee88">highlight</mark> <span style="color:rgb(10,20,30);font-size:18px">color</span> <a href="https://example.com/?a=1&amp;b=2">link</a><br>Next line.</p>
      <blockquote><p>A quotation.</p></blockquote>
      <ol start="3"><li><p>Numbered item</p><ul><li><p>Nested bullet</p></li></ul></li></ol>
      <ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>Finished task</p></div></li></ul>
      <pre><code>let x = 1;\nprint(x)</code></pre><hr>
      <p>Notes<sup data-type="footnote" data-endnote-text="A page footnote."></sup><sup data-type="endnote" data-endnote-text="An endnote."></sup></p>
      <div data-type="page-break"></div><p>After the break.</p>`,
    });
    const rendered = (await compile(source)).join("");
    for (const value of [
      "Numbered item",
      "Nested bullet",
      "Finished task",
      "A page footnote.",
      "An endnote.",
      "After the break.",
    ])
      expect(rendered).toContain(value);
    expect(source).toContain("left: 36pt");
    expect(source).toContain("right: 48pt");
    expect(rendered.match(/Typeset manuscript/g)).toHaveLength(1);
  });

  test("merged table cells retain content and compile without overlap", async () => {
    const { source } = serializeTypst({
      title: "Table",
      html: '<table><caption>Results</caption><tbody><tr><th rowspan="2">Group</th><th colspan="2">Measures</th></tr><tr><td style="background-color:#eeeeee">First</td><td>Second</td></tr><tr><td>Control</td><td>10</td><td>20</td></tr></tbody></table>',
    });
    const rendered = (await compile(source)).join("");
    for (const value of [
      "Group",
      "Measures",
      "First",
      "Second",
      "Control",
      "Results",
    ])
      expect(rendered).toContain(value);
  });

  test("private annotations do not leak and equation sources are retained", () => {
    const { source } = serializeTypst({
      title: "Draft",
      html: '<p><span data-comment="PRIVATE" data-replacement="SECRET">Original prose</span></p>',
    });
    expect(source).toContain("Original prose");
    expect(source).not.toContain("PRIVATE");
    expect(source).not.toContain("SECRET");
    expect(
      serializeTypst({
        title: "Math",
        html: '<span data-type="inline-math" data-latex="x^2"></span>',
      }).source,
    ).toContain('#twyne-math("x^2", block: false)');
  });

  test("LaTeX fractions render locally into SVG accepted by the real compiler", async () => {
    const doc = serializeTypst({
      title: "Equation",
      html: '<p>Inline <span data-type="inline-math" data-latex="\\frac{a}{b}"></span></p><div data-type="block-math" data-latex="x^2 + y^2 = z^2"></div>',
    });
    const source = await prepareTypstAssets(doc.source);
    expect(source).not.toContain("#twyne-math(");
    expect(source).toContain('format: "svg"');
    await compile(source);
  });

  test("canonical rich source compiles to separately paginated SVG proofs", async () => {
    const source = htmlToTypst(
      '<h1>Proof</h1><p>A <strong>bold</strong> sentence.</p><ol><li><p>First</p></li><li><p>Second</p></li></ol><table><tbody><tr><th>A</th><th>B</th></tr><tr><td>One</td><td>Two</td></tr></tbody></table><div data-type="page-break"></div><p>Page two.</p>',
    );
    await compile(source);
    const vector = await compiler.runWithWorld(
      { mainFilePath: "/main.typ", inputs: {} },
      (world) => world.vector({ diagnostics: "full" }),
    );
    expect(vector.result).toBeDefined();
    const renderer = createTypstRenderer();
    await renderer.init({
      getModule: () =>
        readFile(
          new URL(
            "../../../node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm",
            import.meta.url,
          ),
        ),
    });
    await renderer.runWithSession(
      { format: "vector", artifactContent: vector.result! },
      async (session) => {
        const sizes = session.retrievePagesInfo();
        const pages = splitProofPages(
          await session.renderSvg({
            data_selection: { body: true, defs: true, css: true, js: false },
          }),
          sizes,
        );
        expect(pages).toHaveLength(2);
        for (const page of pages) {
          const document = new dom.window.DOMParser().parseFromString(
            page,
            "image/svg+xml",
          );
          expect(document.querySelectorAll(".typst-page")).toHaveLength(1);
          expect(
            document.querySelector(".typst-page")?.hasAttribute("transform"),
          ).toBe(false);
          expect(document.querySelector("parsererror")).toBeNull();
        }
      },
    );
  });

  test("canonical tables retain column widths and image figures apply their crop ratio", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: dom.window,
    });
    try {
      const image =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>',
        );
      const source = htmlToTypst(
        `<table><tr><td colwidth="120">Narrow</td><td colwidth="240">Wide</td></tr></table><figure data-image-width="25" data-image-aspect-ratio="1"><img src="${image}" alt="Cropped"><figcaption>Caption</figcaption></figure>`,
      );
      expect(source).toContain("120,240");
      await compile(await prepareTypstAssets(source));
    } finally {
      if (previousWindow)
        Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("canonical endnotes render after body while footnotes and task state remain distinct", async () => {
    const source = htmlToTypst(
      '<p>Body <sup data-type="endnote" data-endnote-text="Endnote one"></sup> more <sup data-type="endnote" data-endnote-text="Endnote two"></sup> and <sup data-type="footnote" data-endnote-text="Footnote text"></sup>.</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Completed</p></li><li data-type="taskItem" data-checked="false"><p>Pending</p></li></ul>',
    );
    const text = (await compile(source)).join("");
    expect(text).toContain("Endnote one");
    expect(text).toContain("Endnote two");
    expect(text.indexOf("Endnote one")).toBeGreaterThan(
      text.indexOf("Pending"),
    );
    expect(text).toContain("Footnote text");
    expect(text).toContain("[x]");
    expect(text).toContain("[ ]");
  });

  test("repeated images share an asset and retain captions and alternative text", () => {
    const { source, assets } = serializeTypst({
      title: "Images",
      html: '<figure data-type="image" data-image-width="50"><img src="https://example.com/image.png" alt="A landscape"><figcaption>Landscape caption</figcaption></figure><p><img src="https://example.com/image.png" alt="Again"></p>',
    });
    expect(assets).toHaveLength(1);
    expect(source).toContain('alt: "A landscape"');
    expect(source).toContain("width: 50%");
    expect(source).toContain("Landscape caption");
  });

  test("downloaded source with embedded image bytes compiles without external image files", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: dom.window,
    });
    try {
      const image =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
        );
      const source = await exportTypst(
        {
          title: "Standalone source",
          html: `<figure><img src="${image}" alt="Red square"><figcaption>A saved image</figcaption></figure>`,
        },
        "source",
      );
      expect((await compile(await source.text())).join("")).toContain(
        "A saved image",
      );
    } finally {
      if (previousWindow)
        Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
