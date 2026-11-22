import { expect, test } from "@playwright/test";

test("folio deletion requires confirmation, persists, and allows an empty Library", async ({
  page,
}) => {
  await page.route("**/__folio-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__folio-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    await idb.saveFoliosToIdb(
      ["keep", "remove"].map((id) => ({
        id,
        name: id,
        type: "draft",
        createdAt: 1,
        updatedAt: 1,
      })),
    );
    await idb.saveFolioContentToIdb("remove", "<p>Private draft</p>");
    await idb.saveFolioContentToIdb("keep", "<p>Keep this draft</p>");
    await idb.saveBriefToIdb("remove", {
      answers: { workingTitle: "Remove" },
      updatedAt: 1,
    });
    await idb.saveMetaToIdb("brief-editions:remove", [{ id: "old" }]);
    await idb.saveActiveFolioIdToIdb("remove");
    localStorage.setItem(
      "twyne-project-brief",
      JSON.stringify({ answers: { workingTitle: "Legacy" } }),
    );
  });
  await page.goto("/library/");
  const remove = page.getByRole("button", {
    name: "Delete folio: remove",
    exact: true,
  });
  await expect(remove).toBeVisible();
  const cancelled = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
      resolve();
    });
  });
  await remove.click();
  await cancelled;
  await expect(remove).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(remove).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "keep", exact: true }),
  ).toBeVisible();
  await expect(remove).toHaveCount(0);
  const records = await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    return {
      active: await idb.loadActiveFolioIdFromIdb(),
      removed: await idb.loadFolioContentFromIdb("remove"),
      brief: await idb.loadBriefFromIdb("remove"),
      editions: await idb.loadMetaFromIdb("brief-editions:remove"),
      kept: await idb.loadFolioContentFromIdb("keep"),
    };
  });
  expect(records).toEqual({
    active: null,
    removed: "",
    brief: null,
    editions: null,
    kept: "<p>Keep this draft</p>",
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete folio: keep", exact: true })
    .click();
  await expect(page.getByText("No folios yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("No folios yet.")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("twyne-project-brief")),
  ).toBeNull();
});
