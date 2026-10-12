// Actual Source slash menu with a fresh browser, isolated IDB and no account.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("A new owned output directory is required");
const origin = process.env.TWYNE_INSERT_SOURCE_URL ?? "http://127.0.0.1:5207";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("A local Source origin is required");
await mkdir(output, { recursive: false, mode: 0o700 });
const paths = ["src/components/editor/extensions/slash-command.ts", "src/components/editor/slash-command-menu.tsx", "src/utils/slash-command-filter.ts", "src/utils/editor-commands.ts", "src/components/editor/twyne-editor.tsx", "src/global.css", "desktop/gpui/fixtures/insert-menu/capture-source.ts"];
const hashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const receipt: any = { status: "running", origin, hashes, viewport: { width: 948, height: 640 }, deviceScaleFactor: 1, accountAuthenticated: false, userLibraryAccessed: false, scope: "Original browser-rendered editor; no Electrobun host proof", cases: [], pageErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: receipt.viewport, deviceScaleFactor: 1 });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => receipt.pageErrors.push(error.message));
  await page.route(/\/api\/auth\//, route => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/__insert-seed", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Insert menu fixture</title>" }));
  await page.goto(origin + "/__insert-seed");
  await page.evaluate(async () => {
    const modulePath = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ modulePath);
    const now = Date.now();
    await idb.saveFoliosToIdb([{ id: "insert-menu-fixture", name: "The writing page", type: "draft", createdAt: now, updatedAt: now }]);
    await idb.saveFolioContentToIdb("insert-menu-fixture", "<p>The manuscript stays on this page.</p><p></p>");
    await idb.saveActiveFolioIdToIdb("insert-menu-fixture");
    await idb.saveMetaToIdb("signin-toast-dismissed", true);
  });
  await page.goto(origin + "/editor/?platform=desktop");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("The manuscript stays on this page.", { timeout: 90_000 });
  const zen = page.getByRole("button", { name: "Toggle Zen mode", exact: true });
  if (await zen.getAttribute("aria-pressed") === "true") await zen.click();
  await editor.locator("p").last().click();
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert command", exact: true });
  await expect(menu).toBeVisible();
  const record = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await menu.screenshot({ path: resolve(output, name + "-menu.png"), animations: "disabled" });
    await page.screenshot({ path: resolve(output, name + "-full.png"), animations: "disabled" });
    const observed = await menu.evaluate(element => {
      const rect = (node: Element) => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      return { rect: rect(element), selected: element.getAttribute("aria-activedescendant"), nodes: Array.from(element.querySelectorAll("p, button, span, kbd")).map(node => {
        const s = getComputedStyle(node);
        return { tag: node.tagName, text: node.textContent, rect: rect(node), fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, padding: s.padding, color: s.color, background: s.backgroundColor, border: s.border };
      }) };
    });
    receipt.cases.push({ name, observed });
  };
  await record("unfiltered");
  const caret = () => page.evaluate(() => { const s = getSelection(); return { anchor: s?.anchorNode?.textContent, anchorOffset: s?.anchorOffset, focus: s?.focusNode?.textContent, focusOffset: s?.focusOffset }; });
  const before = await caret();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toHaveAttribute("aria-activedescendant", "slash-command-insert-table");
  await page.keyboard.press("ArrowUp");
  expect(await caret()).toEqual(before);
  await page.keyboard.type("table");
  await expect(menu).toHaveAttribute("aria-activedescendant", "slash-command-insert-table");
  await record("table");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(editor).toContainText("/table");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("h2");
  await expect(menu).toHaveAttribute("aria-activedescendant", "slash-command-paragraph-heading-2");
  await record("heading");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(editor).not.toContainText("/h2");
  await page.keyboard.type("A heading");
  await expect(editor.locator("h2")).toContainText("A heading");
  await expect(editor).not.toContainText("/h2");
  receipt.interactions = { arrowsPreserveCaret: true, filtering: true, escapePreservesQuery: true, enterCreatesHeading: true };
  receipt.status = "passed";
  await context.close();
} catch (error) {
  receipt.status = "failed";
  receipt.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify({ output, status: receipt.status, cases: receipt.cases.length, pageErrors: receipt.pageErrors.length }));
