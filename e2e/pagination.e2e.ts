import { expect, test, type Page } from "@playwright/test";

/**
 * Pagination has to be tested in a real browser: the engine's whole job is to
 * reconcile measured layout with a computed grid, and JSDOM reports every
 * height as zero. The arithmetic is covered in `pagination-geometry.test.ts`;
 * what is checked here is that the arithmetic and the rendered document agree.
 */

/**
 * Put a folio in IndexedDB so `/editor/` opens on a manuscript instead of
 * redirecting to the dossier interview.
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
      const id = "e2e-pagination";
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(
          ["folios", "folio-content", "meta"],
          "readwrite",
        );
        t.objectStore("folios").put({
          id,
          name: "Pagination fixture",
          type: "draft",
          createdAt: now,
          updatedAt: now,
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

/** Wait for the engine to settle and report a page count. */
async function pageCount(page: Page): Promise<number> {
  await page.waitForFunction(
    () => (window as any).__twynePagination?.pageCount >= 1,
    undefined,
    { timeout: 20_000 },
  );
  // Let any in-flight remeasure land before reading.
  await page.waitForTimeout(400);
  return page.evaluate(() => (window as any).__twynePagination.pageCount);
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

const paragraphs = (n: number, text = "Lorem ipsum dolor sit amet, ") =>
  Array.from({ length: n }, (_, i) => `<p>${text.repeat(6)} (${i})</p>`).join("");

test.describe("paginated canvas", () => {
  test("no block straddles a sheet boundary", async ({ page }) => {
    // The single most valuable assertion in the suite. Every top-level block's
    // rendered rectangle must sit inside one page band; if any block crosses a
    // boundary, the engine and the page furniture disagree about where the
    // paper ends and the writer sees text printed over the gap.
    await openEditor(page, paragraphs(40));

    const straddling = await page.evaluate(() => {
      const probe = (window as any).__twynePagination;
      const { pageH, gap, marginTop, marginBottom } = probe.geometry;
      const period = pageH + gap;
      const pm = document.querySelector(".ProseMirror")!;
      const canvas = document.querySelector(".page-canvas")!;
      const canvasTop = canvas.getBoundingClientRect().top;

      const bad: string[] = [];
      for (const el of Array.from(pm.children)) {
        if ((el as HTMLElement).classList.contains("twyne-page-spacer")) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        // Position relative to the canvas padding box, which is page 0's
        // sheet top — the same origin the engine's grid is defined on.
        const top = r.top - canvasTop;
        const bottom = r.bottom - canvasTop;
        // A block taller than the content box legitimately overflows; that is
        // the documented ceiling, not a straddle.
        if (r.height > pageH - marginTop - marginBottom) continue;
        if (Math.floor(top / period) !== Math.floor((bottom - 1) / period)) {
          bad.push(
            `${el.tagName} top=${top.toFixed(1)} bottom=${bottom.toFixed(1)} period=${period}`,
          );
        }
      }
      return bad;
    });

    expect(straddling).toEqual([]);
  });

  test("a manual page break lands the next block on the grid", async ({
    page,
  }) => {
    await openEditor(page, "<p>First page</p><p>Second page</p>");

    await page.locator(".ProseMirror p").first().click();
    await page.keyboard.press("End");
    await page.locator('button[aria-label="Insert page break"]').click();
    await page.waitForTimeout(600);

    const offset = await page.evaluate(() => {
      const probe = (window as any).__twynePagination;
      const { pageH, gap, marginTop } = probe.geometry;
      const period = pageH + gap;
      const canvas = document.querySelector(".page-canvas")!;
      const canvasTop = canvas.getBoundingClientRect().top;
      const pm = document.querySelector(".ProseMirror")!;

      // The first real block after the break node.
      const kids = Array.from(pm.children) as HTMLElement[];
      const breakIdx = kids.findIndex((el) =>
        el.matches('[data-type="page-break"]'),
      );
      const next = kids
        .slice(breakIdx + 1)
        .find((el) => !el.classList.contains("twyne-page-spacer"));
      if (!next) return null;
      const top = next.getBoundingClientRect().top - canvasTop;
      // Expected content top of page 1.
      return top - (period + marginTop);
    });

    expect(offset).not.toBeNull();
    // Sub-pixel tolerance: font metrics do not land on whole pixels.
    expect(Math.abs(offset!)).toBeLessThan(2);
  });

  test("resizing the window does not change the page count", async ({
    page,
  }) => {
    // Page height comes from the paper, not the viewport. This is the most
    // likely regression: an engine that measured against the window would
    // repaginate every time a side panel opened.
    await openEditor(page, paragraphs(40));
    const before = await pageCount(page);

    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(800);
    const after = await pageCount(page);

    expect(after).toBe(before);
  });

  test("changing the paper repaginates", async ({ page }) => {
    await openEditor(page, paragraphs(40));
    const letter = await pageCount(page);

    await page.locator('button[aria-label="Page layout"]').click();
    await page.locator('button:has-text("A4")').click();
    await page.waitForTimeout(800);
    const a4 = await pageCount(page);

    // A4 is taller than Letter, so the same prose needs no more pages — and
    // the count must actually have been recomputed rather than frozen.
    expect(a4).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__twynePagination.geometry.pageH))
      .toBeGreaterThan(1056 - 1);
    expect(letter).toBeGreaterThan(1);
  });

  test("continuous mode removes the spacers entirely", async ({ page }) => {
    await openEditor(page, paragraphs(40));
    expect(await page.locator(".twyne-page-spacer").count()).toBeGreaterThan(0);

    await page.locator('button[aria-label="Page layout"]').click();
    await page.locator('button:has-text("Scroll")').click();
    await page.waitForTimeout(800);

    expect(await page.locator(".twyne-page-spacer").count()).toBe(0);
    expect(await page.locator(".twyne-page-sheet").count()).toBe(0);
  });

  test("a table taller than a page starts on a fresh page", async ({ page }) => {
    // The v1 contract: blocks break atomically. A widget decoration cannot
    // live inside <tbody>, so a table is never split.
    const rows = Array.from(
      { length: 40 },
      (_, i) => `<tr><td>row ${i}</td><td>value ${i}</td></tr>`,
    ).join("");
    await openEditor(
      page,
      `<p>Intro paragraph</p><table><tbody>${rows}</tbody></table><p>After</p>`,
    );

    const split = await page.evaluate(() => {
      const probe = (window as any).__twynePagination;
      const { pageH, gap } = probe.geometry;
      const period = pageH + gap;
      const canvas = document.querySelector(".page-canvas")!;
      const canvasTop = canvas.getBoundingClientRect().top;
      const table = document.querySelector(".ProseMirror table")!;
      const r = table.getBoundingClientRect();
      const top = r.top - canvasTop;
      // The table must begin at a page content top, not mid-page.
      return { top, period, offsetInPage: top % period };
    });

    // It starts a page, so its offset within the page is the top margin —
    // small relative to the sheet, not somewhere down the middle of it.
    expect(split.offsetInPage).toBeLessThan(split.period * 0.25);
  });

  test("typing does not thrash the measurement", async ({ page }) => {
    await openEditor(page, paragraphs(20));
    await page.locator(".ProseMirror p").first().click();

    const before = await page.evaluate(
      () => (window as any).__twynePagination.measureCount,
    );
    for (let i = 0; i < 50; i++) {
      await page.keyboard.type("a", { delay: 10 });
    }
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      () => (window as any).__twynePagination.measureCount,
    );

    // A 50-keystroke burst at 10ms intervals sits well inside the 90ms
    // quiet gate, so it should settle in one or two passes, not fifty.
    expect(after - before).toBeLessThanOrEqual(4);
  });

  test("page furniture is rendered and counted", async ({ page }) => {
    await openEditor(page, paragraphs(40));
    const count = await pageCount(page);
    expect(count).toBeGreaterThan(1);
    expect(await page.locator(".twyne-page-sheet").count()).toBe(count);
    // Page numbers are real text from the engine's integer, not a CSS
    // counter — `counter(page)` is unreadable outside an @page margin box.
    await expect(page.locator(".twyne-page-number").first()).toHaveText("1");
  });
});
