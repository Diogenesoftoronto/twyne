import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/__clairic-regression", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:24px;font:16px/1.6 system-ui}p{overflow-wrap:anywhere}</style></head><body></body></html>',
    }),
  );
  await page.goto("/__clairic-regression");
});

test("only exact quotations navigate, on desktop and narrow screens", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const assistPath = "/src/utils/quote-grounding-assist.ts";
    const quotePath = "/src/utils/quote-grounding.ts";
    const { assistQuotation } = await import(/* @vite-ignore */ assistPath);
    const { linkQuotations, revealQuoteFromEvent, REVEAL_QUOTE_EVENT } =
      await import(/* @vite-ignore */ quotePath);
    const draft = "Ada held the iron key. The room was silent.";
    const exact = "Ada held the iron key";
    const paraphrase = "Ada clutched an iron key";
    // Fixture provider data; the renderer and interaction handlers are real.
    const research = {
      reserve: () => true,
      extract: async () => ({
        ok: true,
        answers: {
          passage: { type: "text", value: exact, span: [0, exact.length] },
        },
      }),
    };
    for (const [id, quote] of [
      ["exact", exact],
      ["related", paraphrase],
    ]) {
      const resolution = await assistQuotation(quote, draft, "", research);
      const section = document.createElement("section");
      section.id = id;
      section.innerHTML = linkQuotations(
        `<p>“${quote}”</p>`,
        [{ quote, index: 0, context: "", resolution }],
        draft,
      );
      document.body.append(section);
    }
    document.body.addEventListener("click", revealQuoteFromEvent);
    document.body.addEventListener("keydown", revealQuoteFromEvent);
    window.addEventListener(REVEAL_QUOTE_EVENT, () => {
      document.body.dataset.reveals = String(
        Number(document.body.dataset.reveals ?? 0) + 1,
      );
    });
  });
  const exact = page.locator("#exact").getByRole("link");
  const related = page.locator("#related .quote-unresolved");
  await exact.click();
  await exact.press("Enter");
  await related.click();
  await expect(page.locator("body")).toHaveAttribute("data-reveals", "2");
  await expect(page.locator("#related").getByRole("link")).toHaveCount(0);
  await expect(related).toHaveAttribute(
    "title",
    /Possible related passage, not an exact quotation/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(exact).toBeVisible();
  await expect(related).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("word-target range stays open-ended in the editor and quiet in Zen", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id: "clairic-check",
        name: "Clairic check",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveFolioContentToIdb(
      "clairic-check",
      "<p>Ada held the iron key.</p>",
    );
    await idb.saveActiveFolioIdToIdb("clairic-check");
  });
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    "true",
    { timeout: 60_000 },
  );
  const line = page.getByTestId("forecast-line");
  await expect(line).toBeAttached();
  const zen = page.getByRole("button", { name: "Toggle Zen mode", exact: true });
  // The editor starts in Zen, where forecasts intentionally have no contents.
  await expect(zen).toHaveAttribute("aria-pressed", "true");
  await expect(line).toBeHidden();
  await zen.click();
  await expect(zen).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("twyne:forecast-preview", {
            detail: {
              finish: {
                target: 12000,
                current: 9000,
                median: "2026-11-14",
                early: "2026-11-08",
                late: null,
                source: "clairic",
              },
            },
          }),
        ),
      );
      return line.textContent();
    })
    .toContain("word target ~Nov 14 (Nov 8 or later)");
  await expect(line).toBeVisible();
  await expect(line.locator("[title]")).toHaveAttribute(
    "title",
    /Draft reaches 12,000 words/,
  );
  await expect(line).not.toContainText("done");
  await zen.click();
  await expect(zen).toHaveAttribute("aria-pressed", "true");
  await expect(line).toBeHidden();
  await zen.click();
  await expect(zen).toHaveAttribute("aria-pressed", "false");
  await expect(line).toBeVisible();
  await expect(line).toContainText("word target ~Nov 14 (Nov 8 or later)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(line).toBeHidden();
});
