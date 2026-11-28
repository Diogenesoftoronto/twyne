import { expect, test, type Locator, type Page } from "@playwright/test";

/** Fictional notes on a long manuscript: two on one early passage, one late. */
async function seed(page: Page, rewrite: Record<number, string> = {}) {
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
  await page.evaluate(async (rewrite) => {
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
    for (const [index, text] of Object.entries(rewrite)) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      paras[Number(index)] = paragraph.outerHTML;
    }
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
  }, rewrite);
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
  otherFolio?: { id: string; name: string; text: string };
  /** What the decision model would do with the pair. */
  advice?: string;
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
      title: e.otherFolio?.name ?? "Further on in this piece",
      body: e.otherFolio?.text ?? e.anchors[e.anchors.length - 1],
      byline: `Shares ${e.shared.join(", ")}`,
      createdAt: Date.now(),
      relevance: 0.8,
      folioId: e.otherFolio?.id ?? "connections-fixture",
      folioName: e.otherFolio?.name,
      ...(e.bare
        ? {}
        : {
            data: flow.echoData(
              e.shared,
              flow.echoReading(e.reading, e.shared),
              e.anchors[0],
              e.advice,
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
  await showEchoes(page, [SEMANTIC]);
  const dock = page.getByRole("complementary", {
    name: "From the margin",
    exact: true,
  });
  await dock.getByRole("button", { name: /from the room.*Open/ }).click();
  const card = dock.locator('[data-flow-card^="echo:"]');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const gather = card.getByRole("button", { name: "Compare passages" });
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
  await gather.hover();
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
  await expect(semantic).toContainText(
    "Does the later passage pay off the setup?",
  );
  await expect(semantic.locator(".flow-card__kicker")).toContainText(
    "Unpaid promise",
  );
  await expect(lexical).toContainText("Is the repeated wording intentional?");
  await expect(lexical.locator(".flow-card__kicker")).toContainText(
    "Shared words",
  );
  // Nothing was advised for these, so the card offers only the comparison.
  await expect(
    semantic.getByRole("button", { name: /^(Merge|Bring)/ }),
  ).toHaveCount(0);
  await expect(semantic).not.toContainText(SEMANTIC_REASON);
  await expect(lexical).not.toContainText(LEXICAL_REASON);

  // Opening the sheet carries the same words, for both connections on the
  // shared passage, and names the passages each one joins.
  const compare = semantic.getByRole("button", { name: "Compare passages" });
  await compare.click();
  const sheet = page.getByRole("dialog");
  // A setup and its payoff work because they are apart: no merge is offered.
  await expect(sheet.getByRole("button", { name: /^Merge into/ })).toHaveCount(
    0,
  );
  const why = sheet.getByRole("region", {
    name: "Why these passages are linked",
  });
  await expect(why).toBeHidden();
  await sheet.getByText("Connection details", { exact: true }).click();
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
  await sheet.getByText("Connection details", { exact: true }).click();
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
    .poll(() =>
      page.evaluate(() => window.getSelection()?.getRangeAt(0).toString()),
    )
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
  await expect(card).toContainText("No reason recorded");
  await expect(card).toContainText("Worth reading together?");
  await card.getByRole("button", { name: "Compare passages" }).click();
  await page.getByText("Connection details", { exact: true }).click();
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
  await expect(card).toContainText("Does the later passage pay off the setup?");
  await card.getByRole("button", { name: "Compare passages" }).click();
  await expect(page.getByRole("dialog")).toContainText("A passage has changed");
  await expect(
    page.getByRole("button", { name: /Copy to new folio/ }),
  ).toHaveCount(0);
  await page.getByText("Connection details", { exact: true }).click();
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

test("a writer can bring the paragraphs together and undo the move", async ({
  page,
}) => {
  await seed(page);
  const before = await manuscriptText(page);
  await showEchoes(page, [SEMANTIC]);
  await page.getByRole("button", { name: "Compare passages" }).click();
  await page
    .getByRole("button", { name: "Move paragraph 19 after paragraph 4" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  await expect(blocks.nth(4)).toHaveText(RUMOUR);
  await expect(blocks.nth(4).locator('[data-comment-id="c3"]')).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect.poll(() => manuscriptText(page)).toBe(before);
});

test("a manuscript edit while comparing invalidates a move and a new folio copy", async ({
  page,
}) => {
  await seed(page);
  await showEchoes(page, [SEMANTIC]);
  await page.getByRole("button", { name: "Compare passages" }).click();
  const dialog = page.getByRole("dialog");
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  await blocks.nth(18).evaluate((p) => p.append(" The drivers fell silent."));
  await dialog
    .getByRole("button", { name: "Move paragraph 19 after paragraph 4" })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "The draft has changed",
  );
  await expect(blocks.nth(18)).toContainText("The drivers fell silent.");
  await dialog.getByRole("button", { name: /Copy to new folio/ }).click();
  await dialog.getByRole("button", { name: "Create and open folio" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "A passage has changed",
  );
  await expect(
    dialog.getByRole("button", { name: /Copy to new folio/ }),
  ).toHaveCount(0);
});

test("copying a group opens a named folio with just its wording in reading order", async ({
  page,
}) => {
  await seed(page);
  await showEchoes(page, [SEMANTIC, LEXICAL]);
  await page
    .locator(`[data-flow-card="${SEMANTIC.id}"]`)
    .getByRole("button", { name: "Compare passages" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("mark")).toHaveText([TURN, PARA_5, RUMOUR]);
  await dialog.getByRole("button", { name: /Copy to new folio/ }).click();
  await dialog.getByLabel("New folio name").fill("The sea returns");
  await dialog.getByRole("button", { name: "Create and open folio" }).click();
  await expect(dialog).toHaveCount(0);
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  await expect(blocks).toHaveText([TURN, PARA_5, RUMOUR]);
  await page.reload();
  await expect(blocks).toHaveText([TURN, PARA_5, RUMOUR]);
  const saved = await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    return {
      names: (await idb.loadFoliosFromIdb()).map(
        (f: { name: string }) => f.name,
      ),
      original: await idb.loadFolioContentFromIdb("connections-fixture"),
      copy: await idb.loadFolioContentFromIdb(
        await idb.loadActiveFolioIdFromIdb(),
      ),
    };
  });
  expect(saved.names).toEqual(["Salt Roads", "The sea returns"]);
  expect(saved.original).toContain('data-comment-id="c3"');
  expect(saved.copy).not.toContain("data-comment-id");
});

test("the transition request carries just the displayed passages into Task desk", async ({
  page,
}) => {
  await seed(page);
  await showEchoes(page, [SEMANTIC]);
  await page.getByRole("button", { name: "Compare passages" }).click();
  const requests = watchRequests(page);
  await page.getByRole("button", { name: "Transition ideas" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Pick up a word or image",
  );
  expect(requests).toEqual([]);
  await page
    .getByRole("button", { name: "Draft options in Task desk…" })
    .click();
  const desk = page.getByRole("dialog", { name: "Writing instruments" });
  await expect(desk.getByLabel("Reference passage")).toHaveValue(
    `Passage 1\n${TURN}\n\nPassage 2\n${RUMOUR}`,
  );
  await expect(desk.getByLabel("What should this task do?")).toHaveValue(
    /callback.*contrast.*example to claim/,
  );
});

test("a writer can copy wording from two folios without importing markup", async ({
  page,
}) => {
  await seed(page);
  const otherFolio = {
    id: "archived",
    name: "Sea notes",
    text: "The old ledger says <keep the salt & the timber>. It lists the week the salt ships returned to port.",
  };
  await page.evaluate(async (f) => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const p = document.createElement("p");
    p.textContent = f.text;
    await idb.createFolioWithContent(
      { id: f.id, name: f.name, type: "notes", createdAt: 1, updatedAt: 1 },
      p.outerHTML,
    );
  }, otherFolio);
  await showEchoes(page, [{ ...SEMANTIC, anchors: [TURN], otherFolio }]);
  await page.getByRole("button", { name: "Compare passages" }).click();
  await page.getByRole("button", { name: /Copy to new folio/ }).click();
  await page.getByRole("button", { name: "Create and open folio" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".ProseMirror").first().locator(":scope > p"),
  ).toHaveText([TURN, otherFolio.text]);
});

test("a changed excerpt in another folio cannot be copied", async ({
  page,
}) => {
  await seed(page);
  const otherFolio = {
    id: "archived",
    name: "Sea notes",
    text: "The old ledger named each crossing and the day the salt ships first returned to port.",
  };
  await showEchoes(page, [{ ...SEMANTIC, anchors: [TURN], otherFolio }]);
  await page.getByRole("button", { name: "Compare passages" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(otherFolio.text);
  await expect(
    dialog.getByRole("button", { name: /^Move paragraph/ }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: /Copy to new folio/ }).click();
  await dialog.getByRole("button", { name: "Create and open folio" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "The passage in Sea notes has changed.",
  );
});

/** Paragraph 12, rewritten: it repeats paragraph 5 and adds one thing. */
const WELL = "The well at Tamsa was dry that year.";
const PARA_12 = `Paragraph 12: the salt caravans left before dawn, and the road bent with the coast for a week of walking. ${WELL}`;
const REPEAT: EchoFixture = {
  id: "echo:fixture-repeat",
  anchors: [PARA_5, PARA_12],
  shared: ["salt", "caravans"],
  reading: "Repetition",
  advice: "fold-here",
};

/** Carry the card's passage to a point of a manuscript paragraph. */
async function carryTo(
  page: Page,
  card: Locator,
  paragraph: Locator,
  share: number,
) {
  const from = (await card.locator(".flow-relation__slip").boundingBox())!;
  const to = (await paragraph.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * share, {
    steps: 12,
  });
}

test("dragging the card's passage onto a paragraph folds the repeat in, marks what came over, and can be put back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, { 11: PARA_12 });
  const before = await manuscriptText(page);
  await showEchoes(page, [REPEAT]);
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  await expect(blocks).toHaveCount(22);

  // The card names the relation and leads with the advised move.
  const card = page.locator(`[data-flow-card="${REPEAT.id}"]`);
  await expect(card.locator(".flow-card__kicker")).toContainText("Repetition");
  await expect(card).toContainText(
    "Drag it onto your paragraph to merge them.",
  );
  // Over the middle of a paragraph the page shows it will be taken in.
  await carryTo(page, card, blocks.nth(4), 0.5);
  await expect(page.locator(".flow-drop")).toHaveAttribute(
    "data-label",
    "Merge here",
  );
  await page.mouse.up();
  await expect(page.locator(".flow-drop, .flow-drag-ghost")).toHaveCount(0);

  // Paragraph 12 is gone; what only it said now ends paragraph 5, marked.
  await expect(blocks).toHaveCount(21);
  await expect(blocks.nth(4)).toHaveText(`${PARA_5} ${WELL}`);
  await expect(blocks.nth(4).locator(".merge-review__carried")).toHaveText(
    ` ${WELL}`,
  );
  await expect(page.locator(".ProseMirror").first()).not.toContainText(
    "Paragraph 12:",
  );
  // The writer is returned to the paragraph that changed.
  expect(
    await page.evaluate(() => {
      const node = window.getSelection()?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      return el?.closest("p")?.textContent?.startsWith("Paragraph 5:");
    }),
  ).toBe(true);

  // Beside it, the card now holds both sides of the change.
  const merged = page.locator(`[data-flow-card="${REPEAT.id}"]`);
  await expect(merged.locator(".flow-card__kicker")).toHaveText("Merged");
  await expect(merged).toContainText("Paragraph 12 folded in");
  await expect(merged.locator("ins")).toHaveText(WELL);
  await expect(merged.locator("del")).toHaveText(
    "Paragraph 12: the salt caravans left before dawn, and the road bent with the coast for a week of walking.",
  );

  // A sentence left out can still be carried over, and is marked too.
  await merged.getByRole("button", { name: "Carry it over" }).click();
  await expect(merged.locator("del")).toHaveCount(0);
  await expect(blocks.nth(4)).toHaveText(
    `${PARA_5} ${WELL} Paragraph 12: the salt caravans left before dawn, and the road bent with the coast for a week of walking.`,
  );
  await expect(
    blocks.nth(4).locator(".merge-review__carried").last(),
  ).toContainText("Paragraph 12:");

  // Putting it back restores the draft and the connection.
  await merged.getByRole("button", { name: "Put it back" }).click();
  await expect.poll(() => manuscriptText(page)).toBe(before);
  await expect(page.locator(".merge-review__carried")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("dragging the card's passage into a gap sets the paragraph down there, and it can be put back", async ({
  page,
}) => {
  await seed(page, { 11: PARA_12 });
  const before = await manuscriptText(page);
  await showEchoes(page, [REPEAT]);
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  const card = page.locator(`[data-flow-card="${REPEAT.id}"]`);

  // Near a paragraph's lower edge the landing place is the gap below it.
  await carryTo(page, card, blocks.nth(4), 0.9);
  await expect(page.locator('.flow-drop[data-kind="gap"]')).toHaveAttribute(
    "data-label",
    "Move here",
  );
  // Escape puts it back in the card and changes nothing.
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".flow-drop, .flow-drag-ghost")).toHaveCount(0);
  expect(await manuscriptText(page)).toBe(before);

  await carryTo(page, card, blocks.nth(4), 0.9);
  await page.mouse.up();
  await expect(blocks).toHaveCount(22);
  await expect(blocks.nth(5)).toHaveText(PARA_12);
  await expect(blocks.nth(5).locator(".merge-review__carried")).toHaveText(
    PARA_12,
  );
  const moved = page.locator(`[data-flow-card="${REPEAT.id}"]`);
  await expect(moved.locator(".flow-card__kicker")).toHaveText("Moved");
  await expect(moved).toContainText("Paragraph 12 moved here");
  await moved.getByRole("button", { name: "Put it back" }).click();
  await expect.poll(() => manuscriptText(page)).toBe(before);
});

test("in the comparison, dragging one paragraph onto the other merges into it", async ({
  page,
}) => {
  await seed(page, { 11: PARA_12 });
  await showEchoes(page, [REPEAT]);
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  await page.getByRole("button", { name: "Compare passages" }).click();
  const dialog = page.getByRole("dialog");
  // Other connections on the same passage may be gathered beside the pair;
  // only the pair's own two paragraphs can be picked up.
  const here = dialog.locator(`[data-gather-passage="${REPEAT.id}:0"]`);
  const other = dialog.locator(`[data-gather-passage="${REPEAT.id}:1"]`);
  await expect(dialog.locator(".passage-gather__repeat")).toHaveCount(2);
  const from = (await other.locator("[data-carry]").boundingBox())!;
  const to = (await here.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10,
  });
  await expect(here).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  // Paragraph 5 was landed on, so it stays and takes in what 12 added.
  await expect(blocks).toHaveCount(21);
  await expect(blocks.nth(4)).toHaveText(`${PARA_5} ${WELL}`);
});

test("the comparison underlines what repeats, says why, and merges either way", async ({
  page,
}) => {
  await seed(page, { 11: PARA_12 });
  await showEchoes(page, [REPEAT]);
  const blocks = page.locator(".ProseMirror").first().locator(":scope > p");
  await page.getByRole("button", { name: "Compare passages" }).click();
  const dialog = page.getByRole("dialog");

  // Signed out, shared words stand in for a reading, and the sheet says so.
  await expect(dialog.locator(".passage-gather__advice")).toContainText(
    "Paragraph 5 makes the point more fully. One sentence in paragraph 12 repeats it; the other one would be carried over.",
  );
  await expect(dialog.locator(".passage-gather__legend")).toHaveText(
    "Highlighted sentences share most of their words. Drag paragraph 5 or paragraph 12 onto the other to merge them.",
  );
  await expect(dialog.locator(".passage-gather__repeat")).toHaveCount(2);
  await expect(dialog.locator(".passage-gather__repeat").nth(1)).toHaveText(
    "Paragraph 12: the salt caravans left before dawn, and the road bent with the coast for a week of walking.",
  );

  // The advised keeper leads; the other way round is still offered.
  const merges = dialog.getByRole("button", { name: /^Merge into/ });
  await expect(merges).toHaveText([
    "Merge into paragraph 5",
    "Merge into paragraph 12",
  ]);
  await merges.nth(1).click();
  await expect(dialog).toHaveCount(0);

  // Keeping paragraph 12: nothing of paragraph 5 is new, so it only goes.
  await expect(blocks).toHaveCount(21);
  await expect(blocks.nth(10)).toHaveText(PARA_12);
  await expect(page.locator(".ProseMirror").first()).not.toContainText(
    "Paragraph 5:",
  );
  const merged = page.locator(`[data-flow-card="${REPEAT.id}"]`);
  await expect(merged).toContainText("Paragraph 5 folded in");
  await merged.getByRole("button", { name: "Keep it" }).click();
  await expect(merged).toHaveCount(0);
  await expect(blocks).toHaveCount(21);
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
    await expect(card).toContainText(
      "Does the later passage pay off the setup?",
    );
    await card.getByRole("button", { name: "Compare passages" }).tap();
    await page.getByText("Connection details", { exact: true }).tap();
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
