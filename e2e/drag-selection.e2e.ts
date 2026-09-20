import { expect, test, type Page } from "@playwright/test";

/**
 * Dragging a selection to a new place in the manuscript.
 *
 * This is the interaction a writer already knows from every other editor:
 * select a passage, drag it, watch a caret follow the pointer, drop, and the
 * passage *moves*. Twyne broke all three halves of it at once, because the
 * manuscript scroller carried Qwik's `preventdefault:drop`, which fires from a
 * document-level capture listener — ProseMirror ignores any event whose default
 * is already prevented, so its drop handling never ran.
 *
 * These tests drive real pointer input rather than synthetic DataTransfer
 * events, because a synthetic event would bypass the exact layer that was
 * broken.
 */

async function seedFolio(page: Page, html: string) {
  await page.goto("/");
  await page.evaluate(
    async ({ html }) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open("twyne", 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          for (const [name, keyPath] of [
            ["folios", "id"],
            ["folio-content", "folioId"],
            ["brief", "folioId"],
            ["comments", "id"],
            ["personas", "id"],
            ["meta", "key"],
            ["ai-settings", "key"],
            ["lix-blob", "key"],
            ["voice-notes", "id"],
          ] as const) {
            if (!d.objectStoreNames.contains(name)) {
              d.createObjectStore(name, { keyPath });
            }
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const now = Date.now();
      const id = "e2e-drag-selection";
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(
          ["folios", "folio-content", "meta"],
          "readwrite",
        );
        t.objectStore("folios").put({
          id,
          name: "Drag fixture",
          type: "draft",
          createdAt: now,
          updatedAt: now,
          layout: { pagination: "paginated" },
        });
        t.objectStore("folio-content").put({
          folioId: id,
          html,
          updatedAt: now,
        });
        t.objectStore("meta").put({
          key: "active-folio-id",
          value: id,
          updatedAt: now,
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },
    { html },
  );
}

async function openEditor(page: Page, html: string) {
  await seedFolio(page, html);
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(
    () => (window as any).__twynePagination?.measureCount > 0,
    undefined,
    { timeout: 20_000 },
  );
}

/** The manuscript's paragraphs, in document order. */
function paragraphTexts(page: Page) {
  return page.locator(".ProseMirror > p").allInnerTexts();
}

/**
 * Drag from one point to another as a person would.
 *
 * Chromium only promotes a mouse gesture to a native HTML5 drag after the
 * pointer has actually travelled, so the move is stepped and there is a
 * settling move before release. Without this the browser treats the gesture as
 * a click-and-select and the test passes for the wrong reason.
 */
async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Select a whole paragraph by index, leaving it highlighted. */
async function selectParagraph(page: Page, index: number) {
  const para = page.locator(".ProseMirror > p").nth(index);
  await para.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  return para;
}

/** Press inside a visible text fragment of the actual selection, never the block box. */
async function selectedTextPoint(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed)
      throw new Error("Expected selected text");
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (!rect) throw new Error("Selected text has no visible rectangle");
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

test.describe("dragging a selection", () => {
  test("review controls remain usable on a phone with the board closed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openEditor(page, "<p>A short draft.</p>");
    const status = page.locator(".live-review-status");
    await expect(status).toBeVisible();
    const box = await status.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page
      .getByRole("button", { name: "Pause review", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume review", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Resume review", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "/tmp/twyne-live-review-mobile.png" });
  });

  test("desktop tour hotspots stay hidden below the desktop breakpoint", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/");
    const hotspots = page.locator(".tour-hotspot");
    expect(await hotspots.count()).toBeGreaterThan(0);
    for (const hotspot of await hotspots.all())
      await expect(hotspot).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(hotspots.first()).toBeVisible();
  });
  test("moves a paragraph's text rather than copying it", async ({ page }) => {
    await openEditor(
      page,
      "<p>Alpha paragraph.</p><p>Beta paragraph.</p><p>Gamma paragraph.</p>",
    );

    await selectParagraph(page, 1);
    const alpha = page.locator(".ProseMirror > p").first();

    const start = await selectedTextPoint(page);
    const alphaBox = await alpha.boundingBox();
    expect(alphaBox).not.toBeNull();

    await dragBetween(
      page,
      start,
      // The very start of Alpha, so the text lands ahead of it.
      { x: alphaBox!.x + 2, y: alphaBox!.y + alphaBox!.height / 2 },
    );

    await expect
      .poll(async () => (await paragraphTexts(page)).join(" | "))
      .toContain("Beta paragraph.Alpha paragraph.");

    // Moved, not copied: the phrase exists exactly once in the document.
    const occurrences = await page.evaluate(() => {
      const text = document.querySelector(".ProseMirror")?.textContent ?? "";
      return text.split("Beta paragraph.").length - 1;
    });
    expect(occurrences).toBe(1);
  });

  test("moves a multi-paragraph selection", async ({ page }) => {
    await openEditor(page, "<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>");

    const paras = page.locator(".ProseMirror > p");
    // Select "Two." through "Three." — the user specifically asked for this to
    // work on blocks, not just a handful of characters.
    await paras.nth(1).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+End");

    const start = await selectedTextPoint(page);
    const target = await paras.nth(3).boundingBox();
    expect(target).not.toBeNull();

    await dragBetween(
      page,
      start,
      // Past the end of "Four.", so the pair lands at the tail of the document.
      { x: target!.x + target!.width - 2, y: target!.y + target!.height / 2 },
    );

    await expect
      .poll(async () => (await paragraphTexts(page)).join(" "))
      .toMatch(/One\..*Four\..*Two\..*Three\./s);
  });

  test("shows a drop caret while dragging and no file-drop overlay", async ({
    page,
  }) => {
    await openEditor(page, "<p>Alpha paragraph.</p><p>Beta paragraph.</p>");

    await selectParagraph(page, 1);
    const alpha = page.locator(".ProseMirror > p").first();
    const start = await selectedTextPoint(page);
    const alphaBox = await alpha.boundingBox();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y + 4, { steps: 6 });
    await page.mouse.move(alphaBox!.x + 2, alphaBox!.y + 2, { steps: 24 });

    // The caret that tells the writer where the text will land.
    await expect(page.locator(".twyne-dropcursor")).toBeVisible();
    // Dragging prose must not raise the plate/tabular file-drop prompt.
    await expect(page.locator(".drag-overlay")).toHaveCount(0);

    await page.mouse.up();
  });
});
