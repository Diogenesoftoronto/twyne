import { expect, test, type Page } from "@playwright/test";

async function seedFolio(page: Page, html: string) {
  await page.goto("/");
  await page.evaluate(async ({ html }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open("twyne", 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of [
          ["folios", "id"], ["folio-content", "folioId"], ["brief", "folioId"],
          ["comments", "id"], ["personas", "id"], ["meta", "key"],
          ["ai-settings", "key"], ["lix-blob", "key"], ["voice-notes", "id"],
        ] as const) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    const id = "e2e-responsive";
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["folios", "folio-content", "meta"], "readwrite");
      t.objectStore("folios").put({ id, name: "R", type: "draft", createdAt: now, updatedAt: now });
      t.objectStore("folio-content").put({ folioId: id, html, updatedAt: now });
      t.objectStore("meta").put({ key: "active-folio-id", value: id, updatedAt: now });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }, { html });
}

test.describe("editor chrome at small sizes", () => {
  test("the toolbar is one scrollable row on a phone, not six wrapped ones", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await seedFolio(page, "<p>Body.</p>");
    await page.goto("/editor/");
    const bar = page.locator(".twyne-toolbar");
    await expect(bar).toBeVisible({ timeout: 20_000 });

    const m = await bar.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        barH: el.getBoundingClientRect().height,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        flexWrap: cs.flexWrap,
        overflowX: cs.overflowX,
        rows: new Set(
          Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().top)),
        ).size,
        // How wide is the editor column itself? A 122px toolbar on a 390px
        // phone is a shell problem, not a toolbar problem.
        canvasW: document.querySelector(".page-canvas")?.getBoundingClientRect().width,
        shell: Array.from(document.querySelectorAll("aside")).map(
          (a) => Math.round(a.getBoundingClientRect().width),
        ),
      };
    });
    console.log("PHONE toolbar:", JSON.stringify(m));
    expect(m.scrollW).toBeGreaterThan(m.clientW);
    expect(m.barH).toBeLessThan(60);
  });

  test("the toolbar still wraps on a desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedFolio(page, "<p>Body.</p>");
    await page.goto("/editor/");
    const bar = page.locator(".twyne-toolbar");
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const m = await bar.evaluate((el) => ({
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
    }));
    console.log("DESKTOP toolbar:", JSON.stringify(m));
    expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1);
  });

  test("the layout panel fits the viewport and every control is reachable", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedFolio(page, "<p>Body.</p>");
    await page.goto("/editor/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
    await page.locator('button[aria-label="Page layout"]').first().click();

    const panel = page.locator("[data-layout-popover]");
    await expect(panel).toBeVisible();
    const m = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, bottom: r.bottom, scrollH: el.scrollHeight, clientH: el.clientHeight };
    });
    console.log("LAYOUT panel:", JSON.stringify(m), "viewportH 700");
    expect(m.w).toBeGreaterThan(280);
    expect(m.bottom).toBeLessThanOrEqual(701);

    for (const label of ["Left margin, rem", "Right margin, rem", "Top margin, rem", "Bottom margin, rem"]) {
      await expect(page.getByRole("slider", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Save as PDF/ })).toBeVisible();
  });
});
