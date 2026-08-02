import { describe, expect, test } from "bun:test";
import type { JSONContent } from "@tiptap/core";

import { buildDocumentOutline } from "./document-outline";
import { planSectionMove } from "./section-reorder";

function heading(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function paragraph(text: string): JSONContent {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

describe("planSectionMove", () => {
  test("plans a parent heading and all subordinate content as one range", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [
        heading(1, "First"),
        paragraph("Opening"),
        heading(2, "Nested"),
        paragraph("Nested body"),
        heading(1, "Second"),
        paragraph("Closing"),
      ],
    });

    const plan = planSectionMove(outline, {
      sourceId: "first",
      targetId: "second",
      placement: "after",
    });

    expect(plan).toEqual({
      sourceId: "first",
      targetId: "second",
      placement: "after",
      from: outline.byId.first.from,
      to: outline.byId.second.from,
      insertAt: outline.byId.second.to,
    });
    expect(outline.byId.nested.from).toBeGreaterThan(plan!.from);
    expect(outline.byId.nested.to).toBeLessThanOrEqual(plan!.to);
  });

  test("rejects drops onto the source or any subordinate section", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [heading(1, "Parent"), heading(2, "Child"), heading(1, "Other")],
    });

    expect(
      planSectionMove(outline, {
        sourceId: "parent",
        targetId: "parent",
        placement: "before",
      }),
    ).toBeNull();
    expect(
      planSectionMove(outline, {
        sourceId: "parent",
        targetId: "child",
        placement: "after",
      }),
    ).toBeNull();
  });

  test("rejects adjacent no-op drops and missing headings", () => {
    const outline = buildDocumentOutline({
      type: "doc",
      content: [heading(1, "First"), heading(1, "Second")],
    });

    expect(
      planSectionMove(outline, {
        sourceId: "first",
        targetId: "second",
        placement: "before",
      }),
    ).toBeNull();
    expect(
      planSectionMove(outline, {
        sourceId: "missing",
        targetId: "second",
        placement: "after",
      }),
    ).toBeNull();
  });
});
