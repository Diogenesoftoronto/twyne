/**
 * Records the compact card, full conversation and gathered sheet for the
 * shared rich-note fixture, without asserting anything. It runs unchanged
 * against a tree before and after a renderer change, so the two sets of
 * screenshots and facts are comparable.
 *
 *   TWYNE_CAPTURE_URL=http://127.0.0.1:5197 TWYNE_CAPTURE_OUT=/tmp/before \
 *     bun e2e/compact-markdown-capture.ts
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  HOSTILE_NOTE,
  LONG_NOTE,
  RICH_NOTE,
  RICH_REPLY,
  STREAMING_REPLY,
} from "../src/utils/comment-markdown.fixtures";

const base = process.env.TWYNE_CAPTURE_URL ?? "http://127.0.0.1:5173";
const out = process.env.TWYNE_CAPTURE_OUT ?? "/tmp/twyne-compact-capture";
mkdirSync(out, { recursive: true });

async function seed(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__capture-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto(`${base}/__capture-seed`);
  await page.evaluate(
    async ({ rich, reply, long, hostile }) => {
      const idb = await import(/* @vite-ignore */ "/src/utils/idb.ts");
      const uc = await import(/* @vite-ignore */ "/src/utils/user-comments.ts");
      const now = Date.now(),
        id = "compact-markdown-fixture";
      await idb.saveFoliosToIdb([
        {
          id,
          name: "Salt Roads",
          type: "draft",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await idb.saveActiveFolioIdToIdb(id);
      const paras = Array.from(
        { length: 22 },
        // Distinct sentences, so the conductor finds no echo to put first.
        (_, i) =>
          `<p>${["Dawn", "Dust", "Mules", "Ropes", "Wells", "Gulls", "Tents", "Lamps", "Fords", "Hills", "Stars"][i % 11]} ${i + 1}: ${["a drover counted coins", "the wind changed twice", "someone sang off key", "water ran short at noon", "a child chased a goat"][i % 5]}.</p>`,
      );
      const mark = (cid: string, words: string) =>
        `<span class="twyne-comment-mark" data-comment-id="${cid}" data-comment-author="Editor">${words}</span>`;
      paras[2] = `<p>By the fourth day ${mark("rich", "the road forgot the sea entirely")} and turned inland.</p>`;
      paras[8] = `<p>At the ford ${mark("long", "the mules refused the water")} for a day.</p>`;
      paras[14] = `<p>Near the end ${mark("hostile", "the sea came back as a rumour")} among the drivers.</p>`;
      // A persona note whose reply the capture streams in, chunk by chunk.
      paras[18] = `<p>Late on <span data-persona-note-id="stream" data-persona-note-author="Marguerite" data-persona-note-color="#b0413e" data-persona-note-label="Rhythm" data-persona-note-note="Try the **rhythm** here." data-persona-note-quote="the drovers stopped talking">the drovers stopped talking</span> for good.</p>`;
      await idb.saveFolioContentToIdb(id, paras.join(""));
      const note = (
        cid: string,
        text: string,
        anchor: string,
        replies = [],
      ) => ({
        id: cid,
        folioId: id,
        text,
        author: "Editor",
        anchor,
        resolved: false,
        createdAt: now,
        updatedAt: now,
        replies,
      });
      await uc.saveUserComments([
        note("rich", rich, "the road forgot the sea entirely", [
          {
            id: "r1",
            author: "You",
            authorKind: "user",
            text: reply,
            createdAt: now,
          },
        ] as never),
        // A second note on the same passage, so the card can gather.
        note(
          "plain",
          "This is the turn the ending answers.",
          "the road forgot the sea entirely",
        ),
        note("long", long, "the mules refused the water"),
        note("hostile", hostile, "the sea came back as a rumour"),
      ]);
      await idb.saveMetaToIdb("flow-reading-enabled", true);
      await idb.saveMetaToIdb("signin-toast-dismissed", true);
      localStorage.setItem("living-desk-open", "false");
      localStorage.setItem(
        "twyne:editor:view:v1",
        JSON.stringify({ zenMode: false, compositorOpen: false }),
      );
    },
    {
      rich: RICH_NOTE,
      reply: RICH_REPLY,
      long: LONG_NOTE,
      hostile: HOSTILE_NOTE,
    },
  );
  await page.goto(`${base}/editor/`);
  await page
    .locator(".ProseMirror")
    .first()
    .getByText("the sea came back as a rumour")
    .waitFor({ timeout: 60_000 });
  // On a phone the margin is a dock, not a column, so the card may be hidden.
  await page
    .locator('[data-flow-card="comment:rich"]')
    .waitFor({ state: "attached", timeout: 30_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
}

/** Which cards the margin is showing, and what it is holding back. */
const shown = (page: Page) =>
  page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll("[data-flow-card]")).map((el) =>
      el.getAttribute("data-flow-card"),
    ),
    held: Array.from(document.querySelectorAll("button"))
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /more in the margin|Fewer/.test(t)),
  }));

