// Current Tiptap default break-word + original CSS/fonts, isolated browser.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const output = process.env.TWYNE_LONG_WORD_OUTPUT ?? "/tmp/twyne-long-word-web";
await mkdir(output, { recursive: true });
const source = await Bun.file(
  new URL("../../../../src/global.css", import.meta.url),
).text();
const theme = source.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1];
if (!theme) throw new Error("Original theme missing");
const css = source
  .replace(/@import\s+[^;]+;/g, "")
  .replace(/@theme\s*\{[\s\S]*?\n\}/, `:root{${theme}}`);
const preflight = await Bun.file(
  new URL(
    "../../../../node_modules/tailwindcss/preflight.css",
    import.meta.url,
  ),
).text();
let fonts = "";
for (const [name, style] of [
  ["lora-Lora-wght.ttf", "normal"],
  ["lora-Lora-Italic-wght.ttf", "italic"],
] as const) {
  const bytes = await Bun.file(
    new URL(
      `../../../../src/assets/typst/${name}`,
      import.meta.url,
    ),
  ).bytes();
  fonts += `@font-face{font-family:Lora;font-weight:400 700;font-style:${style};src:url(data:font/ttf;base64,${Buffer.from(bytes).toString("base64")})}`;
}
const bundle = await Bun.build({
  entrypoints: [
    new URL(
      process.env.TWYNE_RICH_FIXTURE_ENTRY ?? "long-word-web-entry.ts",
      import.meta.url,
    ).pathname,
  ],
  target: "browser",
  format: "iife",
});
if (!bundle.success) throw new Error(bundle.logs.join("\n"));
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 680, height: 1900 },
  });
  let blockedNetworkRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent(
    `<html lang=en><body><div class="twyne-editor ${process.env.TWYNE_RICH_FIXTURE_QUIET === "1" ? "zen-mode" : ""}" id=fixture></div></body></html>`,
  );
  const componentSource = await Bun.file(
    new URL(
      "../../../../src/components/editor/twyne-editor.tsx",
      import.meta.url,
    ),
  ).text();
  const quietRule =
    componentSource.match(
      /\.twyne-editor\.zen-mode \.ProseMirror \.twyne-comment-mark\s*\{[^}]*\}/,
    )?.[0] ?? "";
  await page.addStyleTag({
    content: `${preflight}\n${fonts}\n${css}\n${quietRule}\nbody{margin:0;padding:40px;background:var(--color-paper)}.twyne-editor{padding:0!important;max-width:none!important;width:600px}.ProseMirror{padding:0!important;min-height:0!important}`,
  });
  await page.addScriptTag({ content: await bundle.outputs[0].text() });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const report = await page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll(".ProseMirror p")].map(
      (paragraph) => {
        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT,
        );
        const lines = new Map<
          number,
          { text: string; ranges: number[][]; right: number }
        >();
        let source = "";
        let scalar = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
          let utf16 = 0;
          source += node.textContent;
          for (const character of node.textContent!) {
            const range = document.createRange();
            range.setStart(node, utf16);
            utf16 += character.length;
            range.setEnd(node, utf16);
            const bounds = range.getBoundingClientRect();
            const key = Math.round(bounds.top * 64);
            const line = lines.get(key) ?? {
              text: "",
              ranges: [],
              right: bounds.right,
            };
            line.text += character;
            line.ranges.push([scalar, scalar + 1]);
            line.right = Math.max(line.right, bounds.right);
            lines.set(key, line);
            scalar++;
          }
        }
        const style = getComputedStyle(paragraph);
        return {
          source,
          lineTexts: [...lines.values()].map((line) => line.text),
          lines: [...lines.values()],
          width: paragraph.getBoundingClientRect().width,
          right: paragraph.getBoundingClientRect().right,
          overflowWrap: style.overflowWrap,
          wordBreak: style.wordBreak,
          hyphens: style.hyphens,
          whiteSpace: style.whiteSpace,
        };
      },
    );
    const chips = [...document.querySelectorAll(".twyne-mark-anchor")].map(
      (chip) => ({
        id: chip.getAttribute("data-anchor-id"),
        kind: chip.getAttribute("data-anchor-kind"),
        bounds: chip.getBoundingClientRect().toJSON(),
        visibility: getComputedStyle(chip).visibility,
      }),
    );
    const comments = [...document.querySelectorAll(".twyne-comment-mark")].map(
      (mark) => ({
        id: mark.getAttribute("data-comment-id"),
        text: mark.textContent,
        bounds: mark.getBoundingClientRect().toJSON(),
      }),
    );
    return {
      paragraphs,
      chips,
      comments,
      fonts: [...document.fonts].map((face) => ({
        family: face.family,
        weight: face.weight,
        style: face.style,
        status: face.status,
      })),
      fontSource: "bundled Lora variable3.008; original current Google Lora3.008",
      html: (window as any).twyneLongWordEditor.getHTML(),
    };
  });
  if (errors.length || blockedNetworkRequests)
    throw new Error(JSON.stringify({ errors, blockedNetworkRequests }));
  await page.locator(".ProseMirror").screenshot({ path: `${output}/web.png` });
  await Bun.write(
    `${output}/reference.json`,
    `${JSON.stringify({ browser: browser.version(), blockedNetworkRequests, ...report }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      output,
      blockedNetworkRequests,
      lines: report.paragraphs.map((paragraph) => paragraph.lineTexts),
    }),
  );
} finally {
  await browser.close();
}
