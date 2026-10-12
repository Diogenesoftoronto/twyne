// Verification only. Uses local Chrome and blocks every network request.
import { chromium } from "@playwright/test";

const build = await Bun.build({
  entrypoints: [new URL("web-entry.ts", import.meta.url).pathname],
  target: "browser",
  minify: true,
});
if (!build.success) throw new Error(build.logs.map(String).join("\n"));
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: await build.outputs[0].text() });
  const fixtures = [
    ["plate.png", "Plate & détail.png", "image/png"],
    ["plate.jpg", "Photograph.jpg", "image/jpeg"],
    ["rotated.jpg", "Rotated.jpg", "image/jpeg"],
    ["plate.gif", ".hidden", "image/gif"],
    ["plate.webp", "A plate.", "image/webp"],
    ["animated.gif", "Motion.gif", "image/gif"],
    ["animated.webp", "Motion.webp", "image/webp"],
    ["animated.png", "Motion.png", "image/png"],
  ] as const;
  const cases = [];
  for (const [fixture, filename, mime] of fixtures) {
    const bytes = await Bun.file(new URL(fixture, import.meta.url)).bytes();
    const result = await page.evaluate(
      (input) => window.importImageFixture(input),
      { filename, mime, base64: Buffer.from(bytes).toString("base64") },
    );
    cases.push({ fixture, filename, mime, result });
  }
  await Bun.write(
    new URL("web-reference.json", import.meta.url),
    JSON.stringify(
      {
        provenance:
          "Actual current offline image-upload.ts FileReader plus ImageNode/insertImageFiles in installed Tiptap, captured in local Chrome with all network blocked. Technical raster fixtures are not Twyne artwork.",
        blockedNetworkRequests,
        cases,
        nativeDisplayScope:
          "Pinned GPUI honors static EXIF orientation and GIF animation. The existing embedded Image::to_image_data WebP/APNG paths display a static frame; imports preserve and validate all original animation frames without re-encoding.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ cases: cases.length, blockedNetworkRequests }));
} finally {
  await browser.close();
}