/**
 * Let the conductor's first pass land (an echo arrives about a second after
 * load and can displace a note), then show everything the margin holds.
 */
async function settle(page: Page) {
  await page.waitForTimeout(2500);
  const more = page.getByRole("button", { name: /more in the margin/ });
  if (await more.count()) {
    await more.first().click();
    await page.waitForTimeout(800);
  }
}

async function reveal(page: Page, id: string, words: string) {
  await page
    .locator(".ProseMirror")
    .first()
    .getByText(words)
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return (await page.locator(`[data-flow-card="comment:${id}"]`).count()) > 0;
}

/** What a card's content actually is in the DOM, not how it looks. */
async function facts(page: Page, id: string) {
  const card = page.locator(`[data-flow-card="comment:${id}"]`);
  if (!(await card.count())) return "card not shown";
  return card.evaluate((card) => {
    const content = card.querySelector(
      ".flow-card__content, .flow-card__body",
    ) as HTMLElement | null;
    const reply = card.querySelector(".flow-card__reply") as HTMLElement | null;
    return {
      text: content?.innerText ?? null,
      reply: reply?.innerText ?? null,
      strong: card.querySelectorAll("strong:not(.flow-card__title)").length,
      em: card.querySelectorAll("em").length,
      code: card.querySelectorAll("code").length,
      listItems: card.querySelectorAll("li").length,
      links: Array.from(card.querySelectorAll("a[href]")).map((a) =>
        a.getAttribute("href"),
      ),
      linksInsideButton: card.querySelectorAll("button a").length,
      imgs: card.querySelectorAll("img:not(.persona-masthead img)").length,
      scripts: card.querySelectorAll("script").length,
      leakedAsterisks: /\*\*/.test(content?.innerText ?? ""),
    };
  });
}

