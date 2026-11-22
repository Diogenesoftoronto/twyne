import { expect, test } from "@playwright/test";

test("the editor nests folios and restores a hidden folio to its collection", async ({
  page,
}) => {
  await page.route("**/__drawer-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__drawer-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await idb.saveFoliosToIdb(
      ["Chapter One", "Loose draft"].map((name) => ({
        id: name,
        name,
        type: "draft",
        createdAt: now,
        updatedAt: now,
      })),
    );
    await idb.saveActiveFolioIdToIdb("Chapter One");
    const housePath = "/src/utils/house-store.ts";
    const house = await import(/* @vite-ignore */ housePath);
    await house.createCollection("Novel", ["Chapter One"]);
    await idb.saveFolioContentToIdb("Chapter One", "<p>Opening page.</p>");
  });
  await page.goto("/editor/");
  const openDrawer = async () => {
    const zen = page.getByRole("button", {
      name: "Toggle Zen mode",
      exact: true,
    });
    await expect(zen).toBeVisible();
    if ((await zen.getAttribute("aria-pressed")) === "true") await zen.click();
    await page
      .getByRole("button", { name: "Toggle the drawer sidebar" })
      .click({ timeout: 15_000 });
  };
  await openDrawer();
  const drawer = page.getByRole("navigation", { name: "Folios", exact: true });
  const collection = drawer.locator("details").filter({ hasText: "Novel" });
  const chapter = collection.getByRole("button", {
    name: /Folio .*Chapter One/,
  });
  await expect(chapter).toBeVisible();
  await expect(drawer.getByText("Loose folios", { exact: true })).toBeVisible();
  await collection.getByText("Novel", { exact: true }).click();
  await expect(chapter).toBeHidden();
  await collection.getByText("Novel", { exact: true }).click();
  await collection
    .getByRole("button", { name: "Hide folio: Chapter One" })
    .click();
  await expect(chapter).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Chapter One", exact: true }),
  ).toBeVisible();

  await page.reload();
  await openDrawer();
  await expect(
    drawer.getByText("Hidden folios (1)", { exact: true }),
  ).toBeVisible();
  await expect(chapter).toBeHidden();
  await drawer.getByText("Hidden folios (1)", { exact: true }).click();
  await drawer.getByRole("button", { name: "Show folio: Chapter One" }).click();
  await expect(chapter).toBeVisible();
  await expect(
    drawer.getByText("Hidden folios (1)", { exact: true }),
  ).toHaveCount(0);
});
