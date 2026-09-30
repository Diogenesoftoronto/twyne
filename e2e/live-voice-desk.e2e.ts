import { expect, test } from "@playwright/test";

test("closing the idle voice desk leaves the editor responsive and allows reopening", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__voice-close-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__voice-close-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const id = "voice-close-regression";
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id,
        name: "Voice desk regression",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(
      id,
      "<p>A draft that stays responsive.</p>",
    );
    await idb.saveBriefToIdb(id, {
      answers: {
        workingTitle: "Voice desk regression",
        format: "Essay",
        audience: "Readers",
        goal: "Explain",
        tone: "Plain",
        constraints: "",
        successSignal: "",
      },
      attachments: [],
      completedAt: now,
      updatedAt: now,
    });
  });
  await page.goto("/editor/");
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toContainText("A draft that stays responsive.");
  const desk = page.getByRole("complementary", { name: "Live voice desk" });
  for (let i = 0; i < 3; i++) {
    await expect
      .poll(async () => {
        await page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent("twyne:live-voice-open", { detail: {} }),
          ),
        );
        return desk.isVisible();
      })
      .toBe(true);
    await desk
      .getByRole("button", { name: "Close voice desk", exact: true })
      .click();
    await expect(desk).toBeHidden();
    // A starved renderer cannot answer this timer or accept the next edit.
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("responsive"), 50)),
      ),
    ).toBe("responsive");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText(` Still writing ${i}.`);
    await expect(editor).toContainText(`Still writing ${i}.`);
  }
  expect(errors).toEqual([]);
});
