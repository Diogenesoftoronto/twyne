import { expect, test, type Page } from "@playwright/test";
async function chooseView(page: Page, name: "Write" | "Source" | "Proof") {
  await page.getByRole("button", { name, exact: true }).click();
}
const baseContent =
  "<h1>The boring breakthrough</h1><p>A breakthrough often begins with an ordinary observation: the useful work is already in front of us. We learn to give it our attention.</p><h2>Working context</h2><p>Writing is a way to make a complicated idea feel clear. A quiet desk helps us keep the argument in view while leaving the tools close at hand.</p>" +
  Array.from(
    { length: 12 },
    () =>
      "<p>We return to the evidence, sentence by sentence. The draft gives us room to think, revise and discover what we mean. The important details remain available when we need them, without competing with the words on the page.</p>",
  ).join("");
async function seed(page: Page) {
  await page.route(/\/api\/auth\//, (r) =>
    r.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__editor-seed", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__editor-seed");
  await page.evaluate(async (html) => {
    const idb = await import(/* @vite-ignore */ "/src/utils/idb.ts");
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id: "declutter-preview",
        name: "The boring breakthrough",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveFolioContentToIdb("declutter-preview", html);
    await idb.saveActiveFolioIdToIdb("declutter-preview");
    await idb.saveMetaToIdb("signin-toast-dismissed", true);
  }, baseContent);
  await page.goto("/editor/");
  await expect(page.getByText(/Setting the type/)).toHaveCount(0, {
    timeout: 60000,
  });
  await expect(page.locator(".ProseMirror")).toContainText(
    "The boring breakthrough",
    { timeout: 60000 },
  );
  await expect(page.getByRole("combobox", { name: "Go to page" })).toBeEnabled({
    timeout: 60000,
  });
}
const compositor = (page: Page) =>
  page.getByRole("button", { name: "Toggle compositor", exact: true });
const zen = (page: Page) =>
  page.getByRole("button", { name: "Toggle Zen mode", exact: true });
