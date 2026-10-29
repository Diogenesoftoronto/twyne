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

/** Whole paragraphs of the fixture, as the conductor anchors an echo. */
const TURN =
  "By the fourth day the road forgot the sea entirely and turned inland.";
const RUMOUR = "Near the end the sea came back as a rumour among the drivers.";
const PARA_5 =
  "Paragraph 5: the salt caravans left before dawn, and the road bent with the coast for a week of walking.";

interface EchoFixture {
  id: string;
  anchors: string[];
  shared: string[];
  /** The relation Jev chose; omitted for a word match it never read. */
  reading?: string;
  /** Store nothing at all, as an echo recorded without a reason. */
  bare?: boolean;
}

/**
 * Show echoes as the conductor records them, built by its own functions.
 * The conductor's clock is held so it cannot republish over them, the way
 * the focus test below holds it; no judgement is asked for.
 */
async function showEchoes(page: Page, echoes: EchoFixture[]) {
  await page.evaluate(async (echoes) => {
    const path = "/src/components/editor/extensions/flow-conductor.ts";
    const flow = await import(/* @vite-ignore */ path);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    const visible = echoes.map((e) => ({
      id: e.id,
      kind: "echo",
      anchors: e.anchors,
      title: "Further on in this piece",
      body: e.anchors[e.anchors.length - 1],
      byline: `Shares ${e.shared.join(", ")}`,
      createdAt: Date.now(),
      relevance: 0.8,
      folioId: "connections-fixture",
      ...(e.bare
        ? {}
        : {
            data: flow.echoData(
              e.shared,
              flow.echoReading(e.reading, e.shared),
              e.anchors[0],
            ),
          }),
    }));
    window.dispatchEvent(
      new CustomEvent(flow.FLOW_EVENT, {
        detail: {
          ...flow.flowSnapshot(),
          enabled: true,
          mode: "working",
          visible,
          held: 0,
          heldKinds: {},
        },
      }),
    );
  }, echoes);
  // The margin places new cards at a guessed height and only measures them
  // on its next layout; ask for one once they exist, as a scroll would.
  // On a phone the dock holds them behind a chip until it is opened.
  for (const echo of echoes)
    await page
      .locator(`[data-flow-card="${echo.id}"], .flow-dock__chip`)
      .first()
      .waitFor({ state: "attached" });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("twyne:flow-layout")),
  );
  await page.waitForTimeout(400);
}

/** Every request after this call that could reach a model or a backend. */
function watchRequests(page: Page) {
  const seen: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "GET" && url.startsWith(origin)) return;
    seen.push(`${request.method()} ${url}`);
  });
  return seen;
}

const SEMANTIC: EchoFixture = {
  id: "echo:fixture-rumour",
  anchors: [TURN, RUMOUR],
  shared: ["sea"],
  reading: "Unpaid promise",
};
const LEXICAL: EchoFixture = {
  id: "echo:fixture-road",
  anchors: [TURN, PARA_5],
  shared: ["road"],
};
const SEMANTIC_REASON =
  "One passage sets something up that the other could pay off, and it may not have been paid off yet. Both mention sea.";
const LEXICAL_REASON =
  "These passages share road. Twyne matched the words; nobody has read them for meaning yet.";

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

