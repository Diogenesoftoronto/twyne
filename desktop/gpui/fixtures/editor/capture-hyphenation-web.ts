// Verification only: bun desktop/gpui/fixtures/editor/capture-hyphenation-web.ts
// The original quiet writing fixture, source CSS/fonts, actual Tiptap opening
// decoration, original scalar offsets, and no remote asset requests.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const output = process.env.TWYNE_HYPHENATION_OUTPUT ?? "/tmp/twyne-editor-hyphenation";
const width = Number(process.env.TWYNE_HYPHENATION_WIDTH ?? 1104);
await mkdir(output, { recursive: true });
const sourceCss = await Bun.file(new URL("../../../../src/global.css", import.meta.url)).text();
const theme = sourceCss.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1];
if (!theme) throw new Error("Current web theme was not found");
const css = sourceCss.replace(/@import\s+[^;]+;/g, "").replace(/@theme\s*\{[\s\S]*?\n\}/, `:root{${theme}}`);
const preflight = await Bun.file(new URL("../../../../node_modules/tailwindcss/preflight.css", import.meta.url)).text();
let fonts = "";
for (const [family, asset, weight] of [
  ["Lora", "lora-Lora-Regular.ttf", 400],
  ["Lora", "lora-Lora-Bold.ttf", 700],
  ["Libre Baskerville", "librebaskerville-LibreBaskerville-Regular.ttf", 400],
  ["Libre Baskerville", "librebaskerville-LibreBaskerville-Bold.ttf", 700],
] as const) {
  const bytes = await Bun.file(new URL(`../../../../src/assets/typst/${asset}`, import.meta.url)).bytes();
  fonts += `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/ttf;base64,${Buffer.from(bytes).toString("base64")})}`;
}
const html = (await Bun.file(new URL("quiet-writing.html", import.meta.url)).text()).trim();
const bundle = await Bun.build({
  entrypoints: [new URL("hyphenation-web-entry.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
  minify: false,
});
if (!bundle.success) throw new Error(bundle.logs.join("\n"));
const javascript = await bundle.outputs[0].text();
const browser = await chromium.launch({ executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome", headless: true });
try {
  for (const manual of [false, true]) {
    const page = await browser.newPage({ viewport: { width: width + 80, height: 650 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => console.error(error.message));
    page.on("requestfailed", (request) => console.error("Local fixture request failed", request.url(), request.failure()));
    let localAssetRequests = 0;
    let blockedNetworkRequests = 0;
    await page.route("**/*", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (/^\/assets\/illuminated-initials\/[a-z](?:-alt)?\.avif$/.test(pathname)) {
        localAssetRequests++;
        return route.fulfill({ body: Buffer.from(await Bun.file(new URL(`../../../../public${pathname}`, import.meta.url)).bytes()), contentType: "image/avif" });
      }
      blockedNetworkRequests++;
      await route.abort();
    });
    await page.goto("about:blank");
    await page.setContent(`<html lang="en"><head></head><body><div class="twyne-editor" id="fixture"></div></body></html>`);
    await page.addStyleTag({ content: `${preflight}\n${fonts}\n${css}\nbody{margin:0;padding:40px;background:var(--color-paper)}.twyne-editor{padding:0!important;max-width:none!important;width:${width}px}.ProseMirror{padding:0!important;min-height:0!important}` });
    await page.evaluate(({ html, manual }) => { window.twyneHyphenationFixture = { html, manual }; }, { html, manual });
    // Give relative local artwork URLs an origin without contacting a server.
    await page.addScriptTag({ content: "document.head.insertAdjacentHTML('afterbegin','<base href=\"http://twyne.fixture/\">')" });
    await page.addScriptTag({ content: javascript });
    await page.evaluate(async () => { await document.fonts.ready; });
    try {
      await page.waitForFunction(() => !!document.querySelector(".twyne-illuminated-initial.is-illuminated"), undefined, { timeout: 5000 });
    } catch (error) {
      console.error({ localAssetRequests, blockedNetworkRequests, decoratedHtml: await page.locator(".ProseMirror").innerHTML() });
      throw error;
    }
    const report = await page.evaluate(() => {
      const paragraphs = [...document.querySelectorAll(".ProseMirror p")].map((paragraph) => {
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        const lines = new Map<number, { text: string; range: number[]; left: number; right: number; top: number }>();
        let scalar = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
          let utf16 = 0;
          for (const character of node.textContent!) {
            const range = document.createRange();
            range.setStart(node, utf16);
            utf16 += character.length;
            range.setEnd(node, utf16);
            const rect = range.getBoundingClientRect();
            if (!(node.parentElement?.closest(".twyne-illuminated-initial"))) {
              const key = Math.round(rect.top * 64);
              let line = lines.get(key);
              if (!line) {
                line = { text: "", range: [scalar, scalar], left: rect.left, right: rect.right, top: rect.top };
                lines.set(key, line);
              }
              line.text += character;
              line.range[1] = scalar + 1;
              line.left = Math.min(line.left, rect.left);
              line.right = Math.max(line.right, rect.right);
            }
            scalar++;
          }
        }
        const style = getComputedStyle(paragraph);
        return { sourceText: paragraph.textContent, sourceScalars: scalar, hyphens: style.hyphens, font: style.font, bounds: paragraph.getBoundingClientRect().toJSON(), lines: [...lines.values()] };
      });
      return { paragraphs, html: window.twyneFixtureEditor.getHTML(), decoratedHtml: document.querySelector(".ProseMirror")!.innerHTML };
    });
    const mode = manual ? "manual" : "auto";
    await page.locator(".ProseMirror").screenshot({ path: `${output}/web-${mode}.png` });
    await Bun.write(`${output}/web-${mode}.json`, `${JSON.stringify({ width, browser: browser.version(), mode, localAssetRequests, blockedNetworkRequests, ...report }, null, 2)}\n`);
    console.log(JSON.stringify({ mode, width, localAssetRequests, blockedNetworkRequests, lines: report.paragraphs.map((paragraph) => paragraph.lines.map((line) => line.text)) }));
    await page.close();
  }
} finally {
  await browser.close();
}
