/** Read-only publication smoke: real GIFs, selector coverage, and motion consent. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? "http://127.0.0.1:3138").replace(/\/$/, "");
const response = await fetch(`${base}/assets/persona-motion/manifest.json`);
assert.equal(response.status, 200, "Collection manifest is served");
const { assets, categories } = await response.json();
assert.equal(assets.length, 35);
assert.equal(new Set(assets.map((asset) => asset.key)).size, 35);
assert.equal(categories.length, 7);
for (const asset of assets) {
  const head = await fetch(`${base}${asset.src}`, { method: "HEAD" });
  assert.equal(head.status, 200, asset.src);
  assert.match(head.headers.get("content-type") ?? "", /image\/gif/, asset.src);
  const length = head.headers.get("content-length");
  if (length !== null) assert.equal(Number(length), asset.bytes, asset.src);
}
for (const [category] of categories) {
  const asset = assets.find((item) => item.category === category);
  const bytes = Buffer.from(
    await (await fetch(`${base}${asset.src}`)).arrayBuffer(),
  );
  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const requestedGifs = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith(".gif")) requestedGifs.push(request.url());
  });
  const document = await page.goto(`${base}/motion.html`);
  assert.equal(document.status(), 200);
  assert.match(document.headers()["content-type"], /text\/html/);
  await page.locator("#portrait").evaluate((image) => image.decode());
  assert.equal(
    requestedGifs.length,
    1,
    "Only the selected GIF loads initially",
  );
  for (const asset of assets) {
    await page.selectOption("#persona", asset.personaId);
    await page.selectOption("#category", asset.category);
    await page.waitForFunction((src) => {
      const image = document.querySelector("#portrait");
      return (
        image.src.endsWith(src) && image.complete && image.naturalWidth > 0
      );
    }, asset.src);
    assert.equal(
      await page.locator("#download").getAttribute("href"),
      asset.src,
    );
  }
  await page.locator("#pause").click();
  assert.equal(
    await page.locator("#pause").getAttribute("aria-pressed"),
    "true",
  );
  assert.match(
    await page.locator("#portrait").getAttribute("src"),
    /-still\.png$/,
  );
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No overflow at ${width}px`,
    );
  }
  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  const reducedGifs = [];
  reducedPage.on("request", (request) => {
    if (request.url().endsWith(".gif")) reducedGifs.push(request.url());
  });
  await reducedPage.goto(`${base}/motion.html`);
  await reducedPage.locator("#portrait").evaluate((image) => image.decode());
  assert.equal(
    reducedGifs.length,
    0,
    "Reduced motion does not fetch an animated GIF",
  );
  assert.equal(
    await reducedPage.locator("#pause").textContent(),
    "Play animation",
  );
  await reducedPage.locator("#pause").click();
  await reducedPage.locator("#portrait").evaluate((image) => image.decode());
  assert.equal(
    reducedGifs.length,
    1,
    "A deliberate play action starts animation",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      base,
      assets: 35,
      selectorCombinations: 35,
      lazyLoading: true,
      pause: true,
      reducedMotion: true,
      responsive: [375, 1280],
      pageErrors: errors.length,
    }),
  );
} finally {
  await browser.close();
}
