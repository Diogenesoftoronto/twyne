import { expect, test, type Page } from "@playwright/test";

/**
 * Import used to parse the file, write it to IndexedDB, close the dialog —
 * and stop. The editor was never told to reload, so it kept rendering the
 * previous manuscript and its next autosave wrote that straight back over
 * the import. The file was read correctly and then silently discarded.
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
      const id = "e2e-import";
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(
          ["folios", "folio-content", "meta"],
          "readwrite",
        );
        t.objectStore("folios").put({
          id,
          name: "Import fixture",
          type: "draft",
          createdAt: now,
          updatedAt: now,
        });
        t.objectStore("folio-content").put({ folioId: id, html, updatedAt: now });
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

test.describe("document import", () => {
  test("markdown replaces the manuscript on screen and survives autosave", async ({
    page,
  }) => {
    await seedFolio(page, "<p>The manuscript already in the room.</p>");
    await page.goto("/editor/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".ProseMirror")).toContainText(
      "already in the room",
    );

    await page.getByRole("button", { name: "File ▾", exact: true }).click();
    await page.getByRole("menuitem", { name: "Import…", exact: true }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "brought-in.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Brought In From Outside\n\nA paragraph that came from a file.\n",
      ),
    });

    // The imported piece must actually reach the editor.
    await expect(page.locator(".ProseMirror")).toContainText(
      "A paragraph that came from a file.",
      { timeout: 15_000 },
    );
    await expect(page.locator(".ProseMirror")).not.toContainText(
      "already in the room",
    );

    // ...and must still be there once autosave has had a chance to run and
    // a reload re-reads from storage.
    await page.waitForTimeout(3000);
    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".ProseMirror")).toContainText(
      "A paragraph that came from a file.",
      { timeout: 15_000 },
    );
  });
});
