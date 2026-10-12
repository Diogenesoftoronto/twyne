// Parameter flows in the actual original editor, with synthetic local writing.
import { chromium, expect, type Locator } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("A new owned output directory is required");
const origin = process.env.TWYNE_INSERT_SOURCE_URL ?? "http://127.0.0.1:5207";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("A loopback Source origin is required");
await mkdir(output, { recursive: false, mode: 0o700 });
const paths = ["src/components/editor/table-insertion-grid.tsx", "src/components/editor/insert-panels.tsx", "src/components/ui/text-modal.tsx", "src/components/editor/twyne-editor.tsx", "src/components/editor/slash-command-menu.tsx", "src/utils/keybindings.ts", "src/global.css", "desktop/gpui/fixtures/insert-menu/capture-parameters.ts"];
const hashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const receipt: any = { status: "running", origin, hashes, viewport: { width: 948, height: 640 }, deviceScaleFactor: 1, accountAuthenticated: false, userLibraryAccessed: false, scope: "Original browser editor; no Electrobun host proof", cases: [], pageErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome", headless: true });
try {
  for (const kind of ["table", "endnote", "footnote", "mermaid", "image", "math-inline", "math-block"]) {
    const context = await browser.newContext({ viewport: receipt.viewport, deviceScaleFactor: 1 });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === origin || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => receipt.pageErrors.push(error.message));
    await page.route(/\/api\/auth\//, route => route.fulfill({ contentType: "application/json", body: "null" }));
    await page.route("**/__insert-seed", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Parameter fixture</title>" }));
    await page.goto(origin + "/__insert-seed");
    await page.evaluate(async () => {
      const path = "/src/utils/idb.ts";
      const idb = await import(/* @vite-ignore */ path);
      const now = Date.now();
      await idb.saveFoliosToIdb([{ id: "insert-parameter-fixture", name: "The writing page", type: "draft", createdAt: now, updatedAt: now }]);
      await idb.saveFolioContentToIdb("insert-parameter-fixture", "<p>The manuscript stays on this page.</p><p></p>");
      await idb.saveActiveFolioIdToIdb("insert-parameter-fixture");
      await idb.saveMetaToIdb("signin-toast-dismissed", true);
    });
    await page.goto(origin + "/editor/?platform=desktop");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("The manuscript stays on this page.", { timeout: 90_000 });
    const zen = page.getByRole("button", { name: "Toggle Zen mode", exact: true });
    if (await zen.getAttribute("aria-pressed") === "true") await zen.click();
    await editor.locator("p").last().click();
    const query = kind.startsWith("math-") ? "math" : kind;
    await page.keyboard.type("/" + query);
    const menu = page.getByRole("listbox", { name: "Insert command", exact: true });
    await expect(menu).toBeVisible();
    await menu.locator(`#slash-command-insert-${kind}`).click();
    await expect(menu).toHaveCount(0);
    await expect(editor).not.toContainText("/" + query);
    await page.evaluate(() => document.fonts.ready);
    let surface: Locator;
    let tableInitial: unknown;
    if (kind === "table") {
      surface = page.locator("[data-table-insertion-grid]");
      const grid = page.getByRole("grid", { name: "Choose table size", exact: true });
      await expect(grid).toHaveAttribute("aria-rowcount", "8");
      await expect(grid).toHaveAttribute("aria-colcount", "10");
      await expect(surface.locator("p").first()).toHaveText("1 × 1 table");
      await expect(grid.locator('[aria-selected="true"]')).toHaveCount(1);
      await page.mouse.move(0, 0);
      await surface.screenshot({ path: resolve(output, "table-initial.png"), animations: "disabled" });
      tableInitial = await surface.evaluate(element => {
        const b = element.getBoundingClientRect();
        return { rect: { x: b.x, y: b.y, width: b.width, height: b.height }, caption: element.querySelector("p")?.textContent,
          gridFocused: Boolean(document.activeElement?.closest("[role='grid']")), selectedCells: element.querySelectorAll('[aria-selected="true"]').length };
      });
      await grid.focus();
      await page.keyboard.press("ArrowDown");
      await expect(surface.locator("p").first()).toHaveText("2 × 1 table");
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("ArrowRight");
        await expect(surface.locator("p").first()).toHaveText(`2 × ${i + 2} table`);
      }
      await expect(grid.locator('[aria-selected="true"]')).toHaveCount(8);
    } else if (kind.startsWith("math-")) {
      surface = editor.locator(`[data-type='${kind === "math-inline" ? "inline-math" : "block-math"}']`);
      await expect(surface).toHaveCount(1);
      await expect(surface).toHaveAttribute("data-latex", "");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(surface.locator(".twyne-math-loading")).toHaveCount(0);
    } else if (kind === "image") {
      surface = page.getByText("Plate URL:", { exact: true }).locator("..");
    } else {
      surface = page.getByRole("dialog");
    }
    await expect(surface).toBeVisible();
    await page.mouse.move(0, 0);
    await surface.screenshot({ path: resolve(output, kind + ".png"), animations: "disabled" });
    await page.screenshot({ path: resolve(output, kind + "-full.png"), animations: "disabled" });
    const observed = await surface.evaluate(element => {
      const rect = (node: Element) => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      return { rect: rect(element), nodes: [element, ...element.querySelectorAll("p, h2, label, button, textarea, input, [role='grid']")].map(node => {
        const s = getComputedStyle(node);
        return { tag: node.tagName, text: node.textContent, role: node.getAttribute("role"), label: node.getAttribute("aria-label"), placeholder: node.getAttribute("placeholder"), focused: document.activeElement === node, rect: rect(node), fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle, lineHeight: s.lineHeight, padding: s.padding, color: s.color, background: s.backgroundColor, opacity: s.opacity, border: s.border, borderRadius: s.borderRadius, boxShadow: s.boxShadow };
      }) };
    });
    const result: any = { kind, queryRemovedAtActivation: true, observed, ...(tableInitial ? { initial: tableInitial } : {}) };
    if (["endnote", "footnote", "mermaid"].includes(kind)) {
      const input = surface.locator("textarea");
      result.initialInputFocused = await input.evaluate(node => document.activeElement === node);
      await input.focus();
      await expect(input).toBeFocused();
      await surface.screenshot({ path: resolve(output, kind + "-focused.png"), animations: "disabled" });
      result.explicitInputFocusCaptured = true;
    }
    if (kind.startsWith("math-")) {
      result.blankAtomInsertedImmediately = true;
      result.parameterDialogOpened = false;
    } else if (kind === "table") {
      await page.keyboard.press("Enter");
      await expect(surface).toHaveCount(0);
      await expect(editor.locator("table tr")).toHaveCount(2);
      await expect(editor.locator("table th")).toHaveCount(4);
      await expect(editor.locator("table td")).toHaveCount(4);
      result.keyboardInserts2By4WithHeader = true;
    } else {
      await surface.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(surface).toHaveCount(0);
      await expect(editor).not.toContainText("/" + kind);
      result.cancelKeepsQueryRemoved = true;
    }
    receipt.cases.push(result);
    await context.close();
  }
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify({ output, status: receipt.status, cases: receipt.cases.length, pageErrors: receipt.pageErrors.length }));
