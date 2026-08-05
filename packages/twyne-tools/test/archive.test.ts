import { describe, expect, test } from "bun:test";
import {
  createArchive,
  exportBundles,
  parseArchive,
  parseImportSource,
  TWYNE_ARCHIVE_FORMAT,
  TWYNE_ARCHIVE_VERSION,
} from "../src/archive.js";

describe("Twyne archive v2", () => {
  test("round-trips complete folio bundles", () => {
    const bundles = [
      {
        folio: { id: "folio-1", name: "A draft", type: "draft" as const },
        html: "<h1>A draft</h1><p>Words.</p>",
        brief: { audience: "Readers" },
        feedback: { notes: [{ text: "Tighten this." }] },
        citations: [{ id: "source-1", title: "A source", url: "https://example.com" }],
      },
    ];
    const archive = createArchive(bundles, new Date("2026-08-03T12:00:00.000Z"));
    expect(archive.format).toBe(TWYNE_ARCHIVE_FORMAT);
    expect(archive.version).toBe(TWYNE_ARCHIVE_VERSION);
    expect(parseArchive(JSON.stringify(archive))).toEqual(archive);
  });

  test("rejects legacy and malformed bundles", () => {
    expect(() => parseArchive({ version: 1, folios: [] })).toThrow("version 2");
    expect(() =>
      parseArchive({
        format: TWYNE_ARCHIVE_FORMAT,
        version: 2,
        exportedAt: new Date().toISOString(),
        folios: [{ folio: { id: "missing-name" } }],
      }),
    ).toThrow("folio.name");
  });
});

describe("single-file exchange", () => {
  test("parses Markdown, HTML, and text", () => {
    const markdown = parseImportSource({ name: "draft.md", content: "# Heading\n\n**Bold**" });
    expect(markdown.folios[0]?.folio.name).toBe("Heading");
    expect(markdown.folios[0]?.html).toContain("<strong>Bold</strong>");

    const html = parseImportSource({
      name: "draft.html",
      content: "<html><head><title>HTML title</title></head><body><p>Body</p></body></html>",
    });
    expect(html.folios[0]?.folio.name).toBe("HTML title");
    expect(html.folios[0]?.html).toBe("<p>Body</p>");

    const text = parseImportSource({ name: "plain.txt", content: "one\nline\n\ntwo" });
    expect(text.folios[0]?.html).toBe("<p>one<br />line</p>\n<p>two</p>");
  });

  test("uses archive for bulk and preserves readable single exports", () => {
    const bundles = [
      { folio: { id: "one", name: "One" }, html: "<h1>One</h1><p>Hello <strong>world</strong>.</p>" },
      { folio: { id: "two", name: "Two" }, html: "<p>Second</p>" },
    ];
    const archive = exportBundles(bundles, "archive");
    expect(parseArchive(archive.content).folios).toHaveLength(2);
    expect(() => exportBundles(bundles, "markdown")).toThrow("exactly one folio");
    expect(exportBundles([bundles[0]!], "markdown").content).toContain("**world**");
    expect(exportBundles([bundles[0]!], "txt").content).toContain("Hello world.");
  });
});
