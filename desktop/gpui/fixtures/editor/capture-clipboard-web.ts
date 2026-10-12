// bun desktop/gpui/fixtures/editor/capture-clipboard-web.ts
// Uses a fresh isolated browser, current source, and zero external requests.
import { chromium } from "@playwright/test";
const bundle = await Bun.build({
  entrypoints: [new URL("clipboard-web-entry.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
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
  const errors: string[] = [];
  let blockedNetworkRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: javascript });
  const reference = await page.evaluate(
    () => (window as any).twyneClipboardReference,
  );
  if (!reference || errors.length || blockedNetworkRequests)
    throw new Error(JSON.stringify({ errors, blockedNetworkRequests }));
  const output =
    process.env.TWYNE_CLIPBOARD_REFERENCE_OUTPUT ??
    "/tmp/twyne-clipboard-web-reference.json";
  await Bun.write(
    output,
    `${JSON.stringify({ browser: browser.version(), blockedNetworkRequests, ...reference }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      output,
      cases: reference.cases.map((entry: any) => entry.name),
      plainPasted: reference.plainPasted,
    }),
  );
} finally {
  await browser.close();
}