test("quiet Write default has persistent views, Split and a compact bottom bar; ribbon has two levels", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await seed(page);
  await expect(zen(page)).toHaveAttribute("aria-pressed", "true");
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Source", "Proof", "Split"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.locator(".editor-bottom-bar")).toContainText("words");
  await expect(
    page
      .locator(".editor-bottom-bar")
      .getByRole("combobox", { name: "Go to page" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".editor-bottom-bar")
      .getByRole("button", { name: "Toggle Zen mode" }),
  ).toBeVisible();
  await expect(page.locator(".live-review-status")).toHaveCount(0);
  const measure = (await page.locator(".ProseMirror").boundingBox())!;
  expect(measure.width).toBeGreaterThan(1000);
  expect(measure.width).toBeLessThan(1200);
  expect(measure.y).toBeLessThan(120);
  expect(
    (await page.locator(".editor-bottom-bar").boundingBox())!.height,
  ).toBeLessThan(42);
  for (const theme of ["editorial", "nightpress"]) {
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`quiet-desktop-${theme}.png`),
      animations: "disabled",
    });
  }
  await compositor(page).focus();
  await page.keyboard.press("Enter");
  await expect(zen(page)).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Text style" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Font family" }),
  ).toBeVisible();
  await expect(page.getByText("More tools", { exact: true })).toHaveCount(0);
  expect(
    (await page.locator(".editor-desk-controls").boundingBox())!.height,
  ).toBeLessThan(105);
  for (const theme of ["editorial", "nightpress"]) {
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`ribbon-desktop-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.getByRole("tab", { name: "Insert", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Review", exact: true }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "View", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Focus", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Page layout", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Page layout", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Page layout", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("tab", { name: "View", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
  await expect(compositor(page)).toBeFocused();
  await page.reload();
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
});
test("source, write, proof and compact page navigation retain source recovery", async ({
  page,
}) => {
  await seed(page);
  await compositor(page).click();
  await chooseView(page, "Source");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await expect(source).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.activeElement?.closest(".typst-source-editor"),
      ),
    )
    .toBe(true);
  await source.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "= A recovered manuscript\n\nFirst page retained.\n\n#pagebreak()\n\nSecond page retained.",
  );
  await expect(
    page.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(source).toContainText("Second page retained.", {
    timeout: 30000,
  });
  await expect(page.locator(".typst-status")).toContainText("2 pages", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Apply source", exact: true }).click();
  await compositor(page).click(); // The saved explicit compositor preference stays open on reload.
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
  await compositor(page).click();
  await chooseView(page, "Write");
  await expect(page.locator(".ProseMirror")).toContainText(
    "Second page retained.",
  );
  await page.getByRole("combobox", { name: "Go to page" }).selectOption("2");
  await expect(page.locator(".typst-proof")).toBeVisible();
  await expect(page.locator('[data-typst-page="2"] img')).toBeVisible();
  await expect
    .poll(() => page.locator(".typst-proof").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await chooseView(page, "Write");
  await expect(page.locator(".ProseMirror")).toContainText(
    "First page retained.",
  );
});
test("explicit view choices survive reload and flow interruptions without losing edits", async ({
  page,
}) => {
  await seed(page);
  await zen(page).click();
  await compositor(page).click();
  await expect(zen(page)).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(zen(page)).toHaveAttribute("aria-pressed", "false");
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Toggle the drawer sidebar" }),
  ).toBeVisible();
  await compositor(page).click();
  const manuscript = page.locator(".ProseMirror");
  await manuscript.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.insertText(
    "Persistent formatting survives a quiet desk.",
  );
  await page.keyboard.press("ControlOrMeta+b");
  await expect(manuscript.locator("strong")).toContainText(
    "Persistent formatting survives",
  );
  await compositor(page).click();
  await page.getByRole("combobox", { name: "Text style" }).selectOption("h2");
  await expect(
    manuscript
      .locator("h2")
      .filter({ hasText: "Persistent formatting survives" }),
  ).toContainText("Persistent formatting survives");
  await page
    .getByRole("combobox", { name: "Text style" })
    .selectOption("paragraph");
  await expect(
    manuscript
      .locator("p")
      .filter({ hasText: "Persistent formatting survives" }),
  ).toContainText("Persistent formatting survives");
  await compositor(page).click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(
    page.getByRole("searchbox", { name: "Find", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("twyne:zen-mode", {
        detail: { on: true, source: "flow" },
      }),
    ),
  );
  await expect(zen(page)).toHaveAttribute("aria-pressed", "false");
  await page.goto("/library/");
  await page.goto("/editor/");
  await expect(manuscript).toContainText("Persistent formatting survives");
  await expect(zen(page)).toHaveAttribute("aria-pressed", "false");
  await zen(page).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("twyne:zen-mode", {
        detail: { on: false, source: "flow" },
      }),
    ),
  );
  await expect(zen(page)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(zen(page)).toHaveAttribute("aria-pressed", "true");
  await expect(manuscript).toContainText("Persistent formatting survives");
});
test("mobile Write, Source, Proof and Split fit both themes; Zen hides the complete ribbon", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  expect(
    (await page.locator(".ProseMirror").boundingBox())!.width,
  ).toBeGreaterThan(300);
  for (const theme of ["editorial", "nightpress"]) {
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`quiet-mobile-${theme}.png`),
      animations: "disabled",
    });
  }
  await compositor(page).click();
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  for (const theme of ["editorial", "nightpress"]) {
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`ribbon-mobile-${theme}.png`),
      animations: "disabled",
    });
  }
  await chooseView(page, "Source");
  await expect(
    page.getByRole("textbox", { name: "Typst source" }),
  ).toBeVisible();
  await chooseView(page, "Proof");
  await expect(page.locator(".typst-proof")).toBeVisible();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator(".typst-proof")).toBeVisible();
  const write = (await page.locator(".typst-writing").boundingBox())!,
    proof = (await page.locator(".typst-proof").boundingBox())!;
  expect(proof.y).toBeGreaterThanOrEqual(write.y + write.height - 1);
  await page.screenshot({
    path: info.outputPath("split-mobile.png"),
    animations: "disabled",
  });
  await zen(page).click();
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeHidden();
  await chooseView(page, "Source");
  await expect(page.locator(".typst-ribbon")).toBeHidden();
  await chooseView(page, "Proof");
  await expect(page.locator(".typst-proof-tools")).toBeHidden();
  await chooseView(page, "Write");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".typst-proof")).toBeHidden();
  await zen(page).click();
  await page.getByRole("button", { name: "Toggle the drawer sidebar" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ProseMirror")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("mobile category tools dismiss safely and compositor preference returns after Zen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await compositor(page).click();
  await page.getByRole("tab", { name: "View", exact: true }).click();
  await page.getByRole("button", { name: "Page layout", exact: true }).click();
  const layout = page.getByRole("dialog", { name: "Page layout", exact: true });
  await expect(layout).toBeVisible();
  const box = (await layout.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(layout).toBeHidden();
  await expect(
    page.getByRole("tab", { name: "View", exact: true }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Find and replace", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Advanced type and paragraph options",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Advanced type and paragraph options",
      exact: true,
    }),
  ).toBeVisible();
  await zen(page).click();
  await expect(
    page.getByRole("dialog", {
      name: "Advanced type and paragraph options",
      exact: true,
    }),
  ).toBeHidden();
  await page.reload();
  await expect(zen(page)).toHaveAttribute("aria-pressed", "true");
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
  await zen(page).click();
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  await compositor(page).click();
  await compositor(page).click();
  await expect(
    page.getByRole("dialog", {
      name: "Advanced type and paragraph options",
      exact: true,
    }),
  ).toBeHidden();
  await page.screenshot({
    path: info.outputPath("mobile-category-tools.png"),
    animations: "disabled",
  });
});

test("dedicated Split is reachable with compositor closed and preserves source recovery", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await seed(page);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator(".typst-proof")).toBeVisible();
  for (const theme of ["editorial", "nightpress"]) {
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`split-desktop-${theme}.png`),
      animations: "disabled",
    });
  }
  await chooseView(page, "Source");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await source.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "= Retained source\n\nA draft kept with Split and Zen.",
  );
  await expect(
    page.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();
  await compositor(page).click();
  await compositor(page).click();
  await expect(
    page.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".typst-proof")).toBeVisible();
  await page.reload();
  await expect(source).toContainText("A draft kept with Split and Zen.", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();
  await expect(compositor(page)).toHaveAttribute("aria-expanded", "false");
});
