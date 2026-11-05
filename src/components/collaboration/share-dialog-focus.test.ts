import { describe, expect, test } from "bun:test";

/**
 * The share check runs in the background: when the editor opens, when the
 * writer switches folio, and whenever the auth state refreshes (which
 * better-auth does each time the window regains focus). Moving focus from
 * there pulled the caret out of the manuscript onto the Share button, so a
 * signed-in writer's next keystrokes went to the button instead of the page.
 */
describe("share dialog focus", () => {
  test("the background share check never moves focus", async () => {
    const source = await Bun.file(
      "src/components/collaboration/share-dialog.tsx",
    ).text();
    const start = source.indexOf("// Check if this folio is already shared.");
    const end = source.indexOf("// When shared, poll for collaborators");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toContain(".focus(");
  });

  test("focus returns to Share only from the writer's own actions", async () => {
    const source = await Bun.file(
      "src/components/collaboration/share-dialog.tsx",
    ).text();
    const background = source.slice(
      source.indexOf("useVisibleTask$"),
      source.indexOf("const handleShare"),
    );
    // Both background tasks (the share check and the presence poll) sit
    // before the handlers; neither may focus anything.
    expect(background).not.toContain(".focus(");
  });
});
