import { expect, test, type Page } from "@playwright/test";

/** Fictional notes on a long manuscript: two on one early passage, one late. */
async function seed(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__connections-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__connections-seed");
  await page.evaluate(async () => {
    const idbPath = "/src/utils/idb.ts";
    const commentsPath = "/src/utils/user-comments.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const uc = await import(/* @vite-ignore */ commentsPath);
    const now = Date.now(),
      id = "connections-fixture";
    await idb.saveFoliosToIdb([
      { id, name: "Salt Roads", type: "draft", createdAt: now, updatedAt: now },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    const paras = Array.from(
      { length: 22 },
      (_, i) =>
        `<p>Paragraph ${i + 1}: the salt caravans left before dawn, and the road bent with the coast for a week of walking.</p>`,
    );
    paras[3] =
      '<p>By the fourth day <span class="twyne-comment-mark" data-comment-id="c1" data-comment-author="You">the road forgot the sea entirely</span> and turned inland.</p>';
    paras[18] =
      '<p>Near the end <span class="twyne-comment-mark" data-comment-id="c3" data-comment-author="Editor">the sea came back as a rumour</span> among the drivers.</p>';
    await idb.saveFolioContentToIdb(id, paras.join(""));
    const note = (
      cid: string,
      text: string,
      author: string,
      anchor: string,
    ) => ({
      id: cid,
      folioId: id,
      text,
      author,
      anchor,
      resolved: false,
      createdAt: now,
      updatedAt: now,
      replies: [],
    });
    await uc.saveUserComments([
      note(
        "c1",
        "Is this literally true? Check the map.",
        "You",
        "the road forgot the sea entirely",
      ),
      note(
        "c2",
        "This is the turn the ending answers.",
        "Editor",
        "the road forgot the sea entirely",
      ),
      note(
        "c3",
        "Pays off the inland turn.",
        "Editor",
        "the sea came back as a rumour",
      ),
    ]);
    await idb.saveMetaToIdb("flow-reading-enabled", true);
    await idb.saveMetaToIdb("signin-toast-dismissed", true);
    localStorage.setItem("living-desk-open", "false");
    localStorage.setItem(
      "twyne:editor:view:v1",
      JSON.stringify({ zenMode: false, compositorOpen: false }),
    );
  });
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror").first()).toContainText(
    "the sea came back as a rumour",
    { timeout: 60_000 },
  );
  await expect(page.locator('[data-flow-card="comment:c1"]')).toBeVisible({
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
}
const manuscriptText = (page: Page) =>
  page.locator(".ProseMirror").first().textContent();

test.use({ viewport: { width: 1440, height: 900 } });

test("a card gathers its passage and notes read-only, by click, keyboard and a resting pointer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const original = await manuscriptText(page);
  const card = page.locator('[data-flow-card="comment:c1"]');
  const gather = card.getByRole("button", { name: /together$/ });
  await gather.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("By the fourth day");
  await expect(sheet.locator("mark")).toHaveText(
    "the road forgot the sea entirely",
  );
  // Both notes on the one passage are named beside it, verbatim.
  await expect(sheet).toContainText("Is this literally true? Check the map.");
  await expect(sheet).toContainText("This is the turn the ending answers.");
  await expect(sheet).toHaveScreenshot("connected-passages-desktop.png");
  await expect(sheet.getByRole("button", { name: /^Close/ })).toBeFocused();
  // Keyboard stays inside the sheet, and Escape returns to the opener.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("[data-passage-gather]"),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(gather).toBeFocused();
  expect(await manuscriptText(page)).toBe(original);

  // A resting pointer opens the same view; passing over does not.
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.move(box.x + 32, box.y + 42);
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 4_000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Go to passage", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    "the road forgot the sea entirely",
  );
  expect(await manuscriptText(page)).toBe(original);
  expect(errors).toEqual([]);
});

test("the narrow margin dock opens its connected passages by click and a resting pointer", async ({
  page,
}) => {
  // Seed while wide enough to expose the card, then collapse to the dock.
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  const original = await manuscriptText(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const dock = page.getByRole("complementary", {
    name: "From the margin",
    exact: true,
  });
  await dock.getByRole("button", { name: /from the room.*Open/ }).click();
  // The local repeated-passage analysis can replace the initial margin note
  // with its echo. Wait for that result before testing the single-card dock.
  const card = dock.locator('[data-flow-card^="echo:"]');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const gather = card.getByRole("button", { name: /together$/ });
  await expect(gather).toBeInViewport();
  await gather.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const quoted = await sheet.locator("mark").allTextContents();
  expect(quoted.length).toBeGreaterThan(0);
  for (const quote of quoted) expect(original).toContain(quote);
  await expect(sheet).toHaveScreenshot("connected-passages-mobile-390.png");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(gather).toBeFocused();
  // Touch and keyboard use the click control. A mouse resting over that
  // same dock still opens the inspection after the dwell period.
  await page.mouse.move(2, 2);
  await card.hover();
  await expect(sheet).toBeVisible({ timeout: 4_000 });
  await sheet.getByRole("button", { name: /^Close/ }).click();
  await expect(sheet).toHaveCount(0);
  expect(await manuscriptText(page)).toBe(original);
});

test("a gathered passage that changes cannot jump to a different span", async ({
  page,
}) => {
  await seed(page);
  await page
    .locator('[data-flow-card="comment:c1"]')
    .getByRole("button", { name: /together$/ })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.locator('.ProseMirror [data-comment-id="c1"]').evaluate((span) => {
    span.textContent = "the inland route changed while this view was open";
  });
  await sheet
    .getByRole("button", { name: "Go to passage", exact: true })
    .click();
  await expect(sheet).toContainText(
    "This passage changed. Close and reopen this view to follow it.",
  );
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("a connected passage scrolled off screen stays reachable from the edge", async ({
  page,
}) => {
  await seed(page);
  const card = page.locator('[data-flow-card="comment:c1"]');
  await card.hover();
  await page.mouse.move(4, 500);
  await page
    .locator(".manuscript-scroller")
    .evaluate((scroller) => scroller.scrollBy(0, 900));
  const edge = page.getByRole("button", {
    name: /^Go to the connected passage above/,
  });
  await expect(edge).toHaveCount(1);
  await edge.click();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe("the road forgot the sea entirely");
  await expect(
    page.locator(".ProseMirror p").filter({ hasText: "By the fourth day" }),
  ).toBeInViewport();
});

test("focus dismisses the margin and masthead instead of dimming them, and Show margin brings them back", async ({
  page,
}) => {
  await seed(page);
  // A real run of flow takes minutes of steady typing. Hold the conductor's
  // clock and publish the flow snapshot it would publish.
  await page.evaluate(async () => {
    const path = "/src/components/editor/extensions/flow-conductor.ts";
    const flow = await import(/* @vite-ignore */ path);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.documentElement.dataset.flow = "flow";
    window.dispatchEvent(
      new CustomEvent(flow.FLOW_EVENT, {
        detail: {
          ...flow.flowSnapshot(),
          enabled: true,
          mode: "flow",
          visible: [],
          held: 3,
          heldKinds: { comment: 3 },
        },
      }),
    );
  });
  await expect(page.locator(".flow-card").first()).toBeHidden();
  await expect(page.locator(".editor-workspace-main > header")).toBeHidden();
  // Nothing faint stays focusable or catches the pointer.
  const faint = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "button, a[href], textarea, input",
        ),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).visibility === "hidden")
          return false;
        let opacity = 1;
        for (
          let n: HTMLElement | null = el;
          n && n !== document.documentElement;
          n = n.parentElement
        )
          opacity *= Number(getComputedStyle(n).opacity);
        return opacity < 0.3;
      }).length,
  );
  expect(faint).toBe(0);
  await page.getByRole("button", { name: /^Show margin/ }).click();
  await expect(page.locator('[data-flow-card="comment:c1"]')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.flow),
  ).not.toBe("flow");
});
