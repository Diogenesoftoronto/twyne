import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import {
  INSTRUMENT_MANUSCRIPT,
  INSTRUMENT_REPEAT,
  INSTRUMENT_SENTENCE,
} from "./fixtures/instruments";

const manuscript = (page: Page) => page.locator(".ProseMirror").first();
const bench = (page: Page) => page.locator(".sentence-bench");
const benchHost = (page: Page) =>
  page.locator(
    ".in-flow-rail:has(.sentence-bench), .in-flow-popover:has(.sentence-bench)",
  );
const threads = (page: Page) =>
  page.getByRole("complementary", { name: "Threads", exact: true });
async function seed(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__instruments-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Fictional instrument manuscript</title>",
    }),
  );
  await page.goto("/__instruments-seed");
  await page.evaluate(async (html) => {
    const path = "/src/utils/idb.ts";
    const db = await import(/* @vite-ignore */ path);
    const now = Date.now(),
      id = "offline-instruments-fixture";
    await db.saveFoliosToIdb([
      {
        id,
        name: "The map and the ledger",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.saveFolioContentToIdb(id, html);
    await db.saveActiveFolioIdToIdb(id);
    await db.saveMetaToIdb("live-review-enabled", false);
    await db.saveMetaToIdb("signin-toast-dismissed", true);
    localStorage.setItem("living-desk-open", "false");
    localStorage.setItem(
      "twyne:editor:view:v1",
      JSON.stringify({ zenMode: false, compositorOpen: false }),
    );
  }, INSTRUMENT_MANUSCRIPT);
  await page.goto("/editor/");
  await expect(manuscript(page)).toContainText(INSTRUMENT_SENTENCE);
  await page.evaluate(() => document.fonts.ready);
}

/** Set up a native browser selection, then use only the visible action UI. */
async function selectPassage(page: Page, text: string) {
  await manuscript(page).evaluate((root, text) => {
    (root as HTMLElement).focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let plain = "",
      node: Node | null;
    while ((node = walker.nextNode())) {
      nodes.push(node as Text);
      plain += node.textContent ?? "";
    }
    const start = plain.indexOf(text);
    if (start < 0) throw new Error(`Passage is absent: ${text}`);
    const range = document.createRange();
    let offset = 0,
      began = false;
    for (const node of nodes) {
      const end = offset + node.length;
      if (!began && start >= offset && start < end) {
        range.setStart(node, start - offset);
        began = true;
      }
      if (began && start + text.length <= end) {
        range.setEnd(node, start + text.length - offset);
        break;
      }
      offset = end;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
  await expect(
    page.getByRole("toolbar", { name: /^Actions for/ }),
  ).toBeVisible();
}
async function openBench(page: Page, text = INSTRUMENT_SENTENCE) {
  await selectPassage(page, text);
  await page
    .getByRole("button", { name: "Sentence bench", exact: true })
    .click();
  await expect(bench(page)).toBeVisible();
}
async function draftText(page: Page) {
  return manuscript(page).evaluate((root) => {
    const copy = root.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(".sentence-bench-ghost,.ld-ghost")
      .forEach((n) => n.remove());
    return copy.textContent;
  });
}
async function undo(page: Page) {
  await manuscript(page).focus();
  await page.keyboard.press("ControlOrMeta+z");
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

test("selection bench offers checked complete wordings, previews, applies and undoes offline", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const original = await draftText(page);
  await openBench(page);
  const candidate = bench(page).getByRole("button", {
    name: /^Compare Use a verb:/,
  });
  await expect(candidate).toBeVisible();
  await expect(bench(page)).toContainText("Harper checked");
  await candidate.hover();
  await expect(page.locator(".sentence-bench-ghost")).toContainText(
    "We decided to leave",
  );
  expect(await draftText(page)).toBe(original);
  await capture(page, info, "01-complete-wording-preview");
  await expect(benchHost(page)).toHaveScreenshot("sentence-bench-desktop.png");
  await candidate.click();
  await expect(bench(page).locator("textarea")).toHaveValue(
    "We decided to leave in order to find a very quiet room.",
  );
  await bench(page)
    .getByRole("button", { name: "Use this wording", exact: true })
    .click();
  await expect(manuscript(page)).toContainText("We decided to leave");
  await expect(bench(page)).toHaveCount(0);
  await capture(page, info, "02-wording-used");
  await undo(page);
  await expect.poll(() => draftText(page)).toBe(original);
  expect(errors).toEqual([]);
});

test("Words changes one use in context and Place preserves marked text with one undo", async ({
  page,
}, info) => {
  await seed(page);
  const original = await manuscript(page).innerHTML();
  await openBench(page);
  await bench(page).getByRole("button", { name: "Words", exact: true }).click();
  await bench(page).getByRole("button", { name: "quiet", exact: true }).click();
  await bench(page)
    .locator(".in-flow-choice")
    .filter({ hasText: "no sound" })
    .click();
  await expect(bench(page).locator("textarea")).toHaveValue(
    INSTRUMENT_SENTENCE.replace("quiet", "silent"),
  );
  await capture(page, info, "03-word-alternatives-in-context");
  await bench(page)
    .getByRole("button", { name: "Keep original", exact: true })
    .click();
  await bench(page)
    .locator(".in-flow-choice")
    .filter({ hasText: "no sound" })
    .click();
  await bench(page)
    .getByRole("button", { name: "Use this wording", exact: true })
    .click();
  await expect(manuscript(page)).toContainText(
    INSTRUMENT_SENTENCE.replace("quiet", "silent"),
  );
  await undo(page);
  await expect.poll(() => manuscript(page).innerHTML()).toBe(original);
  await openBench(page);
  await bench(page).getByRole("button", { name: "Place", exact: true }).click();
  const opening = bench(page)
    .locator(".sentence-bench-slot")
    .filter({ hasText: "Try it as the opening sentence." });
  await capture(page, info, "04-placement-comparison");
  await opening.getByRole("button", { name: "Move here", exact: true }).click();
  await expect(manuscript(page).locator("p").first()).toHaveText(
    `${INSTRUMENT_SENTENCE} The old map remained. We followed the river.`,
  );
  await expect(
    manuscript(page).locator("p").first().locator("strong"),
  ).toHaveText(INSTRUMENT_SENTENCE);
  await undo(page);
  await expect.poll(() => manuscript(page).innerHTML()).toBe(original);
});

test("Threads uses real spans, removes a repeat, undoes and closes with Escape", async ({
  page,
}, info) => {
  await seed(page);
  const original = await draftText(page);
  await selectPassage(page, INSTRUMENT_REPEAT);
  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await expect(threads(page)).toBeVisible();
  const repeat = threads(page)
    .locator("li")
    .filter({ hasText: "Repeated wording" });
  await expect(repeat).toContainText(INSTRUMENT_REPEAT);
  await repeat.hover();
  await expect(page.locator(".twyne-thread-span")).toHaveCount(2);
  await capture(page, info, "05-real-span-thread");
  await expect(threads(page)).toHaveScreenshot("threads-desktop.png");
  await repeat
    .getByRole("button", { name: "Remove second occurrence", exact: true })
    .click();
  await expect(manuscript(page).locator("p").nth(1)).toHaveText(
    `${INSTRUMENT_REPEAT} This was our only trace.`,
  );
  await undo(page);
  await expect.poll(() => draftText(page)).toBe(original);
  await selectPassage(page, INSTRUMENT_REPEAT);
  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await expect(threads(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(threads(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return (
          !!active &&
          (active.matches(".ProseMirror") ||
            (active instanceof HTMLButtonElement &&
              active.textContent?.trim() === "Threads"))
        );
      }),
    )
    .toBe(true);
});

test("sentence and thread controls remain reachable on a narrow viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openBench(page);
  await expect(
    bench(page).getByRole("button", { name: "Words", exact: true }),
  ).toBeInViewport();
  await bench(page).getByRole("button", { name: "Words", exact: true }).click();
  await capture(page, info, "06-narrow-sentence-bench");
  await expect(benchHost(page)).toHaveScreenshot(
    "sentence-bench-mobile-390.png",
  );
  await selectPassage(page, INSTRUMENT_REPEAT);
  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await expect(threads(page)).toBeVisible();
  const box = await threads(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(845);
  await capture(page, info, "07-narrow-threads");
  await expect(threads(page)).toHaveScreenshot("threads-mobile-390.png");
});

test("@demo complete sentence and real span revision in a readable offline take", async ({
  page,
  context,
}, info) => {
  await seed(page);
  await page.close();
  const take = await context.newPage();
  const started = Date.now(),
    cues: Array<{ at: number; description: string }> = [];
  const hold = async (description: string) => {
    cues.push({ at: (Date.now() - started) / 1000, description });
    await take.waitForTimeout(2200);
  };
  await take.goto("/editor/");
  await expect(manuscript(take)).toContainText(INSTRUMENT_SENTENCE);
  await hold(
    "A fictional manuscript. No prose or judgement model is connected.",
  );
  await openBench(take);
  await hold("Select a complete sentence and open its bench.");
  const wording = bench(take).getByRole("button", {
    name: /^Compare Use a verb:/,
  });
  await wording.hover();
  await expect(take.locator(".sentence-bench-ghost")).toContainText(
    "We decided",
  );
  await hold(
    "Preview a complete local wording between its actual neighbouring sentences.",
  );
  await wording.click();
  await bench(take)
    .getByRole("button", { name: "Use this wording", exact: true })
    .click();
  await expect(manuscript(take)).toContainText("We decided");
  await hold("Use the checked wording. The change lands in the manuscript.");
  await undo(take);
  await hold("Undo restores the original wording.");
  await selectPassage(take, INSTRUMENT_REPEAT);
  await take.getByRole("button", { name: "Threads", exact: true }).click();
  const repeat = threads(take)
    .locator("li")
    .filter({ hasText: "Repeated wording" });
  await repeat.hover();
  await expect(take.locator(".twyne-thread-span")).toHaveCount(2);
  await hold(
    "Threads connects two real manuscript spans. The repeat is local evidence.",
  );
  await repeat
    .getByRole("button", { name: "Remove second occurrence", exact: true })
    .click();
  await hold("Remove one literal repeated sentence, with undo available.");
  const video = take.video();
  await take.close();
  if (video) {
    const path = info.outputPath("instruments-master.webm");
    await video.saveAs(path);
    await info.attach("Readable source take", {
      path,
      contentType: "video/webm",
    });
  }
  const cuePath = info.outputPath("instruments-cues.json");
  await writeFile(
    cuePath,
    JSON.stringify({ sample: "fictional", models: "none", cues }, null, 2),
  );
  await info.attach("Recording cues", {
    path: cuePath,
    contentType: "application/json",
  });
});
