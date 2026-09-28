import { expect, test, type Page } from "@playwright/test";

const DOC =
  "<h1>Harbour Notes</h1>" +
  Array.from(
    { length: 40 },
    (_, i) => `<p>Paragraph ${i + 1} of the harbour survey, tide by tide.</p>`,
  ).join("");

async function seed(page: Page, pagination: "paginated" | "continuous") {
  await page.goto("/");
  await page.evaluate(
    async ({ html, pagination }) => {
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
            if (!d.objectStoreNames.contains(name))
              d.createObjectStore(name, { keyPath });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const now = Date.now();
      const id = "e2e-select-all";
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(
          ["folios", "folio-content", "meta"],
          "readwrite",
        );
        t.objectStore("folios").put({
          id,
          name: "Select-all fixture",
          type: "draft",
          createdAt: now,
          updatedAt: now,
          layout: { pagination },
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
    { html: DOC, pagination },
  );
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
}

/** What Mod-A actually selected: the whole manuscript, and nothing else. */
async function selection(page: Page) {
  return page.evaluate(() => {
    const sel = window.getSelection();
    const text = sel?.toString() ?? "";
    const pm = document.querySelector(".ProseMirror");
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const inside = Boolean(
      range &&
        pm?.contains(range.startContainer) &&
        pm?.contains(range.endContainer),
    );
    return {
      inside,
      hasFirst: text.includes("Harbour Notes"),
      hasLast: text.includes("Paragraph 40 of"),
      focusInEditor: Boolean(pm?.contains(document.activeElement)),
    };
  });
}

const WHOLE = { inside: true, hasFirst: true, hasLast: true };

for (const pagination of ["paginated", "continuous"] as const) {
  test.describe(`Mod-A (${pagination})`, () => {
    test("with the caret in the text selects the whole manuscript", async ({
      page,
    }) => {
      await seed(page, pagination);
      await page.locator(".ProseMirror p").nth(3).click();
      await page.keyboard.press("ControlOrMeta+A");
      await expect.poll(() => selection(page)).toMatchObject(WHOLE);
    });

    test("after using the toolbar selects the manuscript, not the page", async ({
      page,
    }) => {
      await seed(page, pagination);
      await page.locator(".ProseMirror p").nth(3).click();
      await page.getByRole("button", { name: /^bold/i }).first().click();
      await page.keyboard.press("ControlOrMeta+A");
      await expect.poll(() => selection(page)).toMatchObject(WHOLE);
    });

    test("after clicking the page margin selects the manuscript", async ({
      page,
    }) => {
      await seed(page, pagination);
      await page.locator(".ProseMirror p").nth(3).click();
      await page.mouse.click(4, 300);
      await page.keyboard.press("ControlOrMeta+A");
      await expect
        .poll(() => selection(page))
        .toMatchObject({ ...WHOLE, focusInEditor: true });
    });

    test("a text field keeps its own select-all", async ({ page }) => {
      await seed(page, pagination);
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.id = "e2e-field";
        input.value = "just this field";
        document.body.append(input);
      });
      await page.locator("#e2e-field").click();
      await page.keyboard.press("ControlOrMeta+A");
      const picked = await page.evaluate(() => {
        const el = document.getElementById("e2e-field") as HTMLInputElement;
        return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
      });
      expect(picked).toBe("just this field");
      expect((await selection(page)).hasFirst).toBe(false);
    });

    test("typing after select-all replaces the whole manuscript", async ({
      page,
    }) => {
      await seed(page, pagination);
      await page.locator(".ProseMirror p").nth(3).click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("Fresh start.");
      await expect(page.locator(".ProseMirror")).toHaveText("Fresh start.");
    });
  });
}
