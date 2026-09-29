import { describe, expect, test } from "bun:test";
import { exportHtml, exportPlainText, importAs, stripHtml } from "./exchange";
import { DEFAULT_LAYOUT, type LayoutSettings } from "../types";
import type { ExportPayload } from "./exchange";
import {
  withEditor,
  type EditorHarness,
} from "../components/editor/test-harness";
import {
  decoratePrintedOpening,
  preparePrintedImages,
} from "./print-ornaments";

/**
 * The print stylesheet is the only place where the writer's page settings
 * become a physical sheet, and it had two long-standing faults: margins were
 * applied twice, and the page-number rule was a Paged Media feature Chrome
 * has never implemented. Both are guarded here so they cannot come back.
 */

function payload(overrides: Partial<ExportPayload> = {}): ExportPayload {
  return {
    title: "Specimen",
    html: "<p>Body text.</p>",
    meta: {
      title: "Specimen",
      wordCount: 2,
      characterCount: 10,
      readingTime: 1,
    },
    marginalia: [],
    ...overrides,
  } as ExportPayload;
}

const layout = (over: Partial<LayoutSettings> = {}): LayoutSettings => ({
  ...DEFAULT_LAYOUT,
  ...over,
});

async function withPrintDom(
  run: (harness: EditorHarness) => void | Promise<void>,
) {
  await withEditor({}, async (harness) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
    Object.defineProperty(globalThis, "DOMParser", {
      value: harness.dom.window.DOMParser,
      configurable: true,
      writable: true,
    });
    try {
      await run(harness);
    } finally {
      if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
      else Reflect.deleteProperty(globalThis, "DOMParser");
    }
  });
}

