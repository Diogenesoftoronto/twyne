// Measure the actual original CodeMirror Source view. No shipping browser dependency.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const output = process.env.TWYNE_SOURCE_WEB_OUTPUT ?? directory;
const mode = process.env.TWYNE_SOURCE_WEB_MODE ?? "standards";
const fontMode = process.env.TWYNE_SOURCE_WEB_FONT ?? "static";
const withPreflight = process.env.TWYNE_SOURCE_WEB_PREFLIGHT !== "false";
if (!new Set(["quirks", "standards"]).has(mode))
  throw new Error("TWYNE_SOURCE_WEB_MODE must be quirks or standards");
if (!new Set(["static", "original-response"]).has(fontMode))
  throw new Error("TWYNE_SOURCE_WEB_FONT must be static or original-response");
await mkdir(output, { recursive: true });
const css = await Bun.file(`${root}/src/global.css`).text();
const preflight = withPreflight
  ? await Bun.file(`${root}/node_modules/tailwindcss/preflight.css`).text()
  : "";
const stylesheet =
  preflight +
  "\n" +
  css
    .replace('@import "tailwindcss";', "")
    .replace(/^@source[^;]+;/m, "")
    .replace("@theme {", ":root {");
let fontPath = `${root}/src/assets/typst/dmsans-DMSans-Regular.ttf`;
if (fontMode === "original-response") {
  const responses =
    process.env.TWYNE_ORIGINAL_FONT_RESPONSES ??
    "/tmp/twyne-original-web-fonts";
  const files = (await Bun.file(`${responses}/assets.json`).json()) as {
    path: string;
    url: string;
  }[];
  const dm = files.find(
    (file) =>
      file.url.includes("/dmsans/") &&
      file.url.endsWith("rP2Hp2ywxg089UriCZOIHQ.woff2"),
  );
  if (!dm) throw new Error("Actual original DM Sans response was not captured");
  fontPath = dm.path;
}
const fontBytes = await Bun.file(fontPath).bytes();
const font = Buffer.from(fontBytes).toString("base64");
const fontFace = `@font-face{font-family:'DM Sans';src:url(data:font/${fontMode === "static" ? "ttf" : "woff2"};base64,${font});font-weight:${fontMode === "static" ? "400" : "400 700"};font-style:normal}`;
const build = await Bun.build({
  entrypoints: [`${directory}/capture-client.ts`],
  target: "browser",
  format: "esm",
});
if (!build.success) throw new Error(String(build.logs));
const bundle = Buffer.from(await build.outputs[0].text()).toString("base64");
const html =
  "<h1>The notebook</h1><p>The notebook was small enough to carry in a coat pocket. By November, its corners had softened and the cover had begun to remember the shape of a hand.</p><p>Most pages held ordinary things: the name of a book, a sentence overheard on the train, the hours of a shop she kept arriving at after it had closed.</p><h2>A note for the next draft</h2><p>Keep the opening concrete. Let the change in the room carry the ending.</p>";
