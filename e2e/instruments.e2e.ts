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
    ".in-flow-rail:has(.sentence-bench), .in-flow-dock:has(.sentence-bench)",
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
  // Cold development hydration imports the editor before this functional mission starts.
  await expect(manuscript(page)).toContainText(INSTRUMENT_SENTENCE, {
    timeout: 60_000,
  });
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
    .getByRole("button", { name: "Compare a revision", exact: true })
    .click();
  await expect(bench(page)).toBeVisible();
}
const revision = (page: Page) =>
  bench(page).getByRole("textbox", { name: "Your revision" });
const useRevision = (page: Page) =>
  bench(page).getByRole("button", { name: "Use revision", exact: true });
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

test("Compare a revision opens cold with no request, diffs in context, applies once and undoes once", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /api\.(openai|anthropic)|generativelanguage|openrouter/.test(
        request.url(),
      )
    )
      providerRequests.push(request.url());
  });
  await seed(page);
  const original = await manuscript(page).innerHTML();
  const originalText = await draftText(page);
  await openBench(page);
  // Cold start: the original, an editable copy and the paragraph, no list.
  await expect(bench(page).locator(".sentence-bench-original")).toHaveText(
    INSTRUMENT_SENTENCE,
  );
  await expect(revision(page)).toHaveValue(INSTRUMENT_SENTENCE);
  await expect(revision(page)).toBeFocused();
  await expect(bench(page)).toContainText("The old map remained.");
  await expect(bench(page)).toContainText("We followed the river.");
  await expect(bench(page).locator(".in-flow-choice")).toHaveCount(0);
  await expect(useRevision(page)).toBeDisabled();
  expect(await draftText(page)).toBe(originalText);

  const trial = "We left to find a quiet room.";
  await revision(page).fill(trial);
  await expect(
    bench(page).locator(".sentence-bench-paragraph del").first(),
  ).toContainText("made a decision");
  await expect(
    bench(page).locator(".sentence-bench-paragraph ins").first(),
  ).toContainText("left");
  await bench(page)
    .getByRole("button", { name: "Revision", exact: true })
    .click();
  await expect(bench(page).locator(".sentence-bench-slot-text")).toHaveText(
    trial,
  );
  await bench(page)
    .getByRole("button", { name: "Original", exact: true })
    .click();
  await expect(bench(page).locator(".sentence-bench-slot-text")).toHaveText(
    INSTRUMENT_SENTENCE,
  );
  await bench(page)
    .getByRole("button", { name: "Changes", exact: true })
    .click();
  expect(await draftText(page)).toBe(originalText);
  await capture(page, info, "01-compare-a-revision");
  await expect(benchHost(page)).toHaveScreenshot("sentence-bench-desktop.png");

  await useRevision(page).click();
  await expect(bench(page)).toHaveCount(0);
  await expect(manuscript(page).locator("p").first()).toHaveText(
    `The old map remained. ${trial} We followed the river.`,
  );
  await expect(
    manuscript(page).locator("p").first().locator("strong"),
  ).toHaveText(trial);
  await expect(manuscript(page)).toBeFocused();
  await capture(page, info, "02-revision-used");
  await undo(page);
  await expect.poll(() => manuscript(page).innerHTML()).toBe(original);
  expect(providerRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("Keep original and Escape close without editing; fragments are allowed", async ({
  page,
}) => {
  await seed(page);
  const original = await manuscript(page).innerHTML();
  await openBench(page);
  await revision(page).fill("a quieter room");
  await expect(useRevision(page)).toBeEnabled();
  await expect(bench(page)).toContainText(
    "Fragments and more than one sentence are fine.",
  );
  await page.keyboard.press("Escape");
  await expect(bench(page)).toHaveCount(0);
  await expect(manuscript(page)).toBeFocused();
  expect(await manuscript(page).innerHTML()).toBe(original);
  await openBench(page);
  await expect(revision(page)).toHaveValue(INSTRUMENT_SENTENCE);
  await revision(page).fill("We left.");
  await bench(page)
    .getByRole("button", { name: "Keep original", exact: true })
    .click();
  await expect(bench(page)).toHaveCount(0);
  expect(await manuscript(page).innerHTML()).toBe(original);
});

test("a source edit blocks use and keeps the revision copyable", async ({
  page,
}) => {
  await seed(page);
  await openBench(page);
  await revision(page).fill("We left for a quieter room.");
  // Change the paragraph behind the open bench.
  await manuscript(page).evaluate((root) => {
    const p = root.querySelector("p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.collapse(true);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.type("Then ");
  await expect(bench(page)).toContainText("Your revision is kept here");
  await expect(useRevision(page)).toBeDisabled();
  await expect(revision(page)).toHaveValue("We left for a quieter room.");
  await expect(
    bench(page).getByRole("button", { name: "Copy revision", exact: true }),
  ).toBeVisible();
  await expect(manuscript(page)).toContainText(
    `Then The old map remained. ${INSTRUMENT_SENTENCE}`,
  );
});

test("a multi-sentence selection is refused, not narrowed", async ({
  page,
}) => {
  await seed(page);
  const original = await manuscript(page).innerHTML();
  await openBench(page, `remained. ${INSTRUMENT_SENTENCE.slice(0, 20)}`);
  await expect(bench(page)).toContainText("covers 2 sentences");
  await expect(revision(page)).toHaveCount(0);
  await bench(page).getByRole("button", { name: "Close", exact: true }).click();
  expect(await manuscript(page).innerHTML()).toBe(original);
});

test("Read the difference without a provider says so and sends nothing", async ({
  page,
}) => {
  await seed(page);
  await openBench(page);
  await revision(page).fill("We left for a quieter room.");
  await bench(page)
    .getByRole("button", { name: "Read the difference", exact: true })
    .click();
  await expect(bench(page)).toContainText(
    "needs a prose model connected in Settings",
  );
  await expect(useRevision(page)).toBeEnabled();
  await expect(revision(page)).toHaveValue("We left for a quieter room.");
});

test("Hear starts the narration player for an unfinished revision", async ({
  page,
}) => {
  await seed(page);
  await openBench(page);
  await revision(page).fill("We left for a quieter room");
  await bench(page)
    .getByRole("button", { name: "Hear it in context", exact: true })
    .click();
  // This fixture has no voice provider. The real player must report its
  // configuration error rather than silently ignoring unfinished wording.
  await expect(bench(page)).toContainText(
    "Narration needs attention in player",
  );
  await expect(manuscript(page)).toContainText(INSTRUMENT_SENTENCE);
});

test("Threads uses real spans, removes a repeat, undoes and closes with Escape", async ({
  page,
}, info) => {
  await seed(page);
  const original = await draftText(page);
  await selectPassage(page, INSTRUMENT_REPEAT);
  await page.getByRole("button", { name: "More", exact: false }).click();
  await page.getByRole("menuitem", { name: "Threads", exact: true }).click();
  await expect(threads(page)).toBeVisible();
  const repeat = threads(page)
    .locator("li")
    .filter({ hasText: "Repeated wording" });
  await expect(repeat).toContainText(INSTRUMENT_REPEAT);
  await repeat.hover();
  await expect(page.locator(".twyne-thread-span")).toHaveCount(2);
  // Hover scrolls this overflow panel to the pair; capture the instrument's header too.
  await threads(page).evaluate((panel) => {
    panel.scrollTop = 0;
  });
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
  await page.getByRole("button", { name: "More", exact: false }).click();
  await page.getByRole("menuitem", { name: "Threads", exact: true }).click();
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
              active.textContent?.trim().startsWith("More")))
        );
      }),
    )
    .toBe(true);
});

