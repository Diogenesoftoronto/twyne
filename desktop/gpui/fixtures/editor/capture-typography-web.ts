// Verification only: bun desktop/gpui/fixtures/editor/capture-typography-web.ts
// Uses current web CSS/preflight and local source fonts, with network blocked.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const output = process.env.TWYNE_EDITOR_TYPOGRAPHY_OUTPUT ?? "/tmp/twyne-editor-typography";
await mkdir(output, { recursive: true });
const sourceCss = await Bun.file(new URL("../../../../src/global.css", import.meta.url)).text();
const theme = sourceCss.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1];
if (!theme) throw new Error("Web theme tokens were not found");
const css = sourceCss
  .replace(/@import\s+[^;]+;/g, "")
  .replace(/@theme\s*\{[\s\S]*?\n\}/, `:root{${theme}}`);
const preflight = await Bun.file(new URL("../../../../node_modules/tailwindcss/preflight.css", import.meta.url)).text();
let fonts = "";
for (const [family, asset, weight] of [
  ["Lora", "lora-Lora-Regular.ttf", 400],
  ["Lora", "lora-Lora-Bold.ttf", 700],
  ["DM Sans", "dmsans-DMSans-Bold.ttf", 700],
  ["Special Elite", "specialelite-SpecialElite-Regular.ttf", 400],
] as const) {
  const bytes = await Bun.file(new URL(`../../../../src/assets/typst/${asset}`, import.meta.url)).bytes();
  fonts += `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/ttf;base64,${Buffer.from(bytes).toString("base64")})}`;
}

const html = `<h3 data-future-heading="keep">Straße élan</h3><h4>Mixed Fourth</h4><h5>Fifth</h5><h6>Sixth</h6><p>A<sup data-type="endnote" class="twyne-endnote" data-endnote-text="First" data-future-note="keep"></sup> B<sup data-type="footnote" class="twyne-endnote" data-endnote-text="Foot one"></sup>.</p><p>C<sup data-type="endnote" class="twyne-endnote" data-endnote-text="Second"></sup> D<sup data-type="footnote" class="twyne-endnote" data-endnote-text="Foot two"></sup>.</p>`;
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 450 }, deviceScaleFactor: 2 });
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.setContent(`<html><head></head><body><div class="twyne-editor"><div class="ProseMirror">${html}</div></div></body></html>`);
  await page.addStyleTag({ content: `${preflight}\n${fonts}\n${css}\nbody{margin:0}.twyne-editor{padding:0!important;max-width:none!important;width:680px}.ProseMirror{padding:0!important}` });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(300);
  const report = await page.evaluate(() => {
    const describe = (element: Element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        sourceText: element.textContent,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textTransform: style.textTransform,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        verticalAlign: style.verticalAlign,
        top: style.top,
        color: style.color,
        paddingLeft: style.paddingLeft,
        pseudoContent: getComputedStyle(element, "::after").content,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      };
    };
    return {
      headings: [...document.querySelectorAll("h3,h4,h5,h6")].map(describe),
      notes: [...document.querySelectorAll(".twyne-endnote")].map(describe),
      html: document.querySelector(".ProseMirror")!.innerHTML,
    };
  });
  await page.locator(".ProseMirror").screenshot({ path: `${output}/web-heading-notes.png` });
  await Bun.write(`${output}/web-heading-notes.json`, `${JSON.stringify({ ...report, blockedNetworkRequests, provenance: "Current global.css + Tailwind preflight; original local fonts; raw preserved imported H4–H6" }, null, 2)}\n`);
  console.log(JSON.stringify({ output, blockedNetworkRequests, headings: report.headings, notes: report.notes }, null, 2));
} finally {
  await browser.close();
}
