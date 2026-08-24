import { describe, expect, test } from "bun:test";

describe("editor filed dossier paper", () => {
  test("replaces the old index card with the latest filed per-folio paper", async () => {
    const [paper, editor, css] = await Promise.all([
      Bun.file("src/components/brief/project-brief-card.tsx").text(),
      Bun.file("src/routes/editor/index.tsx").text(),
      Bun.file("src/global.css").text(),
    ]);

    expect(editor).toContain("brief={store.brief}");
    expect(editor).toContain("loadProjectBriefForFolio");
    expect(paper).toContain("key={brief.updatedAt}");
    expect(paper).toContain("Current filed copy");
    expect(paper).toContain("formatFiledAt(brief.updatedAt)");
    expect(paper).toContain("filed-dossier-paper");
    expect(paper).not.toContain('class="index-card');
    expect(css).toContain("@keyframes filed-dossier-arrive");
  });
});