const browser = await chromium.launch();
const results: Record<string, unknown> = { base };
const errors: string[] = [];
try {
  for (const [label, viewport, scale] of [
    ["desktop", { width: 1440, height: 900 }, 1],
    ["mobile-390", { width: 390, height: 844 }, 1],
    ["zoom-200", { width: 720, height: 450 }, 2],
  ] as const) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    page.setDefaultTimeout(15_000);
    await seed(page);
    const xss = () =>
      page.evaluate(
        () => (window as unknown as { __twyneXss?: number }).__twyneXss ?? 0,
      );
    const cards = page.locator(".flow-column--room");
    if (await cards.isVisible()) {
      await settle(page);
      results[`${label}:shown`] = await shown(page);
      const compact: Record<string, unknown> = {};
      for (const [id, words] of [
        ["long", "the mules refused the water"],
        ["hostile", "the sea came back as a rumour"],
        ["rich", "the road forgot the sea entirely"],
      ] as const) {
        if (!(await reveal(page, id, words))) {
          compact[id] = { shown: await shown(page), note: "card not shown" };
          continue;
        }
        const card = page.locator(`[data-flow-card="comment:${id}"]`);
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        compact[id] = await facts(page, id);
        await card.screenshot({ path: `${out}/${label}-compact-${id}.png` });
      }
      results[`${label}:compact`] = compact;
      // The full note, opened from the card the way a reader would.
      const rich = page.locator('[data-flow-card="comment:rich"]');
      const opener = rich
        .getByRole("button", {
          name: /Open the conversation|Open conversation/,
        })
        .or(rich.locator(".flow-card__body"))
        .first();
      await opener.click();
      const full = page.locator(".manuscript-comment-card");
      await full.waitFor({ timeout: 10_000 });
      results[`${label}:expanded`] = await full.evaluate((el) => ({
        strong: el.querySelectorAll(".comment-markdown strong").length,
        listItems: el.querySelectorAll(".comment-markdown li").length,
        links: Array.from(el.querySelectorAll(".comment-markdown a[href]")).map(
          (a) => a.getAttribute("href"),
        ),
      }));
      await full.screenshot({ path: `${out}/${label}-expanded-rich.png` });
      await page.keyboard.press("Escape");
      // The gathered sheet for the same note.
      const gather = rich.getByRole("button", { name: /together$/ });
      if (await gather.count()) {
        await gather.click();
        const sheet = page.getByRole("dialog");
        await sheet.waitFor({ timeout: 10_000 });
        results[`${label}:gathered`] = await sheet.evaluate((el) => ({
          strong: el.querySelectorAll(".passage-gather__notes strong").length,
          listItems: el.querySelectorAll(".passage-gather__notes li li").length,
          text: (el.querySelector(".passage-gather__notes") as HTMLElement)
            ?.innerText,
        }));
        await sheet.screenshot({ path: `${out}/${label}-gathered-rich.png` });
        await page.keyboard.press("Escape");
      } else {
        results[`${label}:gathered`] = "no gather control (single passage)";
      }
    } else {
      // On a phone the room is a dock holding the nearest card.
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${out}/${label}-page.png` });
      const chip = page.locator(".flow-dock__chip");
      if (await chip.count()) {
        await chip.click();
        const dock = page.locator(".flow-dock");
        await page.waitForTimeout(500);
        const docked = await dock
          .locator("[data-flow-card]")
          .getAttribute("data-flow-card")
          .catch(() => null);
        results[`${label}:dock`] = {
          card: docked,
          facts: docked?.startsWith("comment:")
            ? await facts(page, docked.slice("comment:".length))
            : "dock holds a non-note card",
          overflowsViewport: await dock.evaluate(
            (el) => el.getBoundingClientRect().right > window.innerWidth + 1,
          ),
        };
        await page.screenshot({ path: `${out}/${label}-dock.png` });
        // Keyboard: the note's own control is reachable inside the dock,
        // opening it keeps a reply typed into it, and Escape closes it.
        const open = dock.getByRole("button", { name: "Open conversation" });
        if (await open.count()) {
          await open.focus();
          await page.keyboard.press("Enter");
          const draft = page.getByRole("textbox", {
            name: "Reply as the writer",
          });
          await draft.fill("A draft that must survive");
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
          await page
            .locator(".flow-dock__chip")
            .click()
            .catch(() => undefined);
          await dock
            .getByRole("button", { name: "Open conversation" })
            .click()
            .catch(() => undefined);
          (results[`${label}:dock`] as Record<string, unknown>).keyboard = {
            draftKept: await draft
              .inputValue()
              .catch(() => "conversation did not reopen"),
          };
          await page.screenshot({ path: `${out}/${label}-dock-reopened.png` });
        }
      } else {
        results[`${label}:dock`] = "no dock chip";
      }
    }
    results[`${label}:xss`] = await xss();
    await context.close();
  }
  // A persona reply streaming into its card: every chunk renders, and the
  // card's height only grows while it streams and settles once it ends.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`stream: ${error.message}`));
    await seed(page);
    await settle(page);
    await reveal(page, "stream", "the drovers stopped talking");
    const card = page.locator('[data-flow-card="note:stream"]');
    const heights: number[] = [];
    const html: string[] = [];
    if (await card.count()) {
      for (const text of STREAMING_REPLY) {
        await page.evaluate(
          (text) =>
            window.dispatchEvent(
              new CustomEvent("twyne:persona-reply-stream", {
                detail: { noteId: "stream", text, author: "Marguerite" },
              }),
            ),
          text,
        );
        await page.waitForTimeout(250);
        heights.push(Math.round((await card.boundingBox())?.height ?? 0));
        html.push(
          await card
            .locator(".flow-card__reply-text")
            .innerHTML()
            .catch(() => "(no reply)"),
        );
        await card.screenshot({
          path: `${out}/stream-${heights.length}.png`,
        });
      }
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("twyne:persona-replying", {
            detail: { noteId: "stream", replying: false },
          }),
        ),
      );
      await page.waitForTimeout(400);
      heights.push(Math.round((await card.boundingBox())?.height ?? 0));
      await card.screenshot({ path: `${out}/stream-settled.png` });
    }
    results.stream = {
      shown: (await card.count()) > 0,
      heights,
      lastHtml: html.at(-1),
      leakedAsterisks: html.some((h) => h.includes("**")),
    };
    await context.close();
  }
} finally {
  await browser.close();
}
results.errors = errors;
writeFileSync(`${out}/facts.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
