// Read-only verification of ordinary original Source wrapping. No shipping browser.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const output =
  process.env.TWYNE_SOURCE_HYPHEN_OUTPUT ?? "/tmp/twyne-source-hyphen-web";
await mkdir(output, { recursive: true });
const css = (await Bun.file(`${root}/src/global.css`).text())
  .replace('@import "tailwindcss";', "")
  .replace(/^@source[^;]+;/m, "")
  .replace("@theme {", ":root {");
const preflight = await Bun.file(
  `${root}/node_modules/tailwindcss/preflight.css`,
).text();
const sources = [
  { id: "marker-ordinary", text: "// twyne-document:1" },
  { id: "ascii-hyphen", text: "opening-concrete-after-midnight" },
  { id: "ascii-with-prefix", text: "prefix opening-concrete-after-midnight" },
  {
    id: "keyword-hyphen",
    text: '#stroke-dash("opening-concrete-after-midnight")',
  },
  { id: "heading-hyphen", text: "= opening-concrete-after-midnight" },
  { id: "comment-hyphen", text: "// opening-concrete-after-midnight" },
  { id: "leading-hyphen", text: "-opening-concrete-after-midnight" },
  {
    id: "spaced-leading-hyphen",
    text: "prefix -opening-concrete-after-midnight",
  },
  { id: "numeric-hyphen", text: "2026-10-04-2026-10-04-2026-10-04" },
  { id: "letter-digit", text: "opening-1234567890-after-midnight" },
  { id: "minus-digit", text: "-12345678901234567890 + -12345678901234567890" },
  { id: "hyphen-repeat", text: "opening--concrete---after-midnight" },
  { id: "unicode-hyphen", text: "opening‐concrete‐after‐midnight" },
  { id: "nonbreaking-hyphen", text: "opening‑concrete‑after‑midnight" },
  { id: "en-dash", text: "opening–concrete–after–midnight" },
  { id: "em-dash", text: "opening—concrete—after—midnight" },
  {
    id: "combining-hyphen",
    text: "Cafe\u0301-opening-concrete-after-midnight",
  },
  { id: "space-control", text: "opening concrete after midnight" },
  { id: "slash-control", text: "opening/concrete/after/midnight" },
  { id: "underscore-control", text: "opening_concrete_after_midnight" },
  { id: "question-control", text: "opening?concrete?after?midnight" },
  { id: "parentheses-control", text: "opening(concrete(after(midnight)))" },
  { id: "leading-indent", text: "    opening-concrete-after-midnight" },
  { id: "repeated-space", text: "opening   concrete  after midnight" },
  { id: "parenthesized-minus", text: "(-12345678901234567890)" },
  { id: "trailing-space", text: "opening-concrete-after-midnight   " },
  { id: "cjk-hyphen", text: "東京-opening-concrete-after-midnight" },
  { id: "tab-control", text: "\topening-concrete-after-midnight" },
] as const;
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
  const page = await browser.newPage({
    viewport: { width: 640, height: 606 },
    deviceScaleFactor: 1,
  });
  let networkRequests = 0;
  await page.route("**/*", async (route) => {
    networkRequests++;
    await route.abort();
  });
  const cases = [];
  for (const width of [1280, 640, 320, 200, 160, 130]) {
    await page.setViewportSize({ width, height: 606 });
    await page.setContent(
      `<!doctype html><style>${preflight}\n${css}\nbody{margin:0}#source{height:606px}</style><div id=source></div>`,
    );
    const rows = await page.evaluate(
      async ({ bundle, sources }) => {
        const original = await import(`data:text/javascript;base64,${bundle}`);
        original.applyTheme(
          { preset: "editorial" },
          document.documentElement,
          false,
        );
        const host = document.getElementById("source")!;
        const editor = original.mountTypstCodeEditor(host, "", {
          readOnly: true,
          onChange() {},
          onApply() {},
        });
        const view = original.EditorView.findFromDOM(
          host.querySelector(".cm-editor")!,
        );
        if (!view) throw new Error("Original Source editor did not mount");
        const results = [];
        for (const entry of sources) {
          editor.setSource(entry.text + "\n");
          view.scrollDOM.scrollTop = 0;
          view.requestMeasure();
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const line = host.querySelector<HTMLElement>(".cm-line")!;
          const style = getComputedStyle(view.contentDOM);
          const rect = line.getBoundingClientRect();
          const groups = new Map<
            number,
            { text: string; from: number; to: number; x: number; width: number }
          >();
          const boundaries = [];
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node: Node | null,
            sourceBytes = 0;
          while ((node = walker.nextNode())) {
            let utf16 = 0;
            for (const scalar of node.textContent ?? "") {
              const range = document.createRange();
              range.setStart(node, utf16);
              utf16 += scalar.length;
              range.setEnd(node, utf16);
              const bounds = range.getBoundingClientRect();
              const key = Math.round(bounds.top * 64);
              const bytes = new TextEncoder().encode(scalar).length;
              const group = groups.get(key) ?? {
                text: "",
                from: sourceBytes,
                to: sourceBytes,
                x: bounds.left,
                width: 0,
              };
              group.text += scalar;
              group.to = sourceBytes + bytes;
              group.width = Math.max(group.width, bounds.right - group.x);
              groups.set(key, group);
              boundaries.push({
                byte: sourceBytes,
                x: bounds.left,
                y: bounds.top,
              });
              sourceBytes += bytes;
            }
          }
          const plain = document.createElement("div");
          const lineStyle = getComputedStyle(line);
          const scrollerStyle = getComputedStyle(view.scrollDOM);
          plain.style.cssText = `position:absolute;left:0;top:0;width:${rect.width - parseFloat(lineStyle.paddingLeft) - parseFloat(lineStyle.paddingRight)}px;font-family:${scrollerStyle.fontFamily};font-size:${lineStyle.fontSize};line-height:${lineStyle.lineHeight};white-space:${style.whiteSpace};word-break:${style.wordBreak};overflow-wrap:${style.overflowWrap};line-break:${style.lineBreak}`;
          plain.textContent = entry.text;
          document.body.append(plain);
          const plainRows = new Map<number, string>();
          let plainOffset = 0;
          for (const scalar of entry.text) {
            const range = document.createRange();
            range.setStart(plain.firstChild!, plainOffset);
            plainOffset += scalar.length;
            range.setEnd(plain.firstChild!, plainOffset);
            const top = Math.round(range.getBoundingClientRect().top * 64);
            plainRows.set(top, (plainRows.get(top) ?? "") + scalar);
          }
          plain.remove();
          results.push({
            id: entry.id,
            source: entry.text + "\n",
            sourceUnchanged: view.state.doc.toString() === entry.text + "\n",
            undo: original.undoDepth(view.state),
            redo: original.redoDepth(view.state),
            css: {
              whiteSpace: style.whiteSpace,
              wordBreak: style.wordBreak,
              overflowWrap: style.overflowWrap,
              lineBreak: style.lineBreak,
              hyphens: style.hyphens,
            },
            contentWidth:
              rect.width -
              parseFloat(getComputedStyle(line).paddingLeft) -
              parseFloat(getComputedStyle(line).paddingRight),
            left: rect.left + parseFloat(getComputedStyle(line).paddingLeft),
            logicalRowHeight: 21.4375,
            rowTexts: [...groups.values()].map((group) => group.text),
            plainCssRows: [...plainRows.values()],
            rows: [...groups].map(([y, group]) => ({ y: y / 64, ...group })),
            boundaries,
          });
        }
        editor.destroy();
        return results;
      },
      { bundle, sources },
    );
    if (rows.some((row) => !row.sourceUnchanged || row.undo || row.redo))
      throw new Error("Probe changed source/history");
    if (width === 160) {
      for (const id of ["ascii-hyphen", "marker-ordinary", "minus-digit"]) {
        const entry = sources.find((entry) => entry.id === id)!;
        await page.evaluate(
          async ({ bundle, source }) => {
            const original = await import(
              `data:text/javascript;base64,${bundle}`
            );
            const host = document.getElementById("source")!;
            host.replaceChildren();
            original.mountTypstCodeEditor(host, source, {
              readOnly: true,
              onChange() {},
              onApply() {},
            });
            await document.fonts.ready;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
            const view = original.EditorView.findFromDOM(
              host.querySelector(".cm-editor")!,
            );
            if (view?.state.doc.toString() !== source)
              throw new Error("Raster fixture changed source");
          },
          { bundle, source: entry.text + "\n" },
        );
        await page.screenshot({ path: `${output}/web-${id}.png` });
        await page.evaluate(
          async ({ bundle }) => {
            const original = await import(
              `data:text/javascript;base64,${bundle}`
            );
            const host = document.getElementById("source")!;
            const view = original.EditorView.findFromDOM(
              host.querySelector(".cm-editor")!,
            );
            view?.destroy();
            host.replaceChildren();
          },
          { bundle },
        );
      }
    }
    cases.push({ width, results: rows });
  }
  const fontSession = await page.context().newCDPSession(page);
  await fontSession.send("DOM.enable");
  await fontSession.send("CSS.enable");
  // The editor was destroyed; mount a final unchanged ordinary marker for CDP proof.
  await page.evaluate(
    async ({ bundle }) => {
      const original = await import(`data:text/javascript;base64,${bundle}`);
      original.mountTypstCodeEditor(
        document.getElementById("source")!,
        "// twyne-document:1\n",
        { readOnly: true, onChange() {}, onApply() {} },
      );
      await document.fonts.ready;
    },
    { bundle },
  );
  const {
    root: { nodeId },
  } = await fontSession.send("DOM.getDocument", { depth: 0 });
  const { nodeId: lineId } = await fontSession.send("DOM.querySelector", {
    nodeId,
    selector: ".cm-line",
  });
  const fonts = await fontSession.send("CSS.getPlatformFontsForNode", {
    nodeId: lineId,
  });
  await fontSession.detach();
  if (networkRequests) throw new Error("Unexpected network request");
  const report = {
    browser: browser.version(),
    networkRequests,
    compatMode: "CSS1Compat",
    doctype: "html",
    fonts,
    original:
      "Executed unmodified Twyne CodeMirror, CSS and real environment Mono; no injected source font or replacement wrapper",
    sourceFixturesSha256: createHash("sha256")
      .update(JSON.stringify(sources))
      .digest("hex"),
    cases,
  };
  await Bun.write(
    `${output}/web-hyphen-wrap.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      output,
      browser: browser.version(),
      networkRequests,
      cases: cases.length,
      sourceCases: sources.length,
      fonts,
    }),
  );
} finally {
  await browser.close();
}
