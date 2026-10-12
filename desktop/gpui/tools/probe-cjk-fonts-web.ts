// Inspect actual platform faces in the original writing fixture. Verification
// only: fresh local Chrome, no user tabs and no shipping browser dependency.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output =
  process.env.TWYNE_CJK_FONT_PROBE_DIR ?? "/tmp/twyne-cjk-fonts-web";
await mkdir(output, { recursive: true });
const source = await Bun.file(`${root}/src/global.css`).text();
const css = source
  .replace(/@import\s+[^;]+;/g, "")
  .replace(/@theme\s*\{([\s\S]*?)\n\}/, ":root{$1}");
const preflight = await Bun.file(
  `${root}/node_modules/tailwindcss/preflight.css`,
).text();
const lora = await Bun.file(
  `${root}/src/assets/typst/lora-Lora-Regular.ttf`,
).bytes();
const bundle = await Bun.build({
  entrypoints: [`${root}/desktop/gpui/fixtures/editor/long-word-web-entry.ts`],
  target: "browser",
  format: "iife",
});
if (!bundle.success) throw new Error(String(bundle.logs));
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 680, height: 1900 },
  });
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent(
    "<html lang=en><body><div class=twyne-editor id=fixture></div></body></html>",
  );
  await page.addStyleTag({
    content: `${preflight}\n@font-face{font-family:Lora;src:url(data:font/ttf;base64,${Buffer.from(lora).toString("base64")})}\n${css}\nbody{margin:0;padding:40px;background:var(--color-paper)}.twyne-editor{padding:0!important;max-width:none!important;width:600px}.ProseMirror{padding:0!important;min-height:0!important}`,
  });
  await page.addScriptTag({ content: await bundle.outputs[0].text() });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const {
    root: { nodeId },
  } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await session.send("DOM.querySelectorAll", {
    nodeId,
    selector: ".ProseMirror p",
  });
  const fonts = [];
  for (const nodeId of nodeIds) {
    fonts.push(await session.send("CSS.getPlatformFontsForNode", { nodeId }));
  }
  const styles = await page.locator(".ProseMirror p").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      const text = node.firstChild;
      const cjkGlyphs = [];
      if (text?.nodeType === Node.TEXT_NODE) {
        for (let index = 0; index < (text.textContent?.length ?? 0); index++) {
          const character = text.textContent?.[index];
          if (character !== "東" && character !== "京") continue;
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const rect = range.getBoundingClientRect();
          cjkGlyphs.push({
            character,
            sourceUtf16: index,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      }
      return {
        text: node.textContent,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontStyle: style.fontStyle,
        fontSynthesis: style.fontSynthesis,
        bounds: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        cjkGlyphs,
      };
    }),
  );
  if (blockedNetworkRequests)
    throw new Error("Original font probe tried external resources");
  if (
    !fonts[4]?.fonts.some(
      (font) =>
        font.postScriptName === "DroidSansFallback" && font.glyphCount === 100,
    )
  ) {
    throw new Error(
      "This browser's actual CJK fallback differs from the pinned Droid reference",
    );
  }
  const report = {
    browser: browser.version(),
    blockedNetworkRequests,
    source:
      "original global.css, Lora-Regular, and installed Tiptap long-word fixture",
    fonts,
    styles,
    screenshotBounds: await page.locator(".ProseMirror").boundingBox(),
  };
  await Bun.write(
    `${output}/web-fonts.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await page.locator(".ProseMirror").screenshot({ path: `${output}/web.png` });
  console.log(
    JSON.stringify({
      output,
      browser: report.browser,
      blockedNetworkRequests,
      fonts,
    }),
  );
} finally {
  await browser.close();
}
