import { expect, test } from "@playwright/test";

test("a margin card expands into its full thread on the board", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__expand-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__expand-seed");
  await page.evaluate(async () => {
    const idbPath = "/src/utils/idb.ts";
    const commentsPath = "/src/utils/user-comments.ts";
    const syncPath = "/src/utils/convex-sync.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const uc = await import(/* @vite-ignore */ commentsPath);
    const sync = await import(/* @vite-ignore */ syncPath);
    const now = Date.now();
    const id = "f-expand";
    await idb.saveFoliosToIdb([
      { id, name: "Salt Roads", type: "draft", createdAt: now, updatedAt: now },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(
      id,
      `<p>The traders <span data-persona-note-id="n1" data-persona-note-author="Marguerite" data-persona-note-color="#b0413e" data-persona-note-label="Pacing" data-persona-note-note="This sentence carries three ideas; let the second breathe." data-persona-note-quote="weighed their loads by the handful">weighed their loads by the handful</span> and argued about the weather.</p>` +
        `<p>By the fourth day <span class="twyne-comment-mark" data-comment-id="c1" data-comment-author="You">the road forgot the sea entirely</span> and turned inland.</p>`,
    );
    await sync.savePersonaNoteLocally(
      {
        folioId: id,
        noteId: "n1",
        personaId: "marguerite",
        personaName: "Marguerite",
        personaColor: "#b0413e",
        feedback: "This sentence carries three ideas; let the second breathe.",
        anchor: "weighed their loads by the handful",
        timestamp: now,
        type: "critique",
      },
      null,
      id,
    );
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
    ]);
  });

  await page.goto("/editor/");
  await page
    .getByRole("button", { name: "Toggle Zen mode", exact: true })
    .click();

  await page
    .locator('.twyne-mark-anchor[data-anchor-kind="note"]')
    .first()
    .click();
  await page
    .getByRole("button", { name: "Open the full note from Marguerite" })
    .first()
    .click();
  await expect(page.locator(".persona-note-card")).toHaveCount(0);
  const sheet = page.locator("dialog[open]");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("let the second breathe");
  if (process.env.EXPAND_SHOTS)
    await page.screenshot({ path: "/tmp/twyne-shots/expand-note.png" });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Close the board again so the comment card has the margin to itself.
  await page
    .getByRole("button", { name: "Close the Editorial Board" })
    .click();

  await page
    .locator('.twyne-mark-anchor[data-anchor-kind="comment"]')
    .first()
    .click();
  await page
    .locator(".user-comment-card")
    .getByRole("button", { name: "Open in Comments" })
    .click();
  await expect(page.locator(".user-comment-card")).toHaveCount(0);
  const thread = page.locator('[data-comment-id="c1"]:not(.twyne-comment-mark)');
  await expect(thread.first()).toBeVisible();
  await expect(thread.first()).toHaveAttribute("data-arriving", "");
  expect(errors).toEqual([]);
});
