// Actual Source AccountMenu/AuthPanel, fresh browser and synthetic local IDB.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("A new owned output directory is required");
const origin = process.env.TWYNE_ACCOUNT_SOURCE_URL ?? "http://127.0.0.1:5207";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Local Source origin required");
await mkdir(output, { recursive: false, mode: 0o700 });
const paths = ["src/components/auth/account-menu.tsx", "src/components/auth/auth-panel.tsx",
  "src/global.css", "src/utils/account-display.ts", "desktop/gpui/fixtures/connected-work/capture-account-source.ts",
  "desktop/gpui/fixtures/connected-work/account-menu-manuscript.html"];
const hashes = Object.fromEntries(await Promise.all(paths.map(async (path) => [path,
  createHash("sha256").update(await readFile(path)).digest("hex")] as const)));
const receipt: Record<string, unknown> = { status: "running", scope: "Actual Source guest account menu in isolated browser; no real account or Electrobun-host proof",
  origin, hashes, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, accountAuthenticated: false };
const errors: string[] = [];
const browser = await chromium.launch({ executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/api\/auth\//, (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/__account-seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Account menu fixture</title>" }));
  await page.goto(origin + "/__account-seed");
  const html = await readFile("desktop/gpui/fixtures/connected-work/account-menu-manuscript.html", "utf8");
  await page.evaluate(async (html) => {
    const idbPath = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const now = Date.now();
    await idb.saveFoliosToIdb([{ id: "account-menu-fixture", name: "Account menu fixture", type: "draft", createdAt: now, updatedAt: now }]);
    await idb.saveFolioContentToIdb("account-menu-fixture", html);
    await idb.saveActiveFolioIdToIdb("account-menu-fixture");
    await idb.saveMetaToIdb("signin-toast-dismissed", true);
  }, html);
  await page.goto(origin + "/editor/?platform=desktop");
  await expect(page.locator(".ProseMirror")).toContainText("The local manuscript stays here", { timeout: 90_000 });
  const zen = page.getByRole("button", { name: "Toggle Zen mode", exact: true });
  if (await zen.getAttribute("aria-pressed") === "true") await zen.click();
  const trigger = page.getByRole("button", { name: "Open the editor's office (account)", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.locator(".folio").filter({ has: page.getByRole("button", { name: "Continue with Not Organic", exact: true }) });
  await expect(panel).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  receipt.observed = await panel.evaluate((element) => {
    const rect = (node: Element) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
    const selectors = ["button", ".dept-label", "p", "div.border-b"];
    return { rect: rect(element), text: element.textContent, nodes: selectors.flatMap((selector) =>
      Array.from(element.querySelectorAll(selector)).map((node) => {
        const style = getComputedStyle(node);
        return { selector, text: node.textContent, rect: rect(node), fontFamily: style.fontFamily,
          fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
          padding: style.padding, color: style.color, background: style.backgroundColor, border: style.border,
          svg: node.querySelector("svg")?.outerHTML };
      })) };
  });
  receipt.fontFaces = await page.evaluate(() => Array.from(document.fonts).map((face) => ({ family: face.family, weight: face.weight, style: face.style, status: face.status })));
  await panel.screenshot({ path: resolve(output, "account-panel.png"), animations: "disabled" });
  await page.screenshot({ path: resolve(output, "account-full.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.locator(".ProseMirror").click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("The local manuscript stays here");
  receipt.interactions = { escapeDismissed: true, outsideDismissed: true, manuscriptPreserved: true };
  if (errors.length) throw new Error("Source account fixture had runtime errors");
  receipt.status = "passed";
  await context.close();
} catch (error) {
  receipt.status = "failed";
  receipt.failure = error instanceof Error ? error.message : "Source capture failed";
  throw error;
} finally {
  receipt.pageErrors = errors;
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify({ output, status: receipt.status, pageErrors: errors.length }));
