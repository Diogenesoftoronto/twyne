import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import sharp from "sharp";
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
import { applyTypstPageSetup, splitProofPages } from "./client";
import { htmlToTypst } from "./document";
import { ILLUMINATED_INITIAL_ARTWORK } from "../illuminated-initials";
import { typstDecorations } from "./decorative-assets";

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
      "LibertinusMath-Regular.otf",
      "specialelite-SpecialElite-Regular.ttf",
      ...["Regular", "Italic", "Bold", "BoldItalic"].flatMap((face) => [
        `lora-Lora-${face}.ttf`,
        `librebaskerville-LibreBaskerville-${face}.ttf`,
        `dmsans-DMSans-${face}.ttf`,
      ]),
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
  for (const url of ILLUMINATED_INITIAL_ARTWORK) {
    compiler.mapShadow(
      `/twyne-decoration/initial-${url
        .split("/")
        .at(-1)
        ?.replace(/\.avif$/, ".png")}`,
      await sharp(
        await readFile(new URL(`../../../public${url}`, import.meta.url)),
      )
        .png()
        .toBuffer(),
    );
  }
  for (const style of ["botanical", "engraved", "illuminated"]) {
    for (const part of ["nw", "n", "ne", "w", "e", "sw", "s", "se"])
      compiler.mapShadow(
        `/twyne-decoration/frame-${style}-${part}.png`,
        await sharp(
          await readFile(
            new URL(
              `../../../public/assets/page-borders/slices/${style}-${part}.avif`,
              import.meta.url,
            ),
          ),
        )
          .png()
          .toBuffer(),
      );
  }
}, 30000);

afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
  else Reflect.deleteProperty(globalThis, "DOMParser");
  dom.window.close();
});

