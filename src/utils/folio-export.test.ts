import { describe, expect, test } from "bun:test";
import { shouldIncludePersonaComments } from "./folio-export";

describe("folio export persona comments", () => {
  test("excludes persona comments by default", () => {
    expect(shouldIncludePersonaComments({})).toBe(false);
    expect(
      shouldIncludePersonaComments({ includePersonaComments: false }),
    ).toBe(false);
  });

  test("includes persona comments only after an explicit opt in", () => {
    expect(shouldIncludePersonaComments({ includePersonaComments: true })).toBe(
      true,
    );
  });

  test("both export surfaces expose an unchecked persona-comment choice", async () => {
    const [menu, editor, compositor] = await Promise.all([
      Bun.file("src/components/folio/folio-menu.tsx").text(),
      Bun.file("src/components/editor/twyne-editor.tsx").text(),
      Bun.file("src/components/editor/compositor-panel.tsx").text(),
    ]);

    expect(menu).toContain("const includePersonaComments = useSignal(false)");
    expect(menu).toContain(
      "includePersonaComments: includePersonaComments.value",
    );
    expect(editor).toContain("includePersonaCommentsInExport: false");
    expect(editor).toContain(
      "includePersonaComments: store.includePersonaCommentsInExport",
    );
    expect(compositor).toContain("Include persona comments");
  });
});
