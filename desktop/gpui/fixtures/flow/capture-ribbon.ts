// Verification-only final-state geometry, from original markup and current CSS.
import { chromium } from "@playwright/test";

const source = await Bun.file(
  new URL(
    "../../../../src/components/in-flow/flow-ribbon.tsx",
    import.meta.url,
  ),
).text();
const markup = source.match(/<svg[\s\S]*?<\/svg>/)?.[0];
if (!markup) throw new Error("Original ribbon SVG was not found.");
function dictionary(name: string): Record<string, string> {
  const body = source.match(
    new RegExp(`const ${name}:[\\s\\S]*?= \\{([\\s\\S]*?)\\};`),
  )?.[1];
  if (!body) throw new Error(`Original ${name} was not found.`);
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\s*"([^"]+)"/g)].map((entry) => [
      entry[1],
      entry[2],
    ]),
  );
}
const labels = dictionary("LABELS");
const titles = dictionary("TITLES");
let global = await Bun.file(
  new URL("../../../../src/global.css", import.meta.url),
).text();
// @theme's declarations become :root in Tailwind. Unrelated utility directives
// have no role in this static fixture; all actual ribbon rules stay unchanged.
global = global
  .replace('@import "tailwindcss";', "")
  .replace(/^@source[^;]+;/m, "")
  .replace("@theme {", ":root {");
const workspace = await Bun.file(
  new URL(
    "../../../../src/components/editor/typst-workspace.css",
    import.meta.url,
  ),
).text();
const font = async (filename: string) =>
  Buffer.from(
    await Bun.file(
      new URL(`../../../../src/assets/typst/${filename}`, import.meta.url),
    ).bytes(),
  ).toString("base64");
const fonts = `@font-face{font-family:'DM Sans';src:url(data:font/ttf;base64,${await font("dmsans-DMSans-Regular.ttf")})} @font-face{font-family:'Special Elite';src:url(data:font/ttf;base64,${await font("specialelite-SpecialElite-Regular.ttf")})}`;
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 4 });
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  const cases = [];
  for (const host of ["writingWorkspace", "manuscript"]) {
    for (const width of [1_280, 641, 640, 639]) {
      await page.setViewportSize({ width, height: 300 });
      for (const mode of Object.keys(labels)) {
        const label = mode === "flow" ? `${labels.flow} · 2 min` : labels[mode];
        const ribbon = `<span class="flow-ribbon" data-mode="${mode}" role="status" aria-live="off" aria-label="${label}. ${titles[mode]}" title="${titles[mode]}">${markup}<span class="flow-ribbon__label">${label}</span></span>`;
        const container =
          host === "writingWorkspace"
            ? `<div class="typst-workspace"><footer class="typst-statusbar editor-bottom-bar">${ribbon}</footer></div>`
            : `<footer class="manuscript-status">${ribbon}</footer>`;
        await page.setContent(
          `<style>${global}\n${workspace}\n${fonts}\nhtml{line-height:1.5}body{margin:0;background:#f4ecd8}</style>${container}`,
        );
        await page.evaluate(() => document.fonts.ready);
        const transitions = await page
          .locator(".flow-ribbon")
          .evaluate((element) => {
            const band = getComputedStyle(
              element.querySelector(".flow-ribbon__band")!,
            );
            const slack = getComputedStyle(
              element.querySelector(".flow-ribbon__slack")!,
            );
            return {
              band: band.transitionDuration,
              easing: band.transitionTimingFunction,
              slack: slack.transitionDuration,
            };
          });
        // Capture settled geometry rather than timing an arbitrary intermediate frame.
        await page.addStyleTag({
          content:
            ".flow-ribbon__band,.flow-ribbon__slack{transition:none!important}",
        });
        const result = await page
          .locator(".flow-ribbon")
          .evaluate((element) => {
            const style = getComputedStyle(element);
            const label = element.querySelector(".flow-ribbon__label")!;
            const labelStyle = getComputedStyle(label);
            const band = getComputedStyle(
              element.querySelector(".flow-ribbon__band")!,
            );
            const slack = getComputedStyle(
              element.querySelector(".flow-ribbon__slack")!,
            );
            const spool = element.querySelector("svg")!;
            const bounds = (target: Element) => {
              const rect = target.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            };
            return {
              label: label.textContent,
              ariaLabel: element.getAttribute("aria-label"),
              title: element.getAttribute("title"),
              role: element.getAttribute("role"),
              ariaLive: element.getAttribute("aria-live"),
              visible: style.display !== "none",
              labelVisible: labelStyle.position !== "absolute",
              color: style.color,
              opacity: Number(style.opacity),
              gap: style.gap,
              font: style.fontFamily,
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              tracking: style.letterSpacing,
              textTransform: style.textTransform,
              bandTransform: band.transform,
              bandOpacity: Number(band.opacity),
              slackOpacity: Number(slack.opacity),
              bounds: bounds(element),
              labelBounds: bounds(label),
              spoolBounds: bounds(spool),
              black: getComputedStyle(
                element.querySelector(".flow-ribbon__black")!,
              ).fill,
              red: getComputedStyle(element.querySelector(".flow-ribbon__red")!)
                .fill,
            };
          });
        cases.push({ host, width, mode, result, transitions });
        if (host === "writingWorkspace" && width === 1_280) {
          await page.locator(".flow-ribbon__spool").screenshot({
            path: new URL(`web-spool-${mode}.png`, import.meta.url).pathname,
          });
        }
      }
    }
  }
  await Bun.write(
    new URL("ribbon-reference.json", import.meta.url),
    JSON.stringify(
      {
        provenance:
          "Original FlowRibbon SVG/dictionaries extracted directly from current component; actual global.css and typst-workspace.css rules, original bundled font bytes, settled browser-computed geometry in local Chrome. This checks markup/style states, not Qwik event lifecycle or hosted Google Fonts byte identity.",
        blockedNetworkRequests,
        deviceScaleFactor: 4,
        cases,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ cases: cases.length, blockedNetworkRequests }));
} finally {
  await browser.close();
}
