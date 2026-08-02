import { expect, test, type Page } from "@playwright/test";

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
      const id = "e2e-formatting";
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(
          ["folios", "folio-content", "meta"],
          "readwrite",
        );
        t.objectStore("folios").put({
          id,
          name: "Formatting fixture",
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

async function selectAllText(page: Page) {
  const pm = page.locator(".ProseMirror");
  await pm.click();
  await page.keyboard.press("ControlOrMeta+A");
}

test.describe("word-style formatting toolbar", () => {
  test("applies literal text and highlight colours through the pickers", async ({
    page,
  }) => {
    await openEditor(page, "<p>Colour this sentence.</p>");
    await selectAllText(page);

    await page
      .getByRole("button", { name: "Text colour", exact: true })
      .click();
    await page.getByRole("button", { name: "Sienna", exact: true }).click();
    await expect(
      page.locator('.ProseMirror span[style*="color"]'),
    ).toContainText("Colour this sentence.");

    await selectAllText(page);
    await page
      .getByRole("button", { name: "Choose highlight colour", exact: true })
      .click();
    await page.getByRole("button", { name: "Sky", exact: true }).click();
    const mark = page.locator('.ProseMirror mark[data-color="#cfe0f2"]');
    await expect(mark).toContainText("Colour this sentence.");
  });

  test("applies font, point size, line spacing, paragraph spacing and keep-with-next", async ({
    page,
  }) => {
    await openEditor(page, "<p>First paragraph.</p><p>Second paragraph.</p>");
    const first = page.locator(".ProseMirror > p").first();
    await first.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");

    await page
      .getByRole("button", { name: "Type options", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Font family" }).selectOption({
      label: "Special Elite",
    });
    await page
      .getByRole("combobox", { name: "Font size" })
      .selectOption("14pt");
    await page.getByRole("button", { name: "1.5", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Space before paragraph" })
      .selectOption("12");
    await page
      .getByRole("combobox", { name: "Space after paragraph" })
      .selectOption("18");
    await page
      .getByRole("checkbox", { name: "Keep paragraph with next" })
      .check();

    await expect(first).toHaveAttribute("data-space-before", "12");
    await expect(first).toHaveAttribute("data-space-after", "18");
    await expect(first).toHaveAttribute("data-keep-with-next", "true");
    await expect(first).toHaveAttribute("style", /line-height:\s*1\.5/);
    await expect(first.locator("span")).toHaveCSS("font-size", "18.6667px");
    await expect(first.locator("span")).toHaveCSS(
      "font-family",
      '"Special Elite", Courier, monospace',
    );
  });

  test("case changes preserve inline marks", async ({ page }) => {
    await openEditor(
      page,
      "<p><strong>the fall</strong> of <em>the house</em></p>",
    );
    await selectAllText(page);
    await page
      .getByRole("button", { name: "Type options", exact: true })
      .click();
    await page.getByRole("button", { name: "title case" }).click();

    await expect(page.locator(".ProseMirror strong")).toHaveText("The Fall");
    await expect(page.locator(".ProseMirror em")).toHaveText("the House");
    await expect(page.locator(".ProseMirror p")).toHaveText(
      "The Fall of the House",
    );
  });

  test("clear formatting removes marks and paragraph geometry", async ({
    page,
  }) => {
    await openEditor(
      page,
      '<p data-space-before="12" data-space-after="18" data-keep-with-next="true" style="line-height: 1.5"><strong>Marked</strong></p>',
    );
    await selectAllText(page);
    await page
      .getByRole("button", { name: "Clear formatting", exact: true })
      .click();

    const paragraph = page.locator(".ProseMirror > p");
    await expect(paragraph.locator("strong")).toHaveCount(0);
    await expect(paragraph).not.toHaveAttribute("data-space-before", /.+/);
    await expect(paragraph).not.toHaveAttribute("data-space-after", /.+/);
    await expect(paragraph).not.toHaveAttribute("data-keep-with-next", /.+/);
  });

  test("paragraph spacing invalidates pagination measurements", async ({
    page,
  }) => {
    const body = Array.from(
      { length: 18 },
      (_, i) => `<p>Paragraph ${i}. ${"Measured prose. ".repeat(12)}</p>`,
    ).join("");
    await openEditor(page, body);
    const before = await page.evaluate(
      () => (window as any).__twynePagination.measureCount,
    );

    await page.locator(".ProseMirror > p").first().click();
    await page
      .getByRole("button", { name: "Type options", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Space after paragraph" })
      .selectOption("24");

    await page.waitForFunction(
      (count) => (window as any).__twynePagination.measureCount > count,
      before,
      { timeout: 10_000 },
    );
    await expect(page.locator(".ProseMirror > p").first()).toHaveAttribute(
      "data-space-after",
      "24",
    );
  });
});