test("Threads gathers a pair as read-only excerpts, jumps to one and keeps Threads open", async ({
  page,
}) => {
  await seed(page);
  const original = await draftText(page);
  await selectPassage(page, INSTRUMENT_REPEAT);
  await page.getByRole("button", { name: "More", exact: false }).click();
  await page.getByRole("menuitem", { name: "Threads", exact: true }).click();
  const repeat = threads(page)
    .locator("li")
    .filter({ hasText: "Repeated wording" });
  await repeat
    .getByRole("button", { name: "See together", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator(".passage-gather__passage")).toHaveCount(2);
  await expect(sheet.locator("mark").first()).toHaveText(INSTRUMENT_REPEAT);
  await expect(sheet).toContainText("This was our only trace.");
  await sheet
    .getByRole("button", { name: "Go to passage", exact: true })
    .nth(1)
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(threads(page)).toBeVisible();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    INSTRUMENT_REPEAT,
  );
  expect(await draftText(page)).toBe(original);
  // Escape closes a gathering before it closes Threads.
  await repeat
    .getByRole("button", { name: "See together", exact: true })
    .click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(threads(page)).toBeVisible();
});

test("sentence and thread controls remain reachable on a narrow viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openBench(page);
  await revision(page).fill(
    "We left, eventually, to find a very quiet room above the shop where nobody would think to ask what the ledger held.",
  );
  await expect(useRevision(page)).toBeInViewport();
  const sheet = await benchHost(page).boundingBox();
  expect(sheet!.x).toBeGreaterThanOrEqual(0);
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(390);
  expect(
    await bench(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await capture(page, info, "06-narrow-sentence-bench");
  await expect(benchHost(page)).toHaveScreenshot(
    "sentence-bench-mobile-390.png",
  );
  await selectPassage(page, INSTRUMENT_REPEAT);
  await page.getByRole("button", { name: "More", exact: false }).click();
  await page.getByRole("menuitem", { name: "Threads", exact: true }).click();
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
  await hold("Select a sentence and choose Compare a revision.");
  await revision(take).fill("We decided to leave to find a quiet room.");
  await expect(
    bench(take).locator(".sentence-bench-paragraph ins").first(),
  ).toContainText("decided");
  await hold("Edit a copy. The changes show inside the paragraph.");
  await useRevision(take).click();
  await expect(manuscript(take)).toContainText("We decided");
  await hold("Use the revision. The change lands in the manuscript.");
  await undo(take);
  await hold("Undo restores the original wording.");
  await selectPassage(take, INSTRUMENT_REPEAT);
  await take.getByRole("button", { name: "More", exact: false }).click();
  await take.getByRole("menuitem", { name: "Threads", exact: true }).click();
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
