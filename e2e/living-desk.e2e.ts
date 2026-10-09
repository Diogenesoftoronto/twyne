import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { LIVING_DESK_MANUSCRIPT } from "./fixtures/living-desk";

const panel = (page: Page) =>
  page.getByRole("complementary", { name: "The piece", exact: true });
const stance = (page: Page) => page.locator('[data-ld-card="stance"]');

test("@demo a readable take of the local revision workflow", async ({
  page,
  context,
}, info) => {
  await seed(page);
  // A second page starts a separate source recording after the fixture is ready.
  await page.close();
  const started = Date.now();
  const take = await context.newPage();
  const cues: { at: number; description: string }[] = [];
  const hold = async (description: string) => {
    cues.push({ at: (Date.now() - started) / 1000, description });
    // Intentional reading time in a reusable demo, never a readiness assertion.
    await take.waitForTimeout(2600);
  };
  await take.goto("/editor/");
  await expect(stance(take)).toContainText("3 editorial");
  await take.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await hold(
    "A fictional memoir beside The piece. Local rules have found patterns across the draft.",
  );
  await stance(take).locator(".ld-card__head").click();
  await expect(stance(take).locator(".ld-occrow__fix").first()).toBeVisible();
  await hold("Open the stance finding to inspect each editorial use of we.");
  await stance(take).locator(".ld-occrow__fix").first().hover();
  await expect(take.locator(".ld-ghost")).toHaveText("I");
  await hold(
    "Hover a fix to preview I on the page. The manuscript has not changed.",
  );
  await stance(take).locator(".ld-occrow__fix").first().click();
  await expect(stance(take)).toContainText("2 editorial");
  await hold(
    "Apply one fix. The sentence and local consistency measure update together.",
  );
  await take.locator(".ProseMirror > p").first().click();
  await take.keyboard.press("ControlOrMeta+z");
  await expect(stance(take)).toContainText("3 editorial");
  await hold("Undo restores the original sentence and count.");
  const naming = take.locator('[data-ld-card^="naming:"]');
  await naming.locator(".ld-card__head").click();
  await naming
    .getByRole("button", { name: "Hollis is a different name", exact: true })
    .click();
  await expect(naming).toHaveAttribute("data-state", "deliberate");
  await hold("Keep similar names distinct when that choice is intentional.");
  await take
    .locator('[data-ld-card^="presence:"] .ld-card__head')
    .first()
    .click();
  await expect(
    take.getByRole("table", { name: "Who appears in which section" }),
  ).toBeVisible();
  await hold(
    "Follow recurring names across sections with the presence table and page highlights.",
  );
  const video = take.video()!;
  await take.close();
  const path = info.outputPath("living-desk-master.webm");
  await video.saveAs(path);
  await info.attach("Clean source recording", {
    path,
    contentType: "video/webm",
  });
  const cuePath = info.outputPath("recording-cues.json");
  await writeFile(
    cuePath,
    JSON.stringify({ sample: "fictional", models: "none", cues }, null, 2),
  );
  await info.attach("Recording cues", {
    path: cuePath,
    contentType: "application/json",
  });
});

