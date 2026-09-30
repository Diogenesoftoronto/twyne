import { afterAll, describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
import { exportHtml, exportTwyneBackup, importAs } from "./exchange";

const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();
const originalDOMParser = globalThis.DOMParser;
const originalXMLSerializer = globalThis.XMLSerializer;

Object.defineProperty(globalThis, "DOMParser", {
  configurable: true,
  value: DOMParser,
});
Object.defineProperty(globalThis, "XMLSerializer", {
  configurable: true,
  value: XMLSerializer,
});

afterAll(() => {
  for (const [name, original] of [
    ["DOMParser", originalDOMParser],
    ["XMLSerializer", originalXMLSerializer],
  ] as const) {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: original,
      });
    }
  }
  releaseBrowserGlobalsLock();
});

describe("HTML import", () => {
  test("round-trips a Twyne export without importing its stylesheet or chrome", async () => {
    const exported = exportHtml({
      title: "A measured draft",
      html: "<p>The manuscript survives <em>intact</em>.</p>",
      header: "Running header",
      footer: "Running footer",
    });

    const imported = await importAs(
      new File([exported], "measured-draft.html", { type: "text/html" }),
    );

    expect(imported.title).toBe("A measured draft");
    expect(imported.html).toContain("The manuscript survives");
    expect(imported.html).toContain("<em>intact</em>");
    expect(imported.html).not.toContain("setting both stacks");
    expect(imported.html).not.toContain("export-titleblock");
    expect(imported.html).not.toContain("twyne-chrome");
  });

  test("repairs a missing closing body before extracting a Twyne article", async () => {
    const truncatedEnvelope = exportHtml({
      title: "Recovered draft",
      html: "<h2>Still here</h2><p>Only the manuscript belongs here.</p>",
    }).replace("</body>", "");

    const imported = await importAs(
      new File([truncatedEnvelope], "recovered.html", { type: "text/html" }),
    );

    expect(imported.title).toBe("Recovered draft");
    expect(imported.html).toContain("Still here");
    expect(imported.html).toContain("Only the manuscript belongs here.");
    expect(imported.html).not.toContain("@page");
    expect(imported.html).not.toContain("font-family");
  });

  test("keeps generic document content while dropping non-content nodes", async () => {
    const generic = `<!DOCTYPE html>
<html><head>
  <title>Field &amp; Form</title>
  <style>.leak { color: red; }</style>
  <script>globalThis.leaked = true;</script>
</head><body>
  <link rel="stylesheet" href="print.css" />
  <h1>Field notes</h1>
  <p>Keep <em>this prose</em>.</p>
  <noscript>not manuscript copy</noscript>
  <style>.body-leak { display: block; }</style>
  <script>alsoLeaked();</script>
</body></html>`;

    const imported = await importAs(
      new File([generic], "field-notes.html", { type: "text/html" }),
    );

    expect(imported.title).toBe("Field & Form");
    expect(imported.html).toContain("Field notes");
    expect(imported.html).toContain("<em>this prose</em>");
    expect(imported.html).not.toContain(".body-leak");
    expect(imported.html).not.toContain("alsoLeaked");
    expect(imported.html).not.toContain("print.css");
    expect(imported.html).not.toContain("not manuscript copy");
  });
});

describe("native Typst import", () => {
  test("imports exact source including unknown Typst into protected visual blocks", async () => {
    const source =
      "#let my_function(x) = x * 2\n\n= A native document\n\nHello";
    const imported = await importAs(new File([source], "native.typ"));
    expect(imported.typstSource).toBe(source);
    expect(imported.title).toBe("native");
    expect(imported.html).toContain("A native document");
    expect(imported.html).toContain("raw-typst");
  });
  test("backup restores canonical source rather than a stale HTML cache", async () => {
    const source = "= Canonical title\n\nCanonical content";
    const backup = exportTwyneBackup({
      title: "Native",
      html: "<p>Stale cache</p>",
      typstSource: source,
    });
    const imported = await importAs(new File([backup], "native.twyne.json"));
    expect(imported.typstSource).toBe(source);
    expect(imported.html).toContain("Canonical content");
    expect(imported.html).not.toContain("Stale cache");
  });
});
