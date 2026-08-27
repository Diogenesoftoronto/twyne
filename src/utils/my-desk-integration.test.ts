import { describe, expect, test } from "bun:test";

const [root, editor, desk, accountMenu, convexSync] = await Promise.all([
  Bun.file(new URL("../root.tsx", import.meta.url)).text(),
  Bun.file(new URL("../routes/editor/index.tsx", import.meta.url)).text(),
  Bun.file(new URL("../routes/desk/index.tsx", import.meta.url)).text(),
  Bun.file(
    new URL("../components/auth/account-menu.tsx", import.meta.url),
  ).text(),
  Bun.file(new URL("./convex-sync.ts", import.meta.url)).text(),
]);

describe("My Desk coordinator integration", () => {
  test("mounts the separate usage synchronizer inside authenticated context", () => {
    expect(root).toContain("<AuthProvider>");
    expect(root).toContain("<UsageSyncController />");
    expect(root.indexOf("<AuthProvider>")).toBeLessThan(
      root.indexOf("<UsageSyncController />"),
    );
  });

  test("records writing activity only after folio persistence succeeds", () => {
    const saveIndex = editor.indexOf(
      "saveFolioContentToIdb(folioId, html).then",
    );
    const activityIndex = editor.indexOf(
      ".recordWritingActivity({ folioId })",
      saveIndex,
    );
    expect(saveIndex).toBeGreaterThan(-1);
    expect(activityIndex).toBeGreaterThan(saveIndex);
    expect(editor).toContain('markDirty(["folioContent", "folios"], folioId)');
    expect(convexSync).toContain("folioId ? { folioId } : {}");
  });

  test("links the Desk from both editor navigation and the account menu", () => {
    expect(editor).toContain('href="/desk/"');
    expect(accountMenu).toContain('nav("/desk/")');
    expect(desk).toContain('href="/editor/"');
    expect(desk).toContain('href="/settings/"');
  });

  test("guards range changes against stale local and remote responses", () => {
    expect(
      desk.match(/if \(cancelled\) return;/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(desk).toContain("cleanup(() =>");
  });

  test("publishes writing-day facts from each completed summary", () => {
    expect(desk).toContain("writingDays: number");
    expect(
      desk.match(/store\.writingDays = summary\.writingHeatmap\.filter/g)
        ?.length,
    ).toBe(2);
    expect(desk).toContain("writingDays={store.writingDays}");
  });

  test("does not couple usage events to folio snapshot synchronization", () => {
    expect(convexSync).not.toContain("ai-usage-events");
    expect(convexSync).not.toContain("syncClientEvents");
    expect(convexSync).not.toContain("usageLedger");
  });
});
