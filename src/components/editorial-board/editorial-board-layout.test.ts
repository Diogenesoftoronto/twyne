import { describe, expect, test } from "bun:test";

describe("editorial board shell placement", () => {
  test("keeps the board beside the full-height main column", async () => {
    const route = await Bun.file("src/routes/editor/index.tsx").text();
    const mainStart = route.indexOf('class="editor-workspace-main');
    const boardStart = route.indexOf("<EditorialBoardOverlay");
    const mainClose = route.lastIndexOf("</div>", boardStart);

    expect(mainStart).toBeGreaterThan(-1);
    expect(boardStart).toBeGreaterThan(mainStart);
    expect(mainClose).toBeGreaterThan(mainStart);
    expect(mainClose).toBeLessThan(boardStart);
    expect(route.slice(mainStart, mainClose)).not.toContain(
      "<EditorialBoardOverlay",
    );
  });

  test("stretches the board across the viewport shell", async () => {
    const styles = await Bun.file("src/global.css").text();
    const block =
      styles.match(/\.editorial-overlay \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(block).toContain("height: 100%");
    expect(block).toContain("align-self: stretch");
    expect(block).not.toContain("position: fixed");
  });
});
