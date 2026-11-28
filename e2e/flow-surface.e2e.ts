import { expect, test } from "@playwright/test";

test("a failed editor reply can be retried without filing the writer message again", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const sent: string[] = [];
  let providerAvailable = false;
  const answer = "Give the second idea its own sentence.";
  await page.route("**/__reply-fixture/chat/completions", async (route) => {
    const request = route.request().postDataJSON();
    sent.push(JSON.stringify(request));
    if (!providerAvailable) {
      await route.fulfill({
        status: 402,
        json: {
          error: {
            message: "Provider credit exhausted",
            code: "insufficient_credits",
          },
        },
      });
      return;
    }
    if (!request.stream) {
      await route.fulfill({
        json: {
          id: "reply-fixture",
          object: "chat.completion",
          model: "reply-fixture",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: answer },
              finish_reason: "stop",
            },
          ],
        },
      });
      return;
    }
    const chunk = {
      id: "reply-fixture",
      object: "chat.completion.chunk",
      model: "reply-fixture",
      created: 1,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: answer,
          },
          finish_reason: "stop",
        },
      ],
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.route("**/__reply-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__reply-seed");
  await page.evaluate(async () => {
    const idbPath = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const now = Date.now();
    const id = "f-reply-retry";
    await idb.saveFoliosToIdb([
      { id, name: "Salt Roads", type: "draft", createdAt: now, updatedAt: now },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(
      id,
      '<p>The traders <span data-persona-note-id="retry-note" data-persona-note-author="Le Lecteur" data-persona-note-note="Break up these ideas.">weighed their loads by the handful</span> and argued about the weather.</p>',
    );
    await idb.saveAiSettingsToIdb({
      advancedMode: true,
      providers: [
        {
          id: "reply-fixture",
          name: "Reply fixture",
          type: "openai-compatible",
          baseUrl: location.origin + "/__reply-fixture",
          apiKey: "fixture",
          defaultModel: "reply-fixture",
        },
      ],
      defaultProviderId: "reply-fixture",
      perFeature: {},
      showProviderTags: true,
    });
  });

  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror").first()).toContainText(
    "weighed their loads by the handful",
  );
  await page.evaluate(async () => {
    const browserUrl = performance
      .getEntriesByType("resource")
      .find(({ name }) => name.includes("/convex_browser.js"))?.name;
    if (!browserUrl) return;
    const { ConvexClient } = await import(/* @vite-ignore */ browserUrl);
    // The BYOK agent asks Convex about optional research capabilities
    // before generating. Keep both capability checks and reviews synthetic.
    ConvexClient.prototype.query = async () => null;
    ConvexClient.prototype.action = async () => ({ ok: false });
  });
  await page
    .getByRole("button", { name: "Toggle Zen mode", exact: true })
    .click();
  const closeBoard = page.getByRole("button", {
    name: "Close the Editorial Board",
  });
  if (await closeBoard.isVisible()) await closeBoard.click();
  const note = page
    .locator('.twyne-mark-anchor[data-anchor-kind="note"]')
    .first();
  await note.click();
  const dialog = page.getByRole("dialog", { name: "Note from Le Lecteur" });
  const draft = dialog.getByRole("textbox", { name: "Reply to Le Lecteur" });
  const message = "Which idea needs more room?";
  await draft.fill(message);
  await draft.press("Enter");
  const retry = dialog.getByRole("button", {
    name: "Retry reply",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(draft).toHaveValue("");
  await expect(dialog.getByText(message, { exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close note" }).click();
  await note.click();
  await expect(retry).toBeVisible();
  await draft.fill("A separate thought I am still writing");
  const requestsBeforeRetry = sent.length;
  providerAvailable = true;
  await retry.press("Enter");
  await expect(dialog.getByText(answer)).toBeVisible();
  await expect(dialog.getByText(message, { exact: true })).toHaveCount(1);
  await expect(draft).toHaveValue("A separate thought I am still writing");
  await expect(retry).toHaveCount(0);
  expect(requestsBeforeRetry).toBeGreaterThan(0);
  expect(sent.length).toBeGreaterThan(requestsBeforeRetry);
  expect(sent.every((request) => request.split(message).length === 2)).toBe(true);
});

test("margin conversations preserve replies, own one surface and adapt to mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__flow-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__flow-seed");
  await page.evaluate(async () => {
    const idbPath = "/src/utils/idb.ts";
    const commentsPath = "/src/utils/user-comments.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const uc = await import(/* @vite-ignore */ commentsPath);
    const now = Date.now();
    const id = "f-margin";
    await idb.saveFoliosToIdb([
      { id, name: "Salt Roads", type: "draft", createdAt: now, updatedAt: now },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    const paras = Array.from(
      { length: 6 },
      (_, i) =>
        `<p>Paragraph ${i + 1}: the salt caravans left before dawn, and the road bent with the coast for a week of walking.</p>`,
    );
    paras[1] = `<p>The traders <span data-persona-note-id="n1" data-persona-note-author="Marguerite" data-persona-note-color="#b0413e" data-persona-note-label="Pacing" data-persona-note-note="This sentence carries three ideas; let the second breathe." data-persona-note-quote="weighed their loads by the handful">weighed their loads by the handful</span> and argued about the weather.</p>`;
    paras[4] = `<p>At the ford <span data-suggestion-id="s1" data-suggestion-author="Marguerite" data-suggestion-color="#b0413e" data-suggestion-replacement="the mules refused the water" data-suggestion-rationale="Concrete beats abstract here." data-suggestion-versionId="v1">progress slowed considerably</span> for a day.</p>`;
    paras[3] = `<p>By the fourth day <span class="twyne-comment-mark" data-comment-id="c1" data-comment-author="You">the road forgot the sea entirely</span> and turned inland.</p>`;
    await idb.saveFolioContentToIdb(id, paras.join(""));
    await uc.saveUserComments([
      {
        id: "c1",
        folioId: id,
        text: "Is this literally true? Check the map.",
        author: "You",
        anchor: "the road forgot the sea entirely",
        resolved: false,
        createdAt: now,
        updatedAt: now,
        replies: [],
      },
      ...[0, 2, 5].map((i) => ({
        id: `waiting-${i}`,
        folioId: id,
        text: `A margin thought about paragraph ${i + 1}.`,
        author: "Editor",
        anchor: `Paragraph ${i + 1}: the salt caravans left before dawn`,
        resolved: false,
        createdAt: now,
        updatedAt: now,
        replies: [],
      })),
    ]);
    await idb.saveMetaToIdb("flow-reading-enabled", true);
  });

  await page.goto("/editor/");
  // Inspect the editorial margin outside the default writing-only Zen view.
  await page
    .getByRole("button", { name: "Toggle Zen mode", exact: true })
    .click();
  const note = page
    .locator('.twyne-mark-anchor[data-anchor-kind="note"]')
    .first();
  const comment = page
    .locator('.twyne-mark-anchor[data-anchor-kind="comment"]')
    .first();
  const suggestion = page
    .locator('.twyne-mark-anchor[data-anchor-kind="suggestion"]')
    .first();
  await expect(page.locator(".flow-column--room")).toBeVisible();
  // Reading the margin only changes its layout. It must never masquerade
  // as an edit (or invalidate a live review waiting for the saved draft).
  await page.evaluate(() => {
    const counts = { content: 0, layout: 0 };
    Object.assign(window, { marginEvents: counts });
    window.addEventListener("twyne:content", () => counts.content++);
    window.addEventListener("twyne:flow-layout", () => counts.layout++);
  });
  const card = page.locator(".flow-card").first();
  await card.hover();
  // Whichever control the first card has: Open conversation or Go to.
  await card
    .locator(".flow-card__open, button.flow-card__body")
    .first()
    .focus();
  const more = page.getByRole("button", { name: /more in the margin/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(
    page.getByRole("button", { name: "Fewer", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { marginEvents: { layout: number } })
            .marginEvents.layout,
      ),
    )
    .toBeGreaterThanOrEqual(3);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { marginEvents: { content: number } })
          .marginEvents.content,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
  await note.click();
  const noteDraft = page.getByRole("textbox", { name: "Reply to Marguerite" });
  await noteDraft.fill("A persona reply in progress");
  await comment.click();
  const writerDraft = page.getByRole("textbox", {
    name: "Reply as the writer",
  });
  await writerDraft.fill("A writer reply in progress");
  await note.click();
  await expect(noteDraft).toHaveValue("A persona reply in progress");
  await expect(page.locator(".manuscript-comment-card")).toHaveCount(1);
  await comment.click();
  await expect(writerDraft).toHaveValue("A writer reply in progress");
  await page
    .locator(".manuscript-comment-card")
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await expect(writerDraft).toHaveValue("");
  await expect(page.locator(".manuscript-comment-card")).toContainText(
    "A writer reply in progress",
  );
  await page
    .locator(".manuscript-comment-card")
    .getByRole("button", { name: "Resolve", exact: true })
    .click();
  await expect(
    page
      .locator(".manuscript-comment-card")
      .getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await suggestion.click();
  await expect(page.locator(".suggestion-card")).toHaveAttribute(
    "data-margin-item",
    "suggestion:s1",
  );
  await expect(page.locator(".manuscript-comment-card")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await page.locator(".suggestion-card").boundingBox();
      return (
        !!box &&
        box.x >= 0 &&
        box.x + box.width <= 390 &&
        box.y + box.height <= 844
      );
    })
    .toBe(true);
  await expect(page.locator(".flow-dock")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".manuscript-comment-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});
