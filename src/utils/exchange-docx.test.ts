import { afterAll, describe, expect, test } from "bun:test";
import { DOMParser } from "@xmldom/xmldom";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
import { detectFormatFromFilename, exportDocx, importAs } from "./exchange";

const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();
const originalDOMParser = globalThis.DOMParser;
Object.defineProperty(globalThis, "DOMParser", {
  configurable: true,
  value: DOMParser,
});

afterAll(() => {
  if (originalDOMParser === undefined) {
    Reflect.deleteProperty(globalThis, "DOMParser");
  } else {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: originalDOMParser,
    });
  }
  releaseBrowserGlobalsLock();
});

describe("Microsoft Word exchange", () => {
  test("detects DOCX independently of text formats", () => {
    expect(detectFormatFromFilename("essay.DOCX")).toBe("docx");
  });

  test("exports genuine OOXML and imports its prose again", async () => {
    const blob = await exportDocx({
      title: "A Word manuscript",
      html: "<h1>Opening</h1><p>A <strong>careful</strong> paragraph.</p>",
    });
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe("PK");

    const imported = await importAs(
      new File([blob], "round-trip.docx", { type: blob.type }),
    );
    expect(imported.html).toContain("Opening");
    expect(imported.html).toContain("<strong>careful</strong>");
  });
});