test("a connection keeps its recorded reason from the card into the sheet, by click and keyboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const original = await manuscriptText(page);
  await showEchoes(page, [SEMANTIC, LEXICAL]);
  const requests = watchRequests(page);

  // The card says why, and whether that is a reading or only shared words.
  const semantic = page.locator(`[data-flow-card="${SEMANTIC.id}"]`);
  const lexical = page.locator(`[data-flow-card="${LEXICAL.id}"]`);
  await expect(semantic.locator(".flow-relation__why").first()).toHaveText(
    `Unpaid promise Twyne's reading${SEMANTIC_REASON}`,
  );
  await expect(lexical.locator(".flow-relation__why").first()).toHaveText(
    `Shared words Word match${LEXICAL_REASON}`,
  );

  // Opening the sheet carries the same words, for both connections on the
  // shared passage, and names the passages each one joins.
  const compare = semantic.getByRole("button", { name: "Compare passages" });
  await compare.click();
  const sheet = page.getByRole("dialog");
  const why = sheet.getByRole("region", {
    name: "Why these passages are linked",
  });
  await expect(why).toBeVisible();
  const reading = why.locator('[data-provenance="reading"]');
  const words = why.locator('[data-provenance="shared-words"]');
  await expect(reading).toContainText("Unpaid promise");
  await expect(reading).toContainText("Twyne's reading");
  await expect(reading).toContainText(SEMANTIC_REASON);
  await expect(words).toContainText("Shared words");
  await expect(words).toContainText("Word match");
  await expect(words).toContainText(LEXICAL_REASON);
  // Passages in reading order: the turn, paragraph 5, then the rumour.
  await expect(reading.locator(".passage-gather__between")).toHaveText(
    "Passages 1 and 3",
  );
  await expect(words.locator(".passage-gather__between")).toHaveText(
    "Passages 1 and 2",
  );
  await expect(sheet.locator(".passage-gather__reason-stale")).toHaveCount(0);
  // An echo's other passage is gathered, not repeated as a note on it.
  await expect(sheet.locator(".passage-gather__notes li")).not.toContainText([
    RUMOUR,
  ]);
  await expect(sheet.locator("mark").nth(2)).toHaveText(RUMOUR);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(compare).toBeFocused();

  // The keyboard reaches the same reason.
  await compare.press("Enter");
  await expect(why.locator('[data-provenance="reading"]')).toContainText(
    SEMANTIC_REASON,
  );
  // Go to passage leaves the sheet and lands on the passage it names.
  await sheet
    .locator('[data-gather-passage="echo:fixture-rumour:1"]')
    .getByRole("button", { name: "Go to passage" })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(RUMOUR);

  // Reading the reason asked nothing of a model, and changed nothing.
  expect(requests).toEqual([]);
  expect(await manuscriptText(page)).toBe(original);
  expect(errors).toEqual([]);
});

test("a connection with no recorded reason says so instead of inventing one", async ({
  page,
}) => {
  await seed(page);
  await showEchoes(page, [
    { ...SEMANTIC, id: "echo:fixture-bare", bare: true },
  ]);
  const requests = watchRequests(page);
  const card = page.locator('[data-flow-card="echo:fixture-bare"]');
  await expect(card.locator(".flow-relation__why").first()).toHaveText(
    "Connection No reason recordedTwyne found these passages together but did not record why.",
  );
  await card.getByRole("button", { name: "Compare passages" }).click();
  const reason = page
    .getByRole("dialog")
    .locator('.passage-gather__reason[data-provenance="unrecorded"]');
  await expect(reason).toContainText("No reason recorded");
  await expect(reason).toContainText(
    "Twyne found these passages together but did not record why.",
  );
  await expect(reason).not.toContainText("Unpaid promise");
  expect(requests).toEqual([]);
});

test("a connection whose passage changed is flagged, and its reason kept", async ({
  page,
}) => {
  await seed(page);
  const original = await manuscriptText(page);
  // Recorded against wording the manuscript no longer has.
  await showEchoes(page, [
    { ...SEMANTIC, id: "echo:fixture-stale", anchors: [TURN, "Gone words."] },
  ]);
  const card = page.locator('[data-flow-card="echo:fixture-stale"]');
  await expect(card.locator(".flow-relation__why").first()).toContainText(
    SEMANTIC_REASON,
  );
  // Only the passage still in the text is gathered; the reason stays.
  await card.getByRole("button", { name: "Compare passages" }).click();
  const reason = page
    .getByRole("dialog")
    .locator('.passage-gather__reason[data-provenance="reading"]');
  await expect(reason).toContainText(SEMANTIC_REASON);
  await expect(reason.locator(".passage-gather__between")).toHaveText(
    "Passage 1",
  );
  await expect(reason.locator(".passage-gather__reason-stale")).toHaveText(
    "The other passage has changed since this connection was found.",
  );
  expect(await manuscriptText(page)).toBe(original);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("on a phone the docked connection carries its reason into the sheet without hover", async ({
    page,
  }) => {
    // Seed while wide enough to expose the card, then collapse to the dock.
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await showEchoes(page, [SEMANTIC]);
    const requests = watchRequests(page);
    const dock = page.getByRole("complementary", {
      name: "From the margin",
      exact: true,
    });
    await dock.getByRole("button", { name: /from the room.*Open/ }).tap();
    const card = dock.locator(`[data-flow-card="${SEMANTIC.id}"]`);
    await expect(card.locator(".flow-relation__why").first()).toContainText(
      SEMANTIC_REASON,
    );
    await card.getByRole("button", { name: "Compare passages" }).tap();
    const why = page
      .getByRole("dialog")
      .getByRole("region", { name: "Why these passages are linked" });
    await expect(why).toContainText(SEMANTIC_REASON);
    await expect(why).toContainText("Twyne's reading");
    const box = await why.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    expect(requests).toEqual([]);
  });
});
