import { describe, expect, test } from "bun:test";
import { commentEditorStyle } from "./comment-editor-layout";

describe("comment editor layout", () => {
  test("gives a new note a viewport-aware editing area", () => {
    const style = commentEditorStyle("new");
    expect(style.minHeight).toContain("18dvh");
    expect(style.maxHeight).toContain("42dvh");
    expect(style.resize).toBe("vertical");
  });

  test("keeps long-note scrolling inside both editor variants", () => {
    for (const kind of ["new", "reply"] as const) {
      const style = commentEditorStyle(kind);
      expect(style.overflowY).toBe("auto");
      expect(style.overscrollBehavior).toBe("contain");
      expect(style.scrollbarGutter).toBe("stable");
    }
  });

  test("keeps replies comfortably sized without taking the whole panel", () => {
    const style = commentEditorStyle("reply");
    expect(style.minHeight).toContain("16dvh");
    expect(style.maxHeight).toContain("35dvh");
  });
});
