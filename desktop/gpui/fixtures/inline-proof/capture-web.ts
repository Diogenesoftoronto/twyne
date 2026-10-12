// Verification only. Run: bun desktop/gpui/fixtures/inline-proof/capture-web.ts
// Uses an explicitly selected local browser and blocks every network request.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

type Fixture = {
  id: string;
  kind: string;
  source: string;
  block: boolean;
  font_size_px: number;
  width_px: number;
  color: number;
};
const fixtures: { cases: Fixture[] } = await Bun.file(
  new URL("cases.json", import.meta.url),
).json();
const output =
  process.env.TWYNE_INLINE_FIXTURE_OUTPUT_DIR ?? "/tmp/twyne-inline-proof";
await mkdir(output, { recursive: true });
const build = await Bun.build({
  entrypoints: [new URL("web-entry.ts", import.meta.url).pathname],
  target: "browser",
  minify: true,
});
if (!build.success) throw new Error(build.logs.map(String).join("\n"));
const javascript = await build.outputs[0].text();
let katexCss = await Bun.file(
  new URL(
    "../../../../src/components/editor/math/katex.min.css",
    import.meta.url,
  ),
).text();
for (const match of [...katexCss.matchAll(/url\(([^)]+)\)/g)]) {
  const font = match[1].replace(/["']/g, "");
  const bytes = await Bun.file(
    new URL(`../../../../src/components/editor/math/${font}`, import.meta.url),
  ).bytes();
  katexCss = katexCss.replace(
    match[0],
    `url(data:font/${font.split(".").at(-1)};base64,${Buffer.from(bytes).toString("base64")})`,
  );
}
const mathCss = (
  await Bun.file(
    new URL("../../../../src/components/editor/math/math.css", import.meta.url),
  ).text()
).replace(/@import[^;]+;/g, "");
const lora = await Bun.file(
  new URL(
    "../../../../src/assets/typst/lora-Lora-Regular.ttf",
    import.meta.url,
  ),
).bytes();
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 900 },
    deviceScaleFactor: 2,
  });
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.setContent(
    "<!doctype html><html><head></head><body><div id='fixture'></div></body></html>",
  );
  await page.addStyleTag({
    content: `@font-face{font-family:Lora;src:url(data:font/ttf;base64,${Buffer.from(lora).toString("base64")})}body{margin:16px;background:#faf5e7;color:#1f1b16;font-family:Lora,serif;font-size:18px;line-height:1.8}${katexCss}\n${mathCss}`,
  });
  await page.addScriptTag({ content: javascript });
  const results = [];
  for (const fixture of fixtures.cases.filter(
    (item) => item.kind !== "typst",
  )) {
    const result = await page.evaluate(async (input) => {
      const render = (
        window as unknown as {
          renderInlineFixture: (
            fixture: Fixture,
          ) => Promise<{
            svg?: string;
            width: number;
            height: number;
            error?: string | null;
            engine: string;
          }>;
        }
      ).renderInlineFixture;
      return render(input);
    }, fixture);
    if (result.svg)
      await Bun.write(`${output}/web-${fixture.id}.svg`, result.svg);
    await page
      .locator("#fixture")
      .screenshot({ path: `${output}/web-${fixture.id}.png` });
    results.push({
      id: fixture.id,
      source: fixture.source,
      ...result,
      svg: result.svg ? `${output}/web-${fixture.id}.svg` : undefined,
    });
  }
  const report = {
    results,
    blockedNetworkRequests,
    fonts:
      "Original local Lora and KaTeX source assets; no hosted font service.",
    gap: "LaTeX native images use MathJax proof SVG; these KaTeX Write dimensions are reference evidence, not proof of parity. Mermaid is a local-browser fixture only and needs an explicit packaged runtime before shipping.",
  };
  await Bun.write(
    `${output}/web-geometry.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ output, cases: results.length, blockedNetworkRequests }),
  );
} finally {
  await browser.close();
}