const cases = [
  { id: "editorial", width: 1280 },
  { id: "split", width: 640 },
  { id: "narrow", width: 320 },
  { id: "very-narrow", width: 160 },
  { id: "nowrap", width: 640, wrap: false },
  { id: "readonly", width: 640, readonly: true },
  { id: "scrolled", width: 640, scroll: 64, extraLines: 80 },
  { id: "one-digit", width: 640, lines: 6 },
  { id: "two-digit", width: 640, lines: 40 },
  { id: "four-digit", width: 640, lines: 1000 },
  { id: "foolscap", width: 640, preset: "foolscap" },
  { id: "broadsheet", width: 640, preset: "broadsheet" },
  { id: "nightpress", width: 640, preset: "nightpress" },
] as const;
const requestedCases = process.env.TWYNE_SOURCE_WEB_CASES?.split(",");
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 606 },
    deviceScaleFactor: 1,
  });
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  const reference = [];
  for (const entry of cases) {
    if (requestedCases && !requestedCases.includes(entry.id)) continue;
    await page.setViewportSize({ width: entry.width, height: 606 });
    await page.setContent(
      `${mode === "standards" ? "<!doctype html>" : ""}<style>${stylesheet}\n${fontFace}body{margin:0;background:var(--color-editor-bg)}#source{height:606px}</style><div id="source"></div>`,
    );
    const result = await page.evaluate(
      async ({ bundle, entry, html }) => {
        const original = await import(`data:text/javascript;base64,${bundle}`);
        original.applyTheme(
          { preset: entry.preset ?? "editorial" },
          document.documentElement,
          false,
        );
        await document.fonts.load("11px 'DM Sans'");
        let source = entry.lines
          ? Array.from(
              { length: entry.lines },
              (_, row) => `line ${row + 1}`,
            ).join("\n")
          : original.htmlToTypst(html);
        if (entry.extraLines)
          source +=
            "\n" +
            Array.from(
              { length: entry.extraLines },
              (_, row) => `#text("A visible source line ${row + 1}.")`,
            ).join("\n");
        const host = document.getElementById("source")!;
        const editor = original.mountTypstCodeEditor(host, "", {
          readOnly: entry.readonly ?? false,
          onChange() {},
          onApply() {},
        });
        editor.setSource(source);
        editor.setWrapping(entry.wrap ?? true);
        const view = original.EditorView.findFromDOM(
          host.querySelector(".cm-editor")!,
        );
        if (!view) throw new Error("Original editor did not mount");
        view.scrollDOM.scrollTop = entry.scroll ?? 0;
        view.requestMeasure();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const probe = (selector: string) => {
          const node = host.querySelector<HTMLElement>(selector);
          if (!node) return null;
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return {
            text: node.textContent,
            bounds: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
            fragments: Array.from(node.getClientRects(), (bounds) => ({
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            })),
            font: style.font,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            color: style.color,
            background: style.backgroundColor,
            padding: style.padding,
            margin: style.margin,
            border: style.border,
            borderRight: style.borderRight,
            borderRadius: style.borderRadius,
            ariaLabel: node.getAttribute("aria-label"),
            title: node.title,
          };
        };
        const first = host.querySelector(".cm-line");
        const text = first?.firstChild;
        let firstText = null;
        if (text) {
          const range = document.createRange();
          range.selectNodeContents(text);
          const bounds = range.getBoundingClientRect();
          firstText = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          };
        }
        const before = {
          source: view.state.doc.toString(),
          undo: original.undoDepth(view.state),
          redo: original.redoDepth(view.state),
        };
        const visibleRows = Array.from(
          host.querySelectorAll<HTMLElement>(".cm-line"),
          (line) => {
            const rows = new Map<number, string>();
            const walker = document.createTreeWalker(
              line,
              NodeFilter.SHOW_TEXT,
            );
            let node: Node | null;
            while ((node = walker.nextNode())) {
              if (node.parentElement?.closest(".cm-foldPlaceholder")) continue;
              let offset = 0;
              for (const scalar of node.textContent ?? "") {
                const range = document.createRange();
                range.setStart(node, offset);
                offset += scalar.length;
                range.setEnd(node, offset);
                const top = Math.round(range.getBoundingClientRect().top * 64);
                rows.set(top, (rows.get(top) ?? "") + scalar);
              }
            }
            return {
              sourceLine: view.state.doc.lineAt(view.posAtDOM(line, 0)).number,
              rowTexts: [...rows.values()],
            };
          },
        );
        const geometry = {
          compatMode: document.compatMode,
          doctype: document.doctype?.name ?? null,
          source,
          lines: view.state.doc.lines,
          editor: probe(".cm-editor"),
          scroller: probe(".cm-scroller"),
          content: probe(".cm-content"),
          gutter: probe(".cm-gutters"),
          numberGutter: probe(".cm-lineNumbers"),
          number: probe(".cm-lineNumbers .cm-gutterElement:last-child"),
          foldGutter: probe(".cm-foldGutter"),
          fold: probe(".cm-foldGutter span"),
          line: probe(".cm-line"),
          firstText,
          visibleRows,
          activeLine: probe(".cm-activeLine"),
          placeholder: probe(".cm-foldPlaceholder"),
          placeholderWords: Array.from(
            host.querySelector(".cm-foldPlaceholder")?.childNodes ?? [],
          ).flatMap((node) => {
            if (node.nodeType !== Node.TEXT_NODE) return [];
            const text = node.textContent ?? "";
            return Array.from(text.matchAll(/\S+|\s+/g), (match) => {
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              return {
                text: match[0],
                fragments: Array.from(range.getClientRects(), (bounds) => ({
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                })),
              };
            });
          }),
          cursor: probe(".cm-cursor"),
          scroll: { x: view.scrollDOM.scrollLeft, y: view.scrollDOM.scrollTop },
          selection: {
            anchor: view.state.selection.main.anchor,
            head: view.state.selection.main.head,
          },
        };
        const placeholder = host.querySelector<HTMLElement>(
          ".cm-foldPlaceholder",
        );
        let unfold = null;
        if (placeholder && !entry.scroll) {
          placeholder.click();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          unfold = {
            sourceUnchanged: before.source === view.state.doc.toString(),
            undoUnchanged: before.undo === original.undoDepth(view.state),
            redoUnchanged: before.redo === original.redoDepth(view.state),
            placeholderRemoved: !host.querySelector(".cm-foldPlaceholder"),
          };
          if (!Object.values(unfold).every(Boolean))
            throw new Error("Original fold click modified document/history");
          // Restore the original folded geometry for the screenshot without an edit.
          editor.destroy();
          const restored = original.mountTypstCodeEditor(host, "", {
            readOnly: entry.readonly ?? false,
            onChange() {},
            onApply() {},
          });
          restored.setSource(source);
          restored.setWrapping(entry.wrap ?? true);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        return { ...geometry, unfold };
      },
      { bundle, entry, html },
    );
    await page.screenshot({ path: `${output}/web-${entry.id}.png` });
    reference.push({ ...entry, result });
  }
  const canonical = reference[0].result.source;
  await Bun.write(`${output}/web-notebook.typ`, canonical);
  await Bun.write(
    `${output}/web-reference.json`,
    JSON.stringify(
      {
        source:
          "current original typst-code-editor.ts, document.ts, theme.ts, global.css and installed CodeMirror",
        cssSha256: createHash("sha256").update(css).digest("hex"),
        preflightSha256: withPreflight
          ? createHash("sha256").update(preflight).digest("hex")
          : null,
        mode,
        fontMode,
        fontPath,
        fontSha256: createHash("sha256").update(fontBytes).digest("hex"),
        browser: browser.version(),
        sourceSha256: createHash("sha256").update(canonical).digest("hex"),
        blockedNetworkRequests,
        deviceScaleFactor: 1,
        cases: reference,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Measured ${reference.length} original Source cases; ${blockedNetworkRequests} network requests.`,
  );
} catch (error) {
  console.error(String(error).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
