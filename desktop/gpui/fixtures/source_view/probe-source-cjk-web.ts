// Actual original CodeMirror source/font proof in a new zero-network Chrome.
// Verification only: no shipping browser dependency or personal browser tabs.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const output =
  process.env.TWYNE_SOURCE_CJK_OUTPUT ?? "/tmp/twyne-source-cjk-web";
await mkdir(output, { recursive: true });
const css = (await Bun.file(`${root}/src/global.css`).text())
  .replace('@import "tailwindcss";', "")
  .replace(/^@source[^;]+;/m, "")
  .replace("@theme {", ":root {");
const preflight = await Bun.file(
  `${root}/node_modules/tailwindcss/preflight.css`,
).text();
const source = await Bun.file(`${directory}/source-cjk.typ`).text();
const build = await Bun.build({
  entrypoints: [`${directory}/capture-client.ts`],
  target: "browser",
  format: "esm",
});
if (!build.success) throw new Error(String(build.logs));
const bundle = Buffer.from(await build.outputs[0].text()).toString("base64");
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 160 } });
  let networkRequests = 0;
  await page.route("**/*", async (route) => {
    networkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent(
    `<!doctype html><style>${preflight}\n${css}\nbody{margin:0}#source{height:160px}</style><div id=source></div>`,
  );
  const geometry = await page.evaluate(
    async ({ bundle, source }) => {
      const original = await import(`data:text/javascript;base64,${bundle}`);
      original.applyTheme(
        { preset: "editorial" },
        document.documentElement,
        false,
      );
      const editor = original.mountTypstCodeEditor(
        document.getElementById("source")!,
        source,
        {
          readOnly: false,
          onChange() {},
          onApply() {},
        },
      );
      const view = original.EditorView.findFromDOM(
        document.querySelector(".cm-editor")!,
      );
      if (!view) throw new Error("Original Source editor was not mounted");
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        compatMode: document.compatMode,
        doctype: document.doctype?.name,
        source: view.state.doc.toString(),
        sourceUnchanged: view.state.doc.toString() === source,
        undo: original.undoDepth(view.state),
        redo: original.redoDepth(view.state),
        lines: Array.from(
          document.querySelectorAll<HTMLElement>(".cm-line"),
          (line) => {
            const style = getComputedStyle(line);
            const bounds = line.getBoundingClientRect();
            const glyphs = [];
            let prefix = "";
            const walker = document.createTreeWalker(
              line,
              NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = walker.nextNode())) {
              for (
                let offset = 0;
                offset < (node.textContent?.length ?? 0);
                offset++
              ) {
                const character = node.textContent![offset];
                if (!"東京/m=é".includes(character)) continue;
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                const bounds = range.getBoundingClientRect();
                glyphs.push({
                  character,
                  sourceByteOffset: new TextEncoder().encode(
                    prefix + node.textContent!.slice(0, offset),
                  ).length,
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                });
              }
              prefix += node.textContent ?? "";
            }
            return {
              text: line.textContent,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              bounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              },
              glyphs,
            };
          },
        ),
      };
    },
    { bundle, source },
  );
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const {
    root: { nodeId },
  } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await session.send("DOM.querySelectorAll", {
    nodeId,
    selector: ".cm-line",
  });
  const fonts = [];
  for (const nodeId of nodeIds)
    fonts.push(await session.send("CSS.getPlatformFontsForNode", { nodeId }));
  if (
    networkRequests ||
    !geometry.sourceUnchanged ||
    geometry.undo ||
    geometry.redo
  )
    throw new Error(
      "Original Source CJK probe attempted network or changed source/history",
    );
  const report = {
    browser: browser.version(),
    networkRequests,
    reference:
      "Original CodeMirror, global.css, Tailwind preflight, and actual platform fallback faces; no injected CJK or monospace font",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    fonts,
    geometry,
  };
  await Bun.write(
    `${output}/web-fonts.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await page.screenshot({ path: `${output}/web.png` });
  console.log(
    JSON.stringify({
      output,
      browser: browser.version(),
      networkRequests,
      fonts,
    }),
  );
} finally {
  await browser.close();
}
