import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function chooseView(page: Page, name: "Write" | "Source" | "Proof") {
  await page.getByRole("button", { name, exact: true }).click();
}

async function seedFolio(page: Page) {
  await page.route("**/__typst-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__typst-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id: "e2e-typst-editor",
        name: "Native manuscript",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveFolioContentToIdb(
      "e2e-typst-editor",
      "<p>The original manuscript.</p>",
    );
    await idb.saveActiveFolioIdToIdb("e2e-typst-editor");
  });
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toContainText(
    "The original manuscript.",
    { timeout: 30000 },
  );
  await page
    .getByRole("button", { name: "Toggle compositor", exact: true })
    .click();
}
async function replaceSource(page: Page, source: string) {
  const editor = page.getByRole("textbox", { name: "Typst source" });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
}

test("Write+Split compiles its first proof and pauses again when Split closes", async ({
  page,
}) => {
  let proofWorkers = 0;
  page.on("worker", (worker) => {
    if (/\/compiler\.worker(?:[.-]|$)/.test(new URL(worker.url()).pathname))
      proofWorkers++;
  });
  await seedFolio(page);
  const workspace = page.getByRole("region", { name: "Manuscript workspace" });
  const split = workspace.getByRole("button", { name: "Split", exact: true });
  const proofPane = workspace.locator(".typst-proof");
  const proof = proofPane.locator("img").first();
  const manuscript = page.locator(".ProseMirror");

  // No Source or Proof visit should be needed before the first split proof.
  await expect(workspace.locator(".typst-status")).toContainText(
    "Proof updates when opened",
  );
  await expect(proofPane).toBeHidden();
  await expect(proofPane.locator("img")).toHaveCount(0);
  expect(proofWorkers).toBe(0);
  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "true");
  await expect(manuscript).toBeVisible();
  await expect(proof).toBeVisible({ timeout: 30000 });
  await expect(workspace.locator(".typst-status")).toHaveText("1 page", {
    timeout: 30000,
  });
  const initialProof = await proof.getAttribute("src");
  expect(initialProof).toBeTruthy();
  await expect(
    workspace.getByRole("link", { name: "Download PDF", exact: true }),
  ).toBeVisible();

  await manuscript.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" An edit beside the first proof.");
  await expect(manuscript).toContainText("An edit beside the first proof.");
  await expect(proof).not.toHaveAttribute("src", initialProof!, {
    timeout: 30000,
  });
  const splitProof = await proof.getAttribute("src");
  expect(splitProof).toBeTruthy();
  const compiledWorkers = proofWorkers;
  expect(compiledWorkers).toBeGreaterThan(0);

  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "false");
  await expect(proofPane).toBeHidden();
  await manuscript.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" An edit with the proof closed.");
  await expect(manuscript).toContainText("An edit with the proof closed.");
  await expect(
    workspace.getByRole("link", {
      name: "Download previous PDF (proof is out of date)",
      exact: true,
    }),
  ).toContainText("Previous PDF");
  // Observe past both the visual-source and proof debounces. A hidden Write
  // view should retain its last proof without starting another compiler.
  await page.waitForTimeout(1200);
  expect(proofWorkers).toBe(compiledWorkers);
  await expect(proof).toHaveAttribute("src", splitProof!);

  await split.click();
  await expect(proof).toBeVisible();
  await expect(proof).not.toHaveAttribute("src", splitProof!, {
    timeout: 30000,
  });
  await expect(
    workspace.getByRole("link", { name: "Download PDF", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => proof.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test("Proof to Split keeps compilation active and Source validates with Split open or closed", async ({
  page,
}) => {
  await seedFolio(page);
  const workspace = page.getByRole("region", { name: "Manuscript workspace" });
  const split = workspace.getByRole("button", { name: "Split", exact: true });
  const proofPane = workspace.locator(".typst-proof");
  const proof = proofPane.locator("img").first();

  // Switch before waiting for the first proof, so pending work must survive.
  await chooseView(page, "Proof");
  await split.click();
  await expect(
    workspace.getByRole("button", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(split).toHaveAttribute("aria-pressed", "true");
  await expect(proof).toBeVisible({ timeout: 30000 });
  await expect(workspace.locator(".typst-status")).toHaveText("1 page", {
    timeout: 30000,
  });
  const initialProof = await proof.getAttribute("src");
  expect(initialProof).toBeTruthy();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" A live edit after leaving Proof.");
  await expect(proof).not.toHaveAttribute("src", initialProof!, {
    timeout: 30000,
  });

  await chooseView(page, "Source");
  await replaceSource(
    page,
    "First source page.\n\n#pagebreak()\n\nSecond source page.",
  );
  await expect(proofPane).toBeVisible();
  await expect(proofPane.locator("img")).toHaveCount(2, { timeout: 30000 });
  await expect(workspace.locator(".typst-status")).toHaveText(
    "2 pages · source draft",
    { timeout: 30000 },
  );

  await split.click();
  await expect(proofPane).toBeHidden();
  await replaceSource(
    page,
    "First source page.\n\n#pagebreak()\n\nSecond source page.\n\n#pagebreak()\n\nThird source page.",
  );
  await expect(workspace.locator(".typst-status")).toHaveText(
    "3 pages · source draft",
    { timeout: 30000 },
  );
  await expect(proofPane.locator("img")).toHaveCount(3);
  await split.click();
  await expect(proof).toBeVisible();
  await expect(proofPane.locator("img")).toHaveCount(3);
});

test("source drafts recover after reload and valid source applies with paginated proof", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (!/Failed to fetch|NetworkError|Load failed/i.test(error.message))
      runtimeErrors.push(error.message);
  });
  await seedFolio(page);
  const workspace = page.getByRole("region", { name: "Manuscript workspace" });
  await chooseView(page, "Source");
  await replaceSource(page, "#this-is-not-valid(");
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();
  await expect(workspace.getByRole("alert")).toBeVisible({ timeout: 30000 });
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Typst source" }),
  ).toContainText("#this-is-not-valid(", { timeout: 30000 });
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toBeVisible();

  const source =
    "= Revised manuscript\n\nWords written in native source.\n\n#pagebreak()\n\nSecond typeset page.";
  await replaceSource(page, source);
  await expect(workspace.locator(".typst-status")).toContainText("2 pages", {
    timeout: 30000,
  });
  await workspace
    .getByRole("button", { name: "Apply source", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  await chooseView(page, "Write");
  await expect(page.locator(".ProseMirror")).toContainText(
    "Words written in native source.",
  );
  await expect(page.locator(".ProseMirror")).not.toContainText(
    "original manuscript",
  );
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".ProseMirror")).toContainText(
    "The original manuscript.",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".ProseMirror")).toContainText(
    "Words written in native source.",
  );
  // Write mode keeps the last proof until the writer opens it again.
  await chooseView(page, "Proof");
  await expect(workspace.locator(".typst-status")).toContainText("2 pages", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Proof", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    workspace.getByRole("img", { name: "Typeset page 1", exact: true }),
  ).toBeVisible();
  await expect(workspace.getByRole("img")).toHaveCount(2);
  const localNotice = page.getByRole("button", {
    name: "Not now",
    exact: true,
  });
  if (await localNotice.isVisible()) await localNotice.click();
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-proof-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-proof-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await chooseView(page, "Source");
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-source-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("twyne-typst-source-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await chooseView(page, "Proof");
  expect(
    await workspace
      .getByRole("img")
      .evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true);

  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText(
    "Words written in native source.",
    { timeout: 30000 },
  );
  await chooseView(page, "Source");
  const recoveredSource = page.getByRole("textbox", { name: "Typst source" });
  await recoveredSource.click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(recoveredSource).toContainText(
    "Words written in native source.",
  );
  await expect(
    workspace.getByRole("button", { name: "Apply source", exact: true }),
  ).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const { loadFolioContentSnapshotFromIdb } = await import(
      /* @vite-ignore */ path
    );
    return loadFolioContentSnapshotFromIdb("e2e-typst-editor");
  });
  expect(saved.typstSource).toContain("Words written in native source.");
  expect(saved.format).toBe("typst");
  expect(runtimeErrors).toEqual([]);
});

