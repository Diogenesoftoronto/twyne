// bun desktop/gpui/fixtures/editor/capture-flow-web.ts
// Local current-source PM reference; no user profile or remote requests.
import { chromium } from "@playwright/test";

const bundle = await Bun.build({
  entrypoints: [new URL("flow-web-entry.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
  minify: false,
});
if (!bundle.success) throw new Error(bundle.logs.join("\n"));
const javascript = await bundle.outputs
  .find((output) => output.kind === "entry-point")!
  .text();
const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  let blockedNetworkRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent("<html><head></head><body></body></html>");
  await page.addScriptTag({ content: javascript });
  const reference = await page.evaluate(
    () => (window as any).twyneFlowReference,
  );
  if (!reference || errors.length || blockedNetworkRequests)
    throw new Error(JSON.stringify({ errors, blockedNetworkRequests }));
  const output =
    process.env.TWYNE_FLOW_REFERENCE_OUTPUT ??
    "/tmp/twyne-flow-web-reference.json";
  await Bun.write(
    output,
    `${JSON.stringify({ browser: browser.version(), blockedNetworkRequests, ...reference }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        output,
        cases: reference.cases,
        boundaryText: reference.boundaryText,
        boundaryWords: reference.boundaryWords,
        atomLeafText: reference.atomLeafText,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
