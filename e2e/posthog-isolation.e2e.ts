import { expect, test, type Page } from "@playwright/test";

// Supply a public test token when starting the frontend to exercise SDK loading.
test.skip(
  !process.env.PUBLIC_POSTHOG_KEY,
  "Set PUBLIC_POSTHOG_KEY and PUBLIC_POSTHOG_CAPTURE=false for this check",
);

async function expectAppAssets(page: Page) {
  // Vite can reload once after optimizing dependencies on a cold start.
  await expect(async () => {
    await expect(page.locator(".landing-page")).toBeVisible();
    expect(await page.evaluate(() => document.fonts.status)).toBe("loaded");
  }).toPass({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => document.styleSheets.length))
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.images)
          .filter((image) => image.currentSrc && image.loading !== "lazy")
          .every((image) => image.complete && image.naturalWidth > 0),
      ),
    )
    .toBe(true);
}

async function probeAnalytics(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/utils/posthog-context.tsx";
    const { capturePostHogEvent, getPostHogIdentityContext } = await import(
      modulePath
    );
    const started = performance.now();
    await capturePostHogEvent("isolation_probe", {});
    const identity = await getPostHogIdentityContext();
    return { elapsedMs: performance.now() - started, identity };
  });
}

for (const [name, userAgent] of [
  [
    "desktop Firefox",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  ],
  [
    "iOS Firefox",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
  ],
]) {
  test.describe(name, () => {
    test.use({ userAgent });
    test("renders the app without loading the PostHog SDK or hosts", async ({
      page,
    }) => {
      const requests: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.hostname.endsWith(".posthog.com") ||
          url.pathname.includes("/deps/posthog-js")
        ) {
          requests.push(url.origin + url.pathname);
        }
      });
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expectAppAssets(page);
      await probeAnalytics(page);
      await page.waitForTimeout(2000);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test("blocked PostHog hosts preserve app assets and layout", async ({
  page,
}) => {
  const attempts: string[] = [];
  const errors: string[] = [];
  const failedAppAssets: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === new URL(page.url()).origin &&
      ["stylesheet", "image", "font"].includes(request.resourceType())
    ) {
      failedAppAssets.push(url.pathname);
    }
  });
  await page.route(
    (url) => url.hostname.endsWith(".posthog.com"),
    (route) => {
      attempts.push(new URL(route.request().url()).pathname);
      return route.abort("blockedbyclient");
    },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectAppAssets(page);
  await expect.poll(() => attempts.length).toBeGreaterThan(0);
  const shell = page.locator(".landing-shell");
  const before = await shell.boundingBox();
  await page.waitForTimeout(3500);
  const after = await shell.boundingBox();
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
  expect(failedAppAssets).toEqual([]);
  expect((await probeAnalytics(page)).elapsedMs).toBeLessThan(100);
});

for (const mode of ["blocked", "stalled"] as const) {
  test(`${mode} SDK loading cannot reject or delay app actions`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const sdkRequests: string[] = [];
    const posthogRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith(".posthog.com")) {
        posthogRequests.push(request.url());
      }
    });
    await page.route(
      (url) => url.pathname.includes("/deps/posthog-js"),
      async (route) => {
        sdkRequests.push(route.request().url());
        if (mode === "blocked") {
          await route.abort("blockedbyclient");
        } else {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await route.continue();
        }
      },
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectAppAssets(page);
    const probe = await probeAnalytics(page);
    expect(probe.identity).toEqual({});
    expect(probe.elapsedMs).toBeLessThan(100);
    await expect.poll(() => sdkRequests.length).toBeGreaterThan(0);
    await page.waitForTimeout(3500);
    expect(errors).toEqual([]);
    expect(posthogRequests).toEqual([]);
    expect(sdkRequests).toHaveLength(1);
  });
}
