import { expect, test } from "@playwright/test";

test("shows the writing desk before making the saved manuscript editable", async ({
  page,
}) => {
  const draft = "The manuscript returns exactly as it was saved.";
  await page.route("**/__editor-startup-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__editor-startup-seed");
  await page.evaluate(async (text) => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const id = "editor-startup-draft";
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id,
        name: "Saved manuscript",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(id, `<p>${text}</p>`);
  }, draft);

  const storage = Promise.withResolvers<void>();
  let storageRequested = false;
  await page.route(/\/src\/utils\/idb\.ts(?:\?|$)/, async (route) => {
    storageRequested = true;
    await storage.promise;
    await route.continue();
  });
  await page.goto("/editor/", { waitUntil: "commit" });

  const opening = page
    .getByRole("status")
    .filter({ hasText: "Opening manuscript…" });
  const manuscript = page.locator("#twyne-editor-mount .ProseMirror");
  try {
    await expect(opening).toBeVisible();
    await expect.poll(() => storageRequested).toBe(true);
    await expect(
      page.getByRole("navigation", { name: "Writing desk" }).getByRole("link", {
        name: "My Desk",
      }),
    ).toBeVisible();
    await expect(manuscript).toHaveCount(0);
  } finally {
    storage.resolve();
  }

  await expect(manuscript).toHaveAttribute("contenteditable", "true");
  await expect(manuscript).toHaveText(draft);
  await expect(opening).toHaveCount(0);
  await page.reload();
  await expect(manuscript).toHaveText(draft);
});
