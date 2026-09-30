import { expect, test } from "@playwright/test";

test("House files reusable context and preserves collections and charter after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__house-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>House seed</title>",
    }),
  );
  await page.goto("/__house-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id: "house-salt",
        name: "Salt Roads",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "house-coast",
        name: "The Coast in Winter",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveActiveFolioIdToIdb("house-salt");
    await idb.saveMetaToIdb("house-state", {
      house: { name: "", dossier: {}, updatedAt: now },
      collections: [],
      charter: [],
      ledger: [],
    });
  });
  await page.goto("/house/");
  await page.locator(".house-node--house").click();
  const name = page.getByRole("textbox", { name: "The name of your house" });
  await name.fill("Éditions du Passage");
  await name.press("Tab");
  await page
    .getByRole("textbox", { name: "Aim", exact: true })
    .fill("Make familiar places strange again.");
  await page.getByRole("textbox", { name: "Aim", exact: true }).press("Tab");
  await page
    .getByRole("textbox", { name: "New charter article" })
    .fill("Ground every claim in a concrete scene.");
  await page.getByRole("button", { name: "Add article", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Charter article", exact: true }),
  ).toHaveValue("Ground every claim in a concrete scene.");
  await page.getByRole("button", { name: "Found a collection" }).click();
  const collection = page.getByRole("textbox", { name: "Collection name" });
  await collection.fill("Journeys & Returns");
  await collection.press("Tab");
  await page.getByRole("checkbox", { name: "Salt Roads", exact: true }).check();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/utils/idb.ts";
        const idb = await import(/* @vite-ignore */ path);
        return await idb.loadMetaFromIdb("house-state");
      }),
    )
    .toMatchObject({
      house: {
        name: "Éditions du Passage",
        dossier: { goal: "Make familiar places strange again." },
      },
      collections: [{ name: "Journeys & Returns", folioIds: ["house-salt"] }],
      charter: [{ text: "Ground every claim in a concrete scene." }],
    });
  await page.getByRole("button", { name: "The register" }).click();
  await expect(page.locator(".house-register")).toContainText(
    "Journeys & Returns",
  );
  await page.getByRole("button", { name: "Engine room", exact: true }).click();
  await expect(page.locator(".house-engine")).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue("Éditions du Passage");
  await expect(page.locator(".house-tree")).toContainText("Journeys & Returns");
  await page.locator(".house-node--house").click();
  await expect(
    page.getByRole("textbox", { name: "Aim", exact: true }),
  ).toHaveValue("Make familiar places strange again.");
  await expect(
    page.getByRole("textbox", { name: "Charter article", exact: true }),
  ).toHaveValue("Ground every claim in a concrete scene.");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