async function seed(page: Page) {
  // Each test has a fresh, signed-out browser context. Never seed a user's profile.
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__living-desk-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Sample manuscript</title>",
    }),
  );
  await page.goto("/__living-desk-seed");
  await page.evaluate(async (html) => {
    const path = "/src/utils/idb.ts";
    const db = await import(/* @vite-ignore */ path);
    const id = "living-desk-visual-sample";
    const now = Date.now();
    await db.saveFoliosToIdb([
      {
        id,
        name: "After the water",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.saveFolioContentToIdb(id, html);
    await db.saveActiveFolioIdToIdb(id);
    await db.saveMetaToIdb("live-review-enabled", false);
    await db.saveMetaToIdb("signin-toast-dismissed", true);
    localStorage.setItem("living-desk-open", "true");
    localStorage.setItem(
      "twyne:editor:view:v1",
      JSON.stringify({ zenMode: false, compositorOpen: false }),
    );
  }, LIVING_DESK_MANUSCRIPT);
  await page.goto("/editor/");
  await expect(stance(page)).toContainText("3 editorial");
  await expect(panel(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

async function draftText(page: Page) {
  return page.locator(".ProseMirror").evaluate((el) => {
    const draft = el.cloneNode(true) as HTMLElement;
    draft.querySelectorAll(".ld-ghost").forEach((ghost) => ghost.remove());
    return draft.textContent;
  });
}

test("preview, revise, undo and keep an intentional choice without a model", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await capture(page, info, "01-piece-overview");
  await expect(panel(page)).toHaveScreenshot("piece-overview.png");
  const manuscript = page.locator(".ProseMirror");
  const original = await draftText(page);
  await stance(page).locator(".ld-card__head").click();
  await expect(stance(page).locator(".ld-card__head")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await stance(page).locator(".ld-occrow__fix").first().hover();
  await expect(page.locator(".ld-ghost")).toHaveText("I");
  // Preview is a decoration. It must not change the saved editor document.
  expect(await draftText(page)).toBe(original);
  await capture(page, info, "02-preview");
  await stance(page).locator(".ld-occrow__fix").first().click();
  await expect(stance(page)).toContainText("2 editorial");
  await expect(manuscript.locator("p").nth(1)).toContainText("I argue");
  await expect(stance(page).locator(".ld-card__head")).toBeFocused();
  await capture(page, info, "03-revised");
  await manuscript.locator("p").first().click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(stance(page)).toContainText("3 editorial");
  await expect.poll(() => draftText(page)).toBe(original);
  await expect(page.locator(".ld-flash, .ld-delta")).toHaveCount(0);
  if (
    (await stance(page)
      .locator(".ld-card__head")
      .getAttribute("aria-expanded")) !== "true"
  ) {
    await stance(page).locator(".ld-card__head").click();
  }
  await stance(page)
    .getByRole("button", { name: "Make all 3 I", exact: true })
    .click();
  await expect(manuscript).not.toContainText("We argue");
  await expect(manuscript).not.toContainText("We believe");
  await expect(manuscript).not.toContainText("We think");
  // A group action is one history entry, and genuine plural uses survive it.
  await expect(manuscript).toContainText("We all carried boxes");
  await manuscript.locator("p").first().click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => draftText(page)).toBe(original);
  await expect(stance(page)).toContainText("3 editorial");

  const naming = page.locator('[data-ld-card^="naming:"]');
  await naming.locator(".ld-card__head").click();
  await naming
    .getByRole("button", { name: "Hollis is a different name", exact: true })
    .click();
  await expect(naming).toHaveAttribute("data-state", "deliberate");
  await capture(page, info, "04-deliberate");
  await page.reload();
  await expect(naming).toHaveAttribute("data-state", "deliberate");
  await naming.locator(".ld-card__head").click();
  await naming
    .getByRole("button", { name: "Check these again", exact: true })
    .click();
  await expect(naming).toHaveAttribute("data-state", "open");

  const presence = page.locator('[data-ld-card^="presence:"]').first();
  await presence.locator(".ld-card__head").click();
  await expect(
    page.getByRole("table", { name: "Who appears in which section" }),
  ).toBeVisible();
  await expect(
    page.locator('.ld-occ[data-ld-lens="presence"]'),
  ).not.toHaveCount(0);
  await capture(page, info, "05-presence");
  await page.keyboard.press("Escape");
  await expect(presence.locator(".ld-card__head")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open the piece", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

for (const theme of ["editorial", "broadsheet", "foolscap", "nightpress"]) {
  test(`desk stays beside the manuscript in ${theme}`, async ({
    page,
  }, info) => {
    await seed(page);
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    const desk = (await panel(page).boundingBox())!;
    const text = (await page.locator(".ProseMirror").boundingBox())!;
    expect(desk.x + desk.width).toBeLessThan(text.x);
    expect(desk.y).toBeGreaterThan(100);
    expect(desk.y + desk.height).toBeLessThan(900);
    await expect(panel(page)).toHaveScreenshot(`piece-${theme}.png`);
    await capture(page, info, `desktop-${theme}`);
  });
}

for (const width of [390, 320]) {
  test(`the piece fits a ${width}px screen and returns to writing`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await seed(page);
    const desk = (await panel(page).boundingBox())!;
    expect(desk.x).toBeGreaterThanOrEqual(0);
    expect(desk.x + desk.width).toBeLessThanOrEqual(width);
    expect(desk.y).toBeGreaterThan(300);
    expect(desk.y + desk.height).toBeLessThanOrEqual(844);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(panel(page)).toHaveScreenshot(`piece-mobile-${width}.png`);
    await capture(page, info, `mobile-${width}`);
    await panel(page)
      .getByRole("button", { name: "Close the desk", exact: true })
      .click();
    await expect(panel(page)).toBeHidden();
    const paragraph = page.locator(".ProseMirror > p").first();
    await paragraph.click();
    await page.keyboard.press("Home");
    await page.keyboard.insertText("After the rain, ");
    await expect(paragraph).toContainText("After the rain,");
  });
}

test("deliberate editorial we persists and only a new occurrence becomes drift", async ({
  page,
}) => {
  await seed(page);
  const manuscript = page.locator(".ProseMirror");
  const plural = "We all carried boxes from the school to the dry upper rooms.";
  const quoted = "A witness said, “We argue that the river forgets nothing.”";
  const added = "We argue that the new waterline deserves another record.";
  const original = await draftText(page);
  const appendParagraph = async (text: string) => {
    await manuscript.locator("p").last().click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(text);
    await expect(manuscript.locator("p").last()).toHaveText(text);
  };
  // Add a quoted source through ordinary editor input so the mission also
  // protects quoted editorial wording rather than relying on a nonexistent quote.
  await appendParagraph(quoted);
  await expect(stance(page)).toContainText("3 editorial");
  await expect(page.getByText(/^Saved /)).toBeVisible();
  const acceptedDraft = await draftText(page);
  expect(acceptedDraft).toBe(`${original}${quoted}`);
  await stance(page).locator(".ld-card__head").click();
  await stance(page)
    .getByRole("button", { name: "The mix is deliberate", exact: true })
    .click();
  await expect(stance(page)).toHaveAttribute("data-state", "deliberate");
  await expect(stance(page)).toContainText("Twyne will flag only new drift.");
  await expect(stance(page).locator(".ld-occrow__fix")).toHaveCount(0);
  expect(await draftText(page)).toBe(acceptedDraft);

  await page.reload();
  await expect(stance(page)).toHaveAttribute("data-state", "deliberate");
  await expect.poll(() => draftText(page)).toBe(acceptedDraft);
  await stance(page).locator(".ld-card__head").click();
  await expect(stance(page)).toContainText("Twyne will flag only new drift.");
  await expect(stance(page).locator(".ld-occrow__fix")).toHaveCount(0);

  await appendParagraph(added);
  await expect(stance(page)).toHaveAttribute("data-state", "open");
  await expect(stance(page)).toContainText(
    "1 new exception · existing uses kept on purpose",
  );
  if (
    (await stance(page)
      .locator(".ld-card__head")
      .getAttribute("aria-expanded")) !== "true"
  )
    await stance(page).locator(".ld-card__head").click();
  const flagged = stance(page).locator(".ld-occrow:not(.is-context)");
  await expect(flagged).toHaveCount(1);
  await expect(flagged).toContainText(
    "the new waterline deserves another record",
  );
  await expect(
    flagged.getByRole("button", { name: "Make it I", exact: true }),
  ).toBeVisible();
  await expect(stance(page).locator(".ld-occrow__fix")).toHaveCount(1);
  await stance(page)
    .locator(".ld-context-disclosure")
    .filter({ hasText: /plural uses left alone/ })
    .locator("summary")
    .click();
  const kept = stance(page)
    .locator(".ld-occrow.is-context")
    .filter({ hasText: "Kept on purpose" });
  await expect(kept).toHaveCount(3);
  await expect(kept).toContainText([
    "memory begins in places like this",
    "the river keeps a record",
    "the town will remember this differently",
  ]);
  await expect(manuscript).toContainText(plural);
  await expect(manuscript.locator("p").nth(7)).toHaveText(quoted);
  expect(await draftText(page)).toBe(`${acceptedDraft}${added}`);
});
