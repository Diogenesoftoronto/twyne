// Fresh zero-network Chrome fixture using the original application's captured
// Google font response bytes and CSS. No user browser surfaces are accessed.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const responses =
  process.env.TWYNE_ORIGINAL_FONT_RESPONSES ?? "/tmp/twyne-original-web-fonts";
const output =
  process.env.TWYNE_BUTTON_FONT_OUTPUT ?? "/tmp/twyne-button-fonts-web";
const files = (await Bun.file(`${responses}/assets.json`).json()) as {
  path: string;
  url: string;
}[];
const dm = files.find(
  (file) =>
    file.url.includes("/dmsans/") &&
    file.url.endsWith("rP2Hp2ywxg089UriCZOIHQ.woff2"),
);
const special = files.find((file) => file.url.includes("/specialelite/"));
if (!dm || !special)
  throw new Error(
    "Capture the actual original browser's DM Sans and Special Elite responses first",
  );
const data = async (path: string) =>
  `data:font/woff2;base64,${Buffer.from(await Bun.file(path).bytes()).toString("base64")}`;
const source = await Bun.file(`${root}/src/global.css`).text();
const css = source
  .replace(/@import\s+[^;]+;/g, "")
  .replace(/@theme\s*\{([\s\S]*?)\n\}/, ":root{$1}");
const preflight = await Bun.file(
  `${root}/node_modules/tailwindcss/preflight.css`,
).text();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
  let networkRequests = 0;
  await page.route("**/*", async (route) => {
    networkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent("<html><body><div id=fixture></div></body></html>");
  await page.addStyleTag({
    content: `${preflight}\n${css}\n@font-face{font-family:'DM Sans';src:url('${await data(dm.path)}');font-weight:400 700;font-style:normal}@font-face{font-family:'Special Elite';src:url('${await data(special.path)}');font-weight:400;font-style:normal}body{padding:20px;background:var(--color-paper)}.sample{display:block;margin:12px}.sample span{display:inline-block}`,
  });
  const cases = [
    { id: "dm400auto", weight: 400, optical: "auto" },
    { id: "dm600auto", weight: 600, optical: "auto" },
    { id: "dm700auto", weight: 700, optical: "auto" },
    { id: "dm600none", weight: 600, optical: "none" },
    { id: "dm600opsz9", weight: 600, optical: "none", variation: '"opsz" 9' },
    { id: "dm600opsz12", weight: 600, optical: "none", variation: '"opsz" 12' },
  ];
  await page.locator("#fixture").evaluate((node, cases) => {
    for (const item of cases) {
      const row = document.createElement("div");
      row.className = "sample";
      const span = document.createElement("span");
      span.id = item.id;
      span.textContent = "Save note";
      Object.assign(span.style, {
        fontFamily: '"DM Sans"',
        fontSize: "12px",
        fontWeight: String(item.weight),
        fontOpticalSizing: item.optical,
        fontVariationSettings: item.variation ?? "normal",
      });
      row.append(span);
      node.append(row);
    }
    const row = document.createElement("div");
    row.className = "sample";
    const span = document.createElement("span");
    span.id = "special";
    span.textContent = "PLACE NOTE";
    Object.assign(span.style, {
      fontFamily: '"Special Elite"',
      fontSize: "11.2px",
      fontWeight: "400",
      letterSpacing: "2.016px",
    });
    row.append(span);
    node.append(row);
  }, cases);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const metrics = await page.locator(".sample span").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        id: node.id,
        source: node.textContent,
        widthPx: node.getBoundingClientRect().width,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontOpticalSizing: style.fontOpticalSizing,
        fontVariationSettings: style.fontVariationSettings,
        letterSpacing: style.letterSpacing,
      };
    }),
  );
  if (networkRequests)
    throw new Error("Original button font fixture tried network requests");
  await Bun.write(
    `${output}/web-metrics.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        networkRequests,
        source:
          "Actual original Google DM Sans4.004 and Special Elite1.001 response bytes; original global.css",
        responses: [dm, special],
        metrics,
      },
      null,
      2,
    ) + "\n",
  );
  await page.screenshot({ path: `${output}/web.png` });
  console.log(
    JSON.stringify({
      output,
      browser: browser.version(),
      networkRequests,
      metrics,
    }),
  );
} finally {
  await browser.close();
}
