import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test("typing in a long annotated manuscript stays responsive and source includes the final keystroke", async ({
  page,
}, testInfo) => {
  await page.route("**/__typing-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>Seed" }),
  );
  await page.goto("/__typing-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id: "typing-regression",
        name: "Typing regression",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveFolioContentToIdb(
      "typing-regression",
      "<p>Ready to write.</p>",
    );
    await idb.saveActiveFolioIdToIdb("typing-regression");
  });
  await page.goto("/editor/");
  const manuscript = page.locator(".ProseMirror");
  await expect(manuscript).toHaveAttribute("contenteditable", "true");
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const editor = (
      document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }
    ).editor;
    editor.commands.setContent(
      Array.from(
        { length: 800 },
        (_, i) =>
          `${i % 20 === 0 ? `<h2>Section ${i}</h2>` : ""}<p>Paragraph ${i}. The writer follows the river through the city. <span data-comment-id="note-${i}">This passage needs a second look.</span> The afternoon light falls across the desk.</p>`,
      ).join(""),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
  // Wait for the initial source reconciliation before measuring the typing path.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const detail = { source: "", pending: false };
        window.dispatchEvent(
          new CustomEvent("twyne:request-typst-source", { detail }),
        );
        return detail.source.includes("Paragraph 799");
      }),
    )
    .toBe(true);
  await manuscript.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate(() => {
    const editor = (
      document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }
    ).editor;
    const samples: number[] = [];
    const dispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (transaction) => {
      const start = performance.now();
      dispatch(transaction);
      if (transaction.docChanged) samples.push(performance.now() - start);
    };
    (window as unknown as { typingSamples: number[] }).typingSamples = samples;
  });
  const tail = " The final sentence reaches source immediately.";
  await page.keyboard.type(tail, { delay: 10 });
  const samples = await page.evaluate(
    () => (window as unknown as { typingSamples: number[] }).typingSamples,
  );
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  await testInfo.attach("typing-latency", {
    body: JSON.stringify({ paragraphs: 800, samples, p95 }),
    contentType: "application/json",
  });
  expect(samples.length).toBeGreaterThanOrEqual(tail.length);
  // The previous synchronous source handler took hundreds of ms per character.
  expect(p95).toBeLessThan(100);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".typst-source-editor .cm-content")).toContainText(
    tail.trim(),
  );
});
