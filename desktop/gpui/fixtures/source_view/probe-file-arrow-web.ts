// Original-response, zero-network font probe. The real app's read-only CDP
// proof is file-arrow-actual-app.json; this isolates fallback synthesis pixels.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const output =
  process.env.TWYNE_FILE_ARROW_WEB_OUTPUT ?? "/tmp/twyne-file-arrow-web";
const responses =
  process.env.TWYNE_ORIGINAL_FONT_RESPONSES ?? "/tmp/twyne-original-web-fonts";
const entries = await Bun.file(`${responses}/assets.json`).json();
const dm = entries.find(
  (f: { url: string }) =>
    f.url.includes("/dmsans/") &&
    f.url.endsWith("rP2Hp2ywxg089UriCZOIHQ.woff2"),
);
if (!dm) throw new Error("Original DM response is required");
const bytes = await Bun.file(dm.path).bytes();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 640, height: 480 },
    deviceScaleFactor: 1,
  });
  let requests = 0;
  await page.route("**/*", async (route) => {
    requests++;
    await route.abort();
  });
  await page.goto("about:blank");
  const cases = [
    {
      id: "original-fallback600",
      family: '"DM Sans", Inter, system-ui, sans-serif',
      weight: 600,
    },
    {
      id: "original-fallback600-no-synthesis",
      family: '"DM Sans", Inter, system-ui, sans-serif',
      weight: 600,
      synthesis: "none",
    },
    { id: "math400", family: '"Noto Sans Math"', weight: 400 },
    { id: "math500", family: '"Noto Sans Math"', weight: 500 },
    { id: "math600", family: '"Noto Sans Math"', weight: 600 },
    { id: "math700", family: '"Noto Sans Math"', weight: 700 },
    {
      id: "math600-no-synthesis",
      family: '"Noto Sans Math"',
      weight: 600,
      synthesis: "none",
    },
  ];
  await page.setContent(`<!doctype html><html><head><style>
  @font-face{font-family:'DM Sans';src:url(data:font/woff2;base64,${Buffer.from(bytes).toString("base64")});font-weight:400 700;font-style:normal}
  html,body{margin:0;background:white} .sample{position:relative;width:40px;height:32px;color:black}
  .sample span{position:absolute;left:8px;top:8px;font-size:12px;line-height:16px;font-style:normal;font-optical-sizing:auto}
  </style></head><body>${cases.map((c) => `<div class=sample id=${c.id}><span style='font-family:${c.family};font-weight:${c.weight};font-synthesis:${c.synthesis ?? "weight style small-caps"}'>▾</span></div>`).join("")}</body></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const doc = await cdp.send("DOM.getDocument", { depth: 0 });
  const rows = [];
  for (const item of cases) {
    const node = await cdp.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: `#${item.id} span`,
    });
    rows.push({
      ...item,
      fonts: await cdp.send("CSS.getPlatformFontsForNode", {
        nodeId: node.nodeId,
      }),
      geometry: await page
        .locator(`#${item.id} span`)
        .evaluate((n) => ({
          bounds: n.getBoundingClientRect().toJSON(),
          synthesis: getComputedStyle(n).fontSynthesis,
        })),
    });
    await page
      .locator(`#${item.id}`)
      .screenshot({ path: `${output}/${item.id}.png` });
  }
  await Bun.write(
    `${output}/web-proof.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        compatMode: await page.evaluate(() => document.compatMode),
        requests,
        originalResponse: dm.url,
        originalResponseSha256: createHash("sha256")
          .update(bytes)
          .digest("hex"),
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ output, requests, rows }, null, 2));
} finally {
  await browser.close();
}