async function compile(source: string, trailingMetadata = false) {
  compiler.addSource(
    "/main.typ",
    (trailingMetadata
      ? "#show text: it => box({ it; metadata(it.text) })\n"
      : "#show text: it => { metadata(it.text); it }\n") +
      "#show image: it => { if it.alt != none { metadata(it.alt) }; it }\n" +
      source,
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

async function proseBaselines(source: string) {
  const rendered = await compile(
    source +
      "\n#context metadata(query(metadata).filter(it => type(it.value) == str).map(it => (text: it.value, y: it.location().position().y / 1pt)))",
    true,
  );
  const positions = (rendered as unknown[]).find(Array.isArray) as {
    text: string;
    y: number;
  }[];
  return ["First line.", "Second line.", "Next paragraph."].map((text) => {
    const position = positions
      .filter((position) => position.text === text)
      .at(-1);
    expect(position).toBeDefined();
    return position!.y;
  });
}

const spacingLayout = {
  ...DEFAULT_LAYOUT,
  pageBorder: "none" as const,
  openingInitial: {
    mode: "off" as const,
    collection: "botanical" as const,
    size: "small" as const,
  },
};

test("body paragraph boundaries exceed within-paragraph leading in proof and PDF", async () => {
  const html = "<p>First line.<br>Second line.</p><p>Next paragraph.</p>";
  const payload = { title: "Spacing", html, layout: spacingLayout };
  for (const [route, source] of [
    ["manuscript", applyTypstPageSetup(htmlToTypst(html), payload)],
    ["PDF", serializeTypst(payload).source],
    [
      "native",
      applyTypstPageSetup(
        '#text("First line.")#linebreak()#text("Second line.")\n\n#text("Next paragraph.")',
        payload,
      ),
    ],
  ]) {
    const [first, second, next] = await proseBaselines(source);
    expect(second - first, route).toBeCloseTo(20.25, 2);
    expect(next - second).toBeGreaterThan(second - first);
    expect(next - second).toBeCloseTo(25.65, 2);
  }
});

test("custom paragraph gaps, zero gaps, and line heights survive proof and PDF", async () => {
  for (const gap of [0, 6, 24]) {
    const html = `<p data-space-after="${gap}" style="line-height:1.6">First line.<br>Second line.</p><p>Next paragraph.</p>`;
    const payload = { title: "Custom spacing", html, layout: spacingLayout };
    for (const source of [
      applyTypstPageSetup(htmlToTypst(html), payload),
      serializeTypst(payload).source,
    ]) {
      const [first, second, next] = await proseBaselines(source);
      expect(second - first).toBeCloseTo(17.55, 2);
      expect(next - second).toBeCloseTo(9.45 + gap, 2);
    }
  }
});

test("nested paragraph spacing remains unchanged", async () => {
  const prose = "<p>First line.<br>Second line.</p><p>Next paragraph.</p>";
  for (const html of [
    `<ul><li>${prose}</li></ul>`,
    `<ol><li>${prose}</li></ol>`,
    `<blockquote>${prose}</blockquote>`,
    `<table><tr><td>${prose}</td></tr></table>`,
    ...[1, 2, 3, 4, 5, 6].map(
      (level) =>
        `<h${level}>First line.<br>Second line.</h${level}><p>Next paragraph.</p>`,
    ),
  ]) {
    const payload = { title: "Nested spacing", html, layout: spacingLayout };
    for (const source of [
      applyTypstPageSetup(htmlToTypst(html), payload),
      serializeTypst(payload).source,
    ]) {
      const original = source
        .replace(
          "leading: 0.8em, spacing: 1.2em",
          "leading: 0.8em, spacing: 0.45em",
        )
        .replaceAll('"16.2"', '"6.075"');
      const before = await proseBaselines(original);
      const after = await proseBaselines(source);
      expect(after[1] - after[0]).toBeCloseTo(before[1] - before[0], 4);
      expect(after[2] - after[1]).toBeCloseTo(before[2] - before[1], 4);
    }
  }
});

describe("Typst serializer with the real bundled compiler", () => {
  test("opening prose wraps beside the drop cap and resumes the full column width", async () => {
    const prose =
      "At last, the page came alive. The opening paragraph carries enough words to fill several lines beside the illuminated letter, then continues beneath it across the full width of the column. Every word survives the change of width, along with its emphasis and links. ".repeat(
        3,
      );
    const html = `<h1>Wrapping</h1><p><strong><em>${prose.slice(0, 40)}</em></strong><a href="https://example.com">${prose.slice(40, 120)}</a>${prose.slice(120)}</p><p>Later prose.</p>`;
    for (const [mode, size, columns] of [
      ["illuminated", "small", 2],
      ["illuminated", "medium", 1],
      ["illuminated", "large", 2],
      ["plain", "large", 1],
    ] as const) {
      const payload = {
        title: "Wrapping",
        html,
        layout: {
          ...DEFAULT_LAYOUT,
          columns,
          pageBorder: "none" as const,
          openingInitial: {
            mode,
            collection: "botanical" as const,
            size,
          },
        },
      };
      // PDF serialization, rich manuscript proof, and handwritten Typst use
      // the same wrapping contract, including inside a two-column page.
      for (const source of [
        serializeTypst(payload).source,
        applyTypstPageSetup(htmlToTypst(html), payload),
        applyTypstPageSetup(`= Wrapping\n\n${prose}\n\nLater prose.`, payload),
      ]) {
        const rendered = await compile(
          source +
            "\n#context metadata(query(metadata).filter(it => type(it.value) == str).map(it => (text: it.value, x: it.location().position().x / 1pt, y: it.location().position().y / 1pt)))",
        );
        // A word boundary becomes a line break where the width changes.
        expect(rendered.join("").replace(/\s/g, "")).toContain(
          prose.replace(/\s/g, ""),
        );
        const positions = (rendered as unknown[]).find(Array.isArray) as {
          text: string;
          x: number;
          y: number;
        }[];
        const initialIndex = positions.findIndex((p) => p.text === "A");
        expect(initialIndex).toBeGreaterThanOrEqual(0);
        const initial = positions[initialIndex];
        const body = positions
          .slice(initialIndex + 1)
          .filter((p) => p.text.trim());
        const resume = body.findIndex(
          (p) => Math.abs(p.x - initial.x) < 0.1 && p.y > initial.y + 1,
        );
        expect(resume).toBeGreaterThan(0);
        const beside = body.slice(0, resume);
        expect(beside.every((p) => p.x > initial.x + 5)).toBe(true);
        expect(
          new Set(beside.map((p) => Math.round(p.y))).size,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("decorative PDF settings use authoritative marked prose, nine-slice borders, and columns", async () => {
    const html =
      '<h1>Ornament</h1><p>“<strong><em>At last</em></strong>, <span style="color:#224466">the page</span> came alive.</p><p>Later prose.</p>';
    for (const pageBorder of [
      "botanical",
      "engraved",
      "illuminated",
    ] as const) {
      const payload = {
        title: "Ornament",
        html: "<p>STALE HTML</p>",
        typstSource: htmlToTypst(html),
        layout: {
          ...DEFAULT_LAYOUT,
          pageBorder,
          columns: 2 as const,
          columnGap: 2,
          openingInitial: {
            mode: "illuminated" as const,
            collection: "alternate" as const,
            size: "large" as const,
          },
        },
      };
      const decoration = typstDecorations(payload);
      expect(decoration.assets.map((asset) => asset.url)).toEqual([
        "/assets/illuminated-initials/a-alt.avif",
        ...["nw", "n", "ne", "w", "e", "sw", "s", "se"].map(
          (part) => `/assets/page-borders/slices/${pageBorder}-${part}.avif`,
        ),
      ]);
      const source = applyTypstPageSetup(payload.typstSource, payload);
      expect(source).toContain("columns: 2");
      expect(source).toContain("#set columns(gutter: 24pt)");
      expect(source).toContain("left: 60pt");
      expect(source).toContain("twyne-initial-size = 74.25pt");
      expect((await compile(source)).join("")).toContain(
        "“At last, the page came alive.",
      );
    }
  });

  test("off/plain initials, unsupported graphemes, and native source retain their text", async () => {
    for (const mode of ["off", "plain", "illuminated"] as const) {
      const payload = {
        title: "Plain",
        html: "<p>Élan remains intact.</p>",
        layout: {
          ...DEFAULT_LAYOUT,
          pageBorder: "none" as const,
          openingInitial: {
            mode,
            collection: "botanical" as const,
            size: "small" as const,
          },
        },
      };
      const document = serializeTypst(payload);
      expect(document.assets).toHaveLength(0);
      expect((await compile(document.source)).join("")).toContain(
        "Élan remains intact.",
      );
      expect(document.source).toContain("background: none");
    }
    const payload = {
      title: "Native",
      html: "<p>STALE</p>",
      typstSource: '= Heading\n\n"At last, native prose.\n\nSecond paragraph.',
      layout: DEFAULT_LAYOUT,
    };
    expect(typstDecorations(payload).initial?.glyph).toBe("A");
    const nativeRendered = await compile(
      applyTypstPageSetup(payload.typstSource, payload),
    );
    expect(nativeRendered.join("")).toContain("At last, native prose.");
    expect(nativeRendered).toContain("A");
  });

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
    const html =
      '<h1>Proof</h1><p>A <strong>bold</strong> sentence.</p><ol><li><p>First</p></li><li><p>Second</p></li></ol><table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>One</p></td><td><p>Two</p></td></tr><tr><td><p>Three</p></td><td><p>Four</p></td></tr></tbody></table><div data-type="page-break"></div><p>Page two.</p>';
    const source = applyTypstPageSetup(htmlToTypst(html), {
      title: "Proof",
      html,
      header: "A running header",
      footer: "A working proof",
    });
    const rendered = (
      await compile(
        '#show grid: it => { metadata("grid-cells:" + str(it.children.len())); it }\n' +
          source,
      )
    ).join("");
    expect(rendered).toContain("A bold sentence.");
    expect(rendered).toContain("A running header");
    expect(rendered).toContain("A working proof");
    // Each cell must occupy the grid independently; nested row sequences
    // previously collapsed a whole row into one cell.
    expect(rendered).toContain("grid-cells:6");
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

  test("proof splitting retains shared definitions without cloning unrelated pages", () => {
    const prototype = dom.window.Node.prototype;
    const original = prototype.cloneNode;
    let pageClones = 0;
    prototype.cloneNode = function (deep: boolean) {
      if (deep) {
        const node = this as unknown as Element;
        pageClones += node.querySelectorAll?.(".typst-page").length ?? 0;
      }
      return original.call(this, deep);
    };
    try {
      const pages = splitProofPages(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="glyph" d="M0 0"/></defs><style>.ink{fill:red}</style><g class="typst-page" transform="translate(0 10)"><use href="#glyph"/><text>First</text></g><g class="typst-page" transform="translate(0 20)"><text>Second</text></g></svg>',
        [
          { width: 100, height: 200 },
          { width: 100, height: 200 },
        ],
      );
      expect(pageClones).toBe(0);
      expect(pages[0]).toContain('id="glyph"');
      expect(pages[0]).toContain(".ink{fill:red}");
      expect(pages[0]).toContain("First");
      expect(pages[0]).not.toContain("Second");
      expect(pages[1]).toContain("Second");
      expect(pages[1]).not.toContain("First");
    } finally {
      prototype.cloneNode = original;
    }
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