test("source tools preserve selection and proof uses the editorial sheet", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await seedFolio(page);
  const workspace = page.getByRole("region", { name: "Manuscript workspace" });
  await chooseView(page, "Source");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await expect(source).toBeFocused();
  await replaceSource(page, "A careful sentence.");
  await page.keyboard.press("ControlOrMeta+a");
  await workspace
    .getByRole("button", { name: "Insert bold", exact: true })
    .click();
  await expect(source).toHaveText("*A careful sentence.*");
  await workspace.getByRole("button", { name: "Undo source edit" }).click();
  await expect(source).toHaveText("A careful sentence.");
  await workspace.getByRole("button", { name: "Redo source edit" }).click();
  await expect(source).toHaveText("*A careful sentence.*");
  await workspace.getByRole("button", { name: "Toggle comment" }).click();
  await expect(source).toHaveText("// *A careful sentence.*");
  await workspace.getByRole("button", { name: "Toggle comment" }).click();
  await workspace
    .getByRole("button", { name: "Find and replace in source", exact: true })
    .click();
  await workspace.getByPlaceholder("Find", { exact: true }).fill("careful");
  await workspace.getByPlaceholder("Replace", { exact: true }).fill("clear");
  await workspace
    .getByRole("button", { name: "replace all", exact: true })
    .click();
  await expect(source).toHaveText("*A clear sentence.*");
  await page.keyboard.press("Escape");
  await workspace.getByRole("button", { name: "Wrap lines" }).click();
  await expect(
    workspace.getByRole("button", { name: "Wrap lines" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(workspace.locator(".cm-scroller")).not.toHaveClass(
    /cm-lineWrapping/,
  );
  await workspace.getByRole("button", { name: "Wrap lines" }).click();

  await replaceSource(
    page,
    `= The art of paying attention

A manuscript begins with a small act of noticing. A light left on in a window, the rhythm of a familiar street, a sentence that asks to be written down. The work of revision is to give those observations a clear and generous shape.

== A room for the reader

Good typography leaves room for the thought. The page should invite a reader in, carry them through a difficult passage, and let them pause at just the right moment.

#quote(block: true)[The right word is often the one that gives the sentence room to breathe.]

- Listen for the rhythm of the paragraph.
- Keep the details that make the scene specific.
- Leave enough quiet around an important idea.

== Notes from the desk

A useful reference belongs close to the passage it supports.#footnote[This is an editorial proof, set locally in Twyne.] See the #link("https://example.com")[working notes] for the next revision.

#table(columns: (1fr, 2fr), table.header([*Pass*], [*Purpose*]), [First], [Find the shape of the argument.], [Second], [Make every sentence earn its place.])
`,
  );
  await expect(workspace.locator(".typst-status")).toContainText("1 page", {
    timeout: 30000,
  });
  await workspace.getByRole("button", { name: "Split", exact: true }).click();
  const notice = page.getByRole("button", { name: "Not now", exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.screenshot({
    path: testInfo.outputPath("typst-source-split.png"),
    animations: "disabled",
  });
  await chooseView(page, "Proof");
  const proof = workspace.getByRole("img", {
    name: "Typeset page 1",
    exact: true,
  });
  await expect(proof).toBeVisible();
  await workspace.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(workspace.locator(".typst-zoom-value")).toHaveText("125%");
  await workspace.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(workspace.locator(".typst-zoom-value")).toHaveText("100%");
  await page.screenshot({
    path: testInfo.outputPath("typst-editorial-proof.png"),
    animations: "disabled",
  });
  await proof.screenshot({
    path: testInfo.outputPath("typst-editorial-page.png"),
  });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "nightpress"),
  );
  await page.screenshot({
    path: testInfo.outputPath("typst-proof-nightpress.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseView(page, "Source");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("typst-source-mobile-nightpress.png"),
    animations: "disabled",
  });
  await testInfo.attach("browser-errors", {
    body: JSON.stringify({ runtimeErrors, consoleErrors }, null, 2),
    contentType: "application/json",
  });
  expect(runtimeErrors).toEqual([]);
});

test("saving a native source copy removes private feedback and preserves the open draft", async ({
  page,
}) => {
  await seedFolio(page);
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    await idb.saveFolioContentToIdb(
      "e2e-typst-editor",
      '<p>The original <span data-persona-note-id="privacy-note" data-persona-note-author="Editor" data-persona-note-note="PRIVATE_FEEDBACK" data-persona-note-quote="manuscript">manuscript</span>.</p>',
    );
  });
  await page.reload();
  const workspace = page.getByRole("region", { name: "Manuscript workspace" });
  await chooseView(page, "Source");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await expect(source).toContainText("PRIVATE_FEEDBACK");
  const before = await source.innerText();
  const downloading = page.waitForEvent("download");
  await workspace
    .getByRole("button", { name: "Save source copy", exact: true })
    .click();
  const download = await downloading;
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents).not.toContain("PRIVATE_FEEDBACK");
  expect(contents).not.toContain("data-persona-note-");
  expect(contents).toContain('"manuscript"');
  expect(await source.innerText()).toBe(before);
});