describe("print stylesheet", () => {
  test("loads every font family the formatting menu can write", () => {
    const html = exportHtml(payload());
    // Fraunces is no longer offered for new marks, but older manuscripts can
    // still contain its persisted font-family stack and must export faithfully.
    for (const family of [
      "DM+Sans",
      "Fraunces",
      "Libre+Baskerville",
      "Lora",
      "Special+Elite",
    ]) {
      expect(html).toContain(family);
    }
  });

  test("is a readable standalone document before it is printed", () => {
    const html = exportHtml(payload());
    expect(html).toContain('<main class="export-document">');
    expect(html).toContain('<header class="export-titleblock">');
    expect(html).toContain("<h1>Specimen</h1>");
    expect(html).toContain('meta name="generator" content="Twyne"');
    expect(html).toContain("article { max-width: 70ch; }");
  });

  test("does not duplicate a title already leading the manuscript", () => {
    const html = exportHtml(payload({ html: "<h1>Specimen</h1><p>Body.</p>" }));
    expect(html).not.toContain('<header class="export-titleblock">');
    expect(html.match(/<h1>Specimen<\/h1>/g)).toHaveLength(1);
  });

  test("the sheet size comes from paper and orientation", () => {
    const html = exportHtml(
      payload({ layout: layout({ paper: "a4", orientation: "landscape" }) }),
    );
    expect(html).toContain("@page { size: A4 landscape;");
  });

  test("Letter portrait is emitted for a default layout", () => {
    const html = exportHtml(payload({ layout: layout() }));
    expect(html).toContain("size: letter portrait");
  });

  test("the dead @bottom-center rule is gone", () => {
    // It never rendered — Chrome implements neither the margin-box selector
    // nor counter(page) outside one — and its presence made the exporter
    // look like it produced page numbers when it never had.
    const html = exportHtml(payload({ layout: layout({ pageNumbers: true }) }));
    expect(html).not.toContain("@bottom-center");
    // The rule, not the word — the stylesheet comments explain why it is
    // absent, and that explanation is worth keeping.
    expect(html).not.toMatch(/content:\s*counter\(page\)/);
  });

  test("body carries no margin, so page margins cannot double", () => {
    // @page owns the margins. Setting them on body as well stacked the two
    // and quietly doubled every printed margin.
    const html = exportHtml(payload({ layout: layout({ marginLeft: 3 }) }));
    expect(html).toMatch(/body\s*\{[^}]*margin:\s*0;/);
    expect(html).toMatch(/body\s*\{[^}]*padding:\s*0;/);
  });

  test("screen-only paper geometry is removed for print", () => {
    const html = exportHtml(payload());
    expect(html).toContain(".export-document {");
    expect(html).toContain("box-shadow: none;");
    expect(html).toContain("article, .export-titleblock { max-width: none; }");
  });

  test("margins are converted to inches through the fixed 96px/in", () => {
    // 3rem at the pinned 16px root is 48px, which is half an inch.
    const html = exportHtml(
      payload({
        layout: layout({
          marginLeft: 3,
          marginRight: 3,
          marginTop: 3,
          marginBottom: 3,
          pageBorder: "none",
        }),
      }),
    );
    expect(html).toContain("margin: 0.500in 0.500in 0.500in 0.500in");
  });

  test("the root font size is pinned so that conversion is exact", () => {
    const html = exportHtml(payload());
    expect(html).toMatch(/html\s*\{\s*font-size:\s*16px;\s*\}/);
  });

  test("the atomic-block contract is mirrored for the printer", () => {
    const html = exportHtml(payload());
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("break-after: avoid");
    expect(html).toContain("orphans: 2");
  });

  test("justification and hyphenation match the editor", () => {
    // The screen sets both; an export that sets neither breaks its lines
    // somewhere else and every page drifts.
    const html = exportHtml(payload());
    expect(html).toContain("text-align: justify");
    expect(html).toContain("hyphens: auto");
  });

  test("a manual page break maps to break-after: page", () => {
    const html = exportHtml(payload());
    expect(html).toMatch(/\[data-page-break\][^{]*\{[^}]*break-after:\s*page/);
  });

  test("continuous mode leaves the sheet size to the print dialog", () => {
    const html = exportHtml(
      payload({ layout: layout({ pagination: "continuous" }) }),
    );
    expect(html).toContain("size: auto");
  });

  test("portable tables, images, and math keep their export styling hooks", () => {
    const html = exportHtml(
      payload({
        html:
          '<table data-table-style="banded-rows"><caption>Results</caption><tbody><tr><td style="background-color: #ffeeaa">1</td></tr></tbody></table>' +
          '<figure data-type="image" data-image-width="50"><img src="/plate.png" alt="Plate"><figcaption>Figure one</figcaption></figure>' +
          '<span data-type="inline-math" data-math-display="inline" data-latex="x^2">x^2</span>',
      }),
    );
    expect(html).toContain('table[data-table-style="banded-rows"]');
    expect(html).toContain("background-color: #ffeeaa");
    expect(html).toContain('figure[data-type="image"] figcaption');
    expect(html).toContain('[data-math-display="inline"]');
    expect(html).toContain('data-latex="x^2"');
  });
});

describe("plain text", () => {
  test("a page break becomes a form feed", () => {
    const text = stripHtml(
      '<p>One</p><div data-type="page-break" data-page-break="true"></div><p>Two</p>',
    );
    expect(text).toContain("\f");
  });

  test("the break does not silently vanish from a text export", () => {
    const text = exportPlainText(
      payload({
        html: '<p>One</p><div data-page-break="true"></div><p>Two</p>',
      }),
    );
    expect(text).toContain("\f");
    expect(text).toContain("One");
    expect(text).toContain("Two");
  });
});

describe("print ornaments and columns", () => {
  test("keeps the quoted original text and formatting alongside decorative artwork", async () => {
    await withPrintDom(async ({ dom }) => {
      dom.reconfigure({ url: "https://twyne.app/editor/" });
      const source =
        '<p>“<strong><a href="https://example.com">At</a></strong> home.”</p>';
      const html = exportHtml(payload({ html: source }));
      const doc = new DOMParser().parseFromString(html, "text/html");
      const article = doc.querySelector("article")!;
      expect(article.textContent?.trim()).toBe("“At home.”");
      expect(article.querySelector(".export-initial-prefix")?.textContent).toBe(
        "“",
      );
      expect(article.querySelector(".export-initial-glyph")?.textContent).toBe(
        "A",
      );
      expect(
        article
          .querySelector(".export-initial-glyph")
          ?.closest("a strong, strong a"),
      ).not.toBeNull();
      const image = article.querySelector("img")!;
      expect(image.getAttribute("src")).toBe(
        "https://twyne.app/assets/illuminated-initials/a.webp",
      );
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("aria-hidden")).toBe("true");
      expect(source).not.toContain("export-initial");
      const imported = await importAs(
        new File([html], "ornaments.html", { type: "text/html" }),
      );
      expect(imported.html).toBe(source);
    });
  });

  test("off, plain, alternate and Unicode preserve the exact manuscript letters", async () => {
    await withPrintDom(() => {
      const off = layout({
        openingInitial: {
          mode: "off",
          collection: "botanical",
          size: "medium",
        },
      });
      expect(decoratePrintedOpening("<p>At home.</p>", off)).toBe(
        "<p>At home.</p>",
      );
      const plain = layout({
        openingInitial: {
          mode: "plain",
          collection: "alternate",
          size: "small",
        },
      });
      expect(decoratePrintedOpening("<p>At home.</p>", plain)).toContain(
        'class="export-initial">A',
      );
      expect(decoratePrintedOpening("<p>At home.</p>", plain)).not.toContain(
        "<img",
      );
      const alternate = layout({
        openingInitial: {
          mode: "illuminated",
          collection: "alternate",
          size: "large",
        },
      });
      expect(decoratePrintedOpening("<p>At home.</p>", alternate)).toContain(
        "a-alt.webp",
      );
      const accented = decoratePrintedOpening(
        "<p>E<strong>\u0301</strong>lan.</p>",
        alternate,
      );
      const doc = new DOMParser().parseFromString(accented, "text/html");
      expect(doc.body.textContent).toBe("E\u0301lan.");
      expect(doc.querySelector("img")).toBeNull();
    });
  });

  test("empty or atom-first paragraphs cannot crash or illuminate later prose", async () => {
    await withPrintDom(() => {
      for (const source of [
        '<p><img src="/photo.png"></p>',
        "<p><br>At home.</p>",
        '<p>“<img src="/photo.png">At home.</p>',
        "<p></p><p>At home.</p>",
      ])
        expect(decoratePrintedOpening(source, layout())).toBe(source);
    });
  });

  test("exports selected columns and a repeated nine-slice frame with safe physical margins", () => {
    const html = exportHtml(
      payload({
        layout: layout({ columns: 3, columnGap: 2, pageBorder: "botanical" }),
      }),
    );
    expect(html).toContain("column-count: 3; column-gap: 2rem");
    expect(html).toContain("padding: 0.833in 0.833in 0.833in 0.833in");
    // Twelve short tiles per horizontal edge, seven per vertical edge, four corners.
    expect(html.match(/data-twyne-print-ornament="border"/g)).toHaveLength(42);
    expect(html).toContain("botanical.png");
    expect(html).toContain("position: fixed;");
    expect(html).toContain("inset: 18pt;");
    expect(html).toContain("box-decoration-break: clone;");
    const unframed = exportHtml(
      payload({
        layout: layout({
          pageBorder: "none",
          marginTop: 0,
          marginLeft: 0,
          marginBottom: 0,
          marginRight: 0,
        }),
      }),
    );
    expect(unframed).not.toContain('<div class="export-page-frame');
    expect(unframed).toContain("margin: 0.000in 0.000in 0.000in 0.000in");
  });

  test("embeds repeated artwork once and waits for decode before revealing the initial", async () => {
    await withPrintDom(async ({ dom }) => {
      dom.reconfigure({ url: "https://twyne.app/editor/" });
      const doc = new DOMParser().parseFromString(
        exportHtml(payload({ layout: layout({ pageBorder: "botanical" }) })),
        "text/html",
      );
      const before = doc.querySelector("article")!.textContent;
      const images = Array.from(doc.images);
      const decoded: string[] = [];
      for (const image of images) {
        Object.defineProperty(image, "naturalWidth", { value: 1024 });
        image.decode = async () => {
          decoded.push(image.src);
        };
      }
      const originalFetch = globalThis.fetch;
      const fetched: string[] = [];
      globalThis.fetch = (async (url: string) => {
        fetched.push(String(url));
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      }) as typeof fetch;
      try {
        await preparePrintedImages(doc);
        expect(fetched).toHaveLength(2);
        expect(decoded).toHaveLength(43);
        expect(
          images.every((image) => image.src === "data:image/png;base64,AQID"),
        ).toBe(true);
        expect(
          doc.querySelector(".export-initial.is-illuminated"),
        ).not.toBeNull();
        expect(doc.querySelector("article")!.textContent).toBe(before);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
