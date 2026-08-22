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

  test("adds persona comments only when the export payload opts in", async () => {
    const clean = await exportDocx({
      title: "Clean Word manuscript",
      html: "<p>The manuscript stands alone.</p>",
    });
    const cleanImport = await importAs(
      new File([clean], "clean.docx", { type: clean.type }),
    );
    expect(cleanImport.html).not.toContain("M. Le Stylo");

    const annotated = await exportDocx({
      title: "Annotated Word manuscript",
      html: "<p>The manuscript stands alone.</p>",
      marginalia: [
        {
          personaId: "copy-chief",
          personaName: "M. Le Stylo",
          personaColor: "#d4a017",
          feedback: "Verify the archive figure before publication.",
          timestamp: 1,
          type: "critique",
          anchor: "nearly sixty percent",
        },
      ],
    });
    const annotatedImport = await importAs(
      new File([annotated], "annotated.docx", { type: annotated.type }),
    );
    expect(annotatedImport.html).toContain("Notes");
    expect(annotatedImport.html).toContain("M. Le Stylo");
    expect(annotatedImport.html).toContain(
      "Verify the archive figure before publication.",
    );
  });
});
