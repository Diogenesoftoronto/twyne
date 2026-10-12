/** Fresh owned browser, zero network; original declared pagination CSS path. */
import { chromium } from "@playwright/test";
import {
  computePageGeometry,
  paginate,
} from "../../../../src/components/editor/pagination-geometry";
import { DEFAULT_LAYOUT } from "../../../../src/types";

const layout = { ...DEFAULT_LAYOUT, pagination: "paginated" as const };
const geometry = computePageGeometry(layout);
const source = await Bun.file("src/global.css").text();
const css = source
  .replace(/@import\s+[^;]+;/g, "")
  .replace(/@theme\s*\{([\s\S]*?)\n\}/, ":root{$1}");
const preflight = await Bun.file("node_modules/tailwindcss/preflight.css").text();
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  let attemptedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    attemptedNetworkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent(`<html lang=en><body>
    <div id=canvas class="twyne-editor page-canvas is-paginated"
      style="width:${geometry.pageW}px;min-height:${geometry.pageH}px;padding:${geometry.marginTop}px ${geometry.marginRight}px ${geometry.marginBottom}px ${geometry.marginLeft}px;--page-content-h:${geometry.contentH}px">
      <div id=mount style="position:relative"><div class=ProseMirror><p>Short prose.</p></div></div>
      <div class=manuscript-notes style="margin-top:40px;padding-top:24px;border-top:1px solid;">
        <div id=note-content style="height:60px">One retained note.</div>
      </div>
    </div></body></html>`);
  await page.addStyleTag({ content: `${preflight}\n${css}\nbody{margin:0}` });
  const observed = await page.evaluate(() => {
    const box = (element: Element) => {
      const b = element.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
    const paragraph = editor.querySelector<HTMLElement>("p")!;
    const tail = document.querySelector<HTMLElement>(".manuscript-notes")!;
    const computed = getComputedStyle(paragraph);
    return {
      editor: box(editor), editorMinHeight: getComputedStyle(editor).minHeight,
      paragraph: box(paragraph), paragraphOffsetHeight: paragraph.offsetHeight,
      marginTop: Number.parseFloat(computed.marginTop), marginBottom: Number.parseFloat(computed.marginBottom),
      tail: box(tail), tailOffsetHeight: tail.offsetHeight,
      tailMarginTop: getComputedStyle(tail).marginTop,
      canvas: box(document.getElementById("canvas")!),
    };
  });
  const result = paginate([{
    pos: 0,
    height: observed.paragraphOffsetHeight,
    marginTop: observed.marginTop,
    marginBottom: observed.marginBottom,
  }], geometry, { tailHeight: observed.tailOffsetHeight });
  if (observed.editorMinHeight !== `${geometry.contentH}px` || result.pageCount !== 1 || observed.canvas.height <= geometry.pageH) {
    throw new Error("Original declared CSS/tail extent observation changed");
  }
  if (attemptedNetworkRequests) throw new Error("Local tail probe attempted network access");
  await Bun.write(new URL("./source-tail-observation.json", import.meta.url), JSON.stringify({
    boundary: "Isolated original global.css + source paginate over actual DOM offsetHeight. This manually activates the declared page class; current full editor has no registered Pagination extension. Not a full-route browser pagination proof.",
    browser: browser.version(), attemptedNetworkRequests, geometry, observed, result,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ pageCount: result.pageCount, sheetHeight: geometry.pageH, canvasHeight: observed.canvas.height, editorMinHeight: observed.editorMinHeight, tailOffsetHeight: observed.tailOffsetHeight, attemptedNetworkRequests }));
} finally {
  await browser.close();
}
