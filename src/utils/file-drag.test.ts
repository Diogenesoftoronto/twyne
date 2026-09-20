import { describe, expect, test } from "bun:test";
import { isFileDrag } from "./file-drag";

/** A `DataTransfer` stand-in carrying only the field the helper reads. */
function transfer(types: unknown): DataTransfer {
  return { types } as unknown as DataTransfer;
}

describe("isFileDrag", () => {
  test("recognises a file drag", () => {
    expect(isFileDrag(transfer(["Files"]))).toBe(true);
  });

  test("recognises a file drag alongside other payloads", () => {
    // Dragging a file out of some apps also advertises a text/uri-list.
    expect(isFileDrag(transfer(["text/uri-list", "Files"]))).toBe(true);
  });

  test("a dragged text selection is not a file drag", () => {
    expect(isFileDrag(transfer(["text/plain", "text/html"]))).toBe(false);
  });

  test("an empty payload is not a file drag", () => {
    expect(isFileDrag(transfer([]))).toBe(false);
  });

  test("reads a DOMStringList-shaped types collection", () => {
    // Safari hands back a live DOMStringList, which has length and indices but
    // no `includes`, so the helper converts before testing membership.
    const domStringList = { 0: "Files", length: 1 };
    expect(isFileDrag(transfer(domStringList))).toBe(true);
  });

  test("survives a drag event with no dataTransfer", () => {
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
    expect(isFileDrag(transfer(undefined))).toBe(false);
  });
});
