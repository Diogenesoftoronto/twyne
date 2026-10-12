/** Original declared CSS/arithmetic; fresh owned Chrome, no external requests. */
import { chromium } from "@playwright/test";
import { computePageGeometry, paginate, sameBreaks, type BlockMetric } from "../../../../src/components/editor/pagination-geometry";
import { DEFAULT_LAYOUT } from "../../../../src/types";

const css = (await Bun.file("src/global.css").text())
  .replace(/@import\s+[^;]+;/g, "")
  .replace(/@theme\s*\{([\s\S]*?)\n\}/, ":root{$1}");
const preflight = await Bun.file("node_modules/tailwindcss/preflight.css").text();
const fontPath = "src/assets/typst/lora-Lora-wght.ttf";
const lora = await Bun.file(fontPath).bytes();
const cases = [
  { name: "adjacent paragraphs retain remaining float", contentH: 1024, text: "The following paragraph carries on.", manual: false },
  { name: "manual spacer clears the opening float", contentH: 1024, text: "The following paragraph carries on.", manual: true },
  { name: "automatic spacer stable after clear", contentH: 100, text: "The following paragraph carries ordinary words into the next room.", manual: false },
  { name: "automatic spacer/float feedback", contentH: 90, text: "The following paragraph carries on.", manual: false },
];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  let attemptedNetworkRequests = 0;
  await page.route("**/*", async (route) => { attemptedNetworkRequests++; await route.abort(); });
  await page.goto("about:blank");
  const observations = [];
  for (const input of cases) {
    const layout = {
      ...DEFAULT_LAYOUT, pagination: "paginated" as const,
      marginLeft: 15.5, marginRight: 15.5,
      marginTop: (1056 - input.contentH) / 32,
      marginBottom: (1056 - input.contentH) / 32,
    };
    const geometry = computePageGeometry(layout);
    await page.setContent(`<html lang=en><body><div class="twyne-editor page-canvas is-paginated"
      style="width:816px;padding:0 248px;--page-content-h:${input.contentH}px">
      <div class=ProseMirror data-opening-initial-mode=illuminated data-opening-initial-size=medium>
        <p class=twyne-illuminated-paragraph><span class="twyne-illuminated-initial is-illuminated">T</span>he</p>
        ${input.manual ? '<div class=twyne-page-break data-type=page-break></div>' : ""}
        <p>${input.text}</p>
      </div></div></body></html>`);
    await page.addStyleTag({ content: `${preflight}\n@font-face{font-family:Lora;src:url(data:font/ttf;base64,${Buffer.from(lora).toString("base64")});font-weight:400 700}\n${css}\nbody{margin:0}` });
    await page.evaluate(async () => { await document.fonts.ready; });
    let previous: ReturnType<typeof paginate>["breaks"] = [];
    const passes = [];
    for (let pass = 0; pass < 6; pass++) {
      const measured = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>(".ProseMirror")!;
        const blocks = Array.from(root.children).filter((node) => !(node as HTMLElement).dataset.fixtureSpacer);
        const metrics = blocks.map((element, index) => {
          const el = element as HTMLElement;
          const style = getComputedStyle(el);
          return { pos: index, height: el.offsetHeight, marginTop: Number.parseFloat(style.marginTop), marginBottom: Number.parseFloat(style.marginBottom), forcedBreak: el.dataset.type === "page-break" };
        });
        const paragraph = blocks[blocks.length - 1];
        const range = document.createRange();
        range.setStart(paragraph.firstChild!, 0);
        range.setEnd(paragraph.firstChild!, 1);
        const glyph = range.getBoundingClientRect();
        const bound = paragraph.getBoundingClientRect();
        const artwork = root.querySelector(".twyne-illuminated-initial")!.getBoundingClientRect();
        return { metrics, firstGlyphX: glyph.left - bound.left, firstGlyphY: glyph.top - bound.top, paragraphTop: bound.top, artworkTop: artwork.top, artworkBottom: artwork.bottom };
      });
      const result = paginate(measured.metrics as BlockMetric[], geometry);
      const stable = sameBreaks(previous, result.breaks);
      passes.push({ pass, ...measured, result, stable });
      if (stable) break;
      previous = result.breaks;
      await page.evaluate((breaks) => {
        const root = document.querySelector<HTMLElement>(".ProseMirror")!;
        root.querySelectorAll("[data-fixture-spacer]").forEach((node) => node.remove());
        const blocks = Array.from(root.children);
        for (const pageBreak of breaks) {
          const spacer = document.createElement("div");
          spacer.dataset.fixtureSpacer = "true";
          spacer.className = "twyne-page-spacer";
          spacer.style.height = `${pageBreak.height}px`;
          root.insertBefore(spacer, blocks[pageBreak.blockIndex]);
        }
      }, result.breaks);
    }
    observations.push({ input, geometry, passes });
  }
  if (attemptedNetworkRequests) throw new Error("Float probe attempted network access");
  const [adjacent, manual, automatic, feedback] = observations;
  if (!adjacent.passes[0].stable || adjacent.passes[0].firstGlyphX <= 0) {
    throw new Error("Original adjacent paragraph lost its live initial float");
  }
  for (const row of [manual, automatic]) {
    if (row.passes.length !== 2 || !row.passes[1].stable
      || row.passes[0].firstGlyphX <= 0 || row.passes[1].firstGlyphX !== 0
      || row.passes[1].result.breaks.length !== 1) {
      throw new Error(`Original float did not clear at the stable spacer: ${row.input.name}`);
    }
  }
  if (feedback.passes.length !== 6 || feedback.passes.some((pass) => pass.stable)
    || feedback.passes.some((pass, index) => pass.result.breaks.length !== (index % 2 === 0 ? 1 : 0))
    || feedback.passes.some((pass, index) => index % 2 === 0 ? pass.firstGlyphX <= 0 : pass.firstGlyphX !== 0)) {
    throw new Error("The demonstrated original float/page feedback no longer alternates");
  }
  await Bun.write(new URL("./source-float-observations.json", import.meta.url), JSON.stringify({
    boundary: "Isolated original global.css, original Lora 3.008 variable, and original paginate over actual DOM offsetHeight. Classes/spacers manually activate the declared engine path, not current full-route registration or plugin scheduling proof.",
    font: { path: fontPath, sha256: new Bun.CryptoHasher("sha256").update(lora).digest("hex") },
    browser: browser.version(), attemptedNetworkRequests, observations,
  }, null, 2) + "\n");
  console.log(JSON.stringify(observations.map((row) => ({ case: row.input.name, passes: row.passes.map((pass) => ({ height: pass.metrics.at(-1)!.height, x: pass.firstGlyphX, breaks: pass.result.breaks.length, stable: pass.stable })) }))));
} finally { await browser.close(); }
