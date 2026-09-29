import { expect, test, type Page } from "@playwright/test";

async function seedFolio(page: Page) {
  await page.route("**/__typst-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__typst-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id: "e2e-typst-editor",
        name: "Native manuscript",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveFolioContentToIdb(
      "e2e-typst-editor",
      "<p>The original manuscript.</p>",
    );
    await idb.saveActiveFolioIdToIdb("e2e-typst-editor");
  });
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toContainText(
    "The original manuscript.",
    { timeout: 30000 },
  );
}
async function replaceSource(page: Page, source: string) {
  const editor = page.getByRole("textbox", { name: "Typst source" });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
}

test("source drafts recover after reload and valid source applies with paginated proof", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (!/Failed to fetch|NetworkError|Load failed/i.test(error.message))
      runtimeErrors.push(error.message);
  });
  await seedFolio(page);
  const workspace = page.getByRole("region", { name: "Manuscript workspace" });
  await workspace.getByRole("button", { name: "Source", exact: true }).click();
  await replaceSource(page, "#this-is-not-valid(");
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();
  await expect(workspace.getByRole("alert")).toBeVisible({ timeout: 30000 });
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Typst source" }),
  ).toContainText("#this-is-not-valid(", { timeout: 30000 });
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();

  const source =
    "= Revised manuscript\n\nWords written in native source.\n\n#pagebreak()\n\nSecond typeset page.";
  await replaceSource(page, source);
  await expect(workspace.getByRole("status")).toContainText("2 pages", {
    timeout: 30000,
  });
  await workspace
    .getByRole("button", { name: "Apply source", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  await workspace.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText(
    "Words written in native source.",
  );
  await expect(page.locator(".ProseMirror")).not.toContainText(
    "original manuscript",
  );
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".ProseMirror")).toContainText(
    "The original manuscript.",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".ProseMirror")).toContainText(
    "Words written in native source.",
  );
  await expect(workspace.getByRole("status")).toContainText("2 pages", {
    timeout: 30000,
  });
  await workspace.getByRole("button", { name: "Proof", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "Proof", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    workspace.getByRole("img", { name: "Typeset page 1", exact: true }),
  ).toBeVisible();
  await expect(workspace.getByRole("img")).toHaveCount(2);
  const localNotice = page.getByRole("button", {
    name: "Not now",
    exact: true,
  });
  if (await localNotice.isVisible()) await localNotice.click();
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-proof-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-proof-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await workspace.getByRole("button", { name: "Source", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "Source", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-source-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-source-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await workspace.getByRole("button", { name: "Proof", exact: true }).click();
  expect(
    await workspace
      .getByRole("img")
      .evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true);

  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText(
    "Words written in native source.",
    { timeout: 30000 },
  );
  await workspace.getByRole("button", { name: "Source", exact: true }).click();
  const recoveredSource = page.getByRole("textbox", { name: "Typst source" });
  await recoveredSource.click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(recoveredSource).toContainText(
    "Words written in native source.",
  );
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const { loadFolioContentSnapshotFromIdb } = await import(
      /* @vite-ignore */ path
    );
    return loadFolioContentSnapshotFromIdb("e2e-typst-editor");
  });
  expect(saved.typstSource).toContain("Words written in native source.");
  expect(saved.format).toBe("typst");
  expect(runtimeErrors).toEqual([]);
});
