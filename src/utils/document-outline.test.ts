import { describe, expect, test } from "bun:test";
import type { JSONContent } from "@tiptap/core";
import {
  buildDocumentOutline,
  createTableOfContentsPayload,
  focusOutlineHeading,
  slugifyOutlineHeading,
} from "./document-outline";
import { withEditor } from "../components/editor/test-harness";

function heading(level: number, text: string, id?: string): JSONContent {
  return {
    type: "heading",
    attrs: { level, ...(id ? { id } : {}) },
    content: text ? [{ type: "text", text }] : [],
  };
}

function paragraph(text: string): JSONContent {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

describe("buildDocumentOutline", () => {
  test("builds hierarchy without inventing skipped heading levels", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [
        heading(2, "Part"),
        heading(4, "Deep section"),
        heading(3, "Middle section"),
        heading(5, "Detail"),
        heading(1, "Reset"),
      ],
    });

    expect(outline.items.map((item) => item.text)).toEqual(["Part", "Reset"]);
    expect(outline.items[0].children.map((item) => item.text)).toEqual([
      "Deep section",
      "Middle section",
    ]);
    expect(outline.items[0].children[1].children[0].text).toBe("Detail");
    expect(outline.flat.map((item) => item.depth)).toEqual([0, 1, 1, 2, 0]);
  });

  test("allocates deterministic unique ids for duplicate and colliding slugs", () => {
    const document = {
      type: "doc",
      content: [
        heading(1, "Introduction"),
        heading(2, "Introduction"),
        heading(2, "Introduction 2"),
        heading(2, "Introduction"),
        heading(2, ""),
        heading(2, ""),
      ],
    } satisfies JSONContent;

    const first = buildDocumentOutline(document);
    const second = buildDocumentOutline(structuredClone(document));
    expect(first.flat.map((item) => item.id)).toEqual([
      "introduction",
      "introduction-2",
      "introduction-2-2",
      "introduction-3",
      "section",
      "section-2",
    ]);
    expect(second.flat.map((item) => item.id)).toEqual(
      first.flat.map((item) => item.id),
    );
    expect(first.flat.at(-1)?.label).toBe("Untitled section");
  });

  test("preserves explicit ids while de-duplicating invalid repeated input ids", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [
        heading(1, "One", "persisted"),
        heading(2, "Two", "persisted"),
        heading(2, "Three", "persisted-2"),
      ],
    });

    expect(outline.flat.map((item) => item.id)).toEqual([
      "persisted",
      "persisted-2",
      "persisted-2-2",
    ]);
  });

  test("computes complete section ranges for later atomic reordering", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [
        heading(1, "First"),
        paragraph("Opening"),
        heading(3, "Nested"),
        paragraph("Nested body"),
        heading(1, "Second"),
        paragraph("Closing"),
      ],
    });

    const [first, nested, second] = outline.flat;
    expect(first.from).toBe(0);
    expect(first.contentFrom).toBe(1);
    expect(first.to).toBe(second.from);
    expect(nested.to).toBe(second.from);
    expect(second.to).toBe(outline.documentSize);
  });

  test("matches ProseMirror positions and focuses a live duplicate heading", async () => {
    await withEditor(
      {
        content: "<h1>Repeated</h1><p>Body</p><h2>Repeated</h2><p>Tail</p>",
      },
      ({ editor }) => {
        const outline = buildDocumentOutline(editor.state.doc);
        const target = outline.flat[1];
        expect(target.id).toBe("repeated-2");
        expect(focusOutlineHeading(editor, target)).toBe(true);
        expect(editor.state.selection.from).toBe(target.contentFrom);
      },
    );
  });

  test("returns an empty model for documents without headings", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [paragraph("Plain manuscript")],
    });
    expect(outline.items).toEqual([]);
    expect(outline.flat).toEqual([]);
    expect(outline.byId).toEqual({});
  });
});

describe("createTableOfContentsPayload", () => {
  test("creates a portable nested payload and reconstructs filtered hierarchy", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [
        heading(1, "Book"),
        heading(2, "Chapter"),
        heading(4, "Scene"),
        heading(3, "Notes"),
      ],
    });
    const payload = createTableOfContentsPayload(outline, {
      title: "On this page",
      minLevel: 2,
      maxLevel: 4,
    });

    expect(payload).toEqual({
      type: "tableOfContents",
      version: 1,
      title: "On this page",
      entries: [
        {
          id: "chapter",
          title: "Chapter",
          level: 2,
          depth: 0,
          children: [
            {
              id: "scene",
              title: "Scene",
              level: 4,
              depth: 1,
              children: [],
            },
            {
              id: "notes",
              title: "Notes",
              level: 3,
              depth: 1,
              children: [],
            },
          ],
        },
      ],
    });
  });

  test("normalizes an empty custom title and clamps an inverted level range", () => {
    const payload = createTableOfContentsPayload(
      {
        type: "doc",
        content: [heading(1, "Top"), heading(6, "Bottom")],
      },
      { title: "   ", minLevel: 6, maxLevel: 2 },
    );
    expect(payload.title).toBe("Contents");
    expect(payload.entries.map((entry) => entry.id)).toEqual(["bottom"]);
  });
});

describe("slugifyOutlineHeading", () => {
  test("normalizes punctuation, accents, whitespace, and unicode text", () => {
    expect(slugifyOutlineHeading("  Crème & méthode! ")).toBe("creme-methode");
    expect(slugifyOutlineHeading("第一章")).toBe("第一章");
    expect(slugifyOutlineHeading("...")).toBe("section");
  });
});
