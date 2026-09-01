import { describe, expect, test } from "bun:test";
import { exportHtml, exportPlainText, stripHtml } from "./exchange";
import { DEFAULT_LAYOUT, type LayoutSettings } from "../types";
import type { ExportPayload } from "./exchange";

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
