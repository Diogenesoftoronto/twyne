import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, theme: "editorial" },
  { name: "mobile", width: 390, height: 844, theme: "nightpress" },
  { name: "narrow", width: 320, height: 844, theme: "editorial" },
]) {
  test(`manual teaches the writing instruments at ${viewport.name} size`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/docs/#writing-instruments");
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      viewport.theme,
    );
    const chapter = page.locator("#writing-instruments");
    await expect(
      chapter.getByRole("heading", { name: "Writing instruments", exact: true }),
    ).toBeVisible();
    const guide = chapter.locator(".manual-walkthrough");
    const steps = guide.locator(".manual-walkthrough-steps button");
    await expect(steps).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await steps.nth(i).click();
      await expect(steps.nth(i)).toHaveAttribute("aria-pressed", "true");
      await expect(guide.locator(".manual-step-position")).toHaveText(
        `Step ${i + 1} of 2`,
      );
      await expect
        .poll(() =>
          guide
            .locator("img")
            .evaluate(
              (img: HTMLImageElement) =>
                img.complete &&
                img.naturalWidth > 300 &&
                img.naturalHeight > 200,
            ),
        )
        .toBe(true);
      await expect(guide.locator("img")).toHaveAttribute("alt", /.+/);
      const path = info.outputPath(`manual-${viewport.name}-step-${i + 1}.png`);
      await guide.screenshot({ path, animations: "disabled" });
      await info.attach(`Step ${i + 1}`, { path, contentType: "image/png" });
    }
    await steps.first().click();
    await expect(guide).toHaveScreenshot(`manual-${viewport.name}.png`);
    await guide.getByText("Read all the steps", { exact: true }).click();
    await expect(guide.locator(".manual-written-steps li")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ media: "print" });
    await expect(guide.locator(".manual-print-steps")).toBeVisible();
    await expect(steps.first()).toBeHidden();
  });
}

test("manual film loads, seeks, carries captions and pauses when closed", async ({
  page,
  request,
}) => {
  await page.goto("/docs/#writing-instruments");
  const film = page.locator("#writing-instruments .manual-video");
  const video = film.locator("video");
  await expect(video).toHaveAttribute("preload", "none");
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const source = (await video.getAttribute("src"))!;
  const range = await request.get(source, {
    headers: { Range: "bytes=0-1023" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["accept-ranges"]).toBe("bytes");
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-1023\//);
  expect((await range.body()).byteLength).toBe(1024);
  const size = Number(range.headers()["content-range"].split("/")[1]);
  const head = await request.head(source);
  expect(head.status()).toBe(200);
  expect(Number(head.headers()["content-length"])).toBe(size);
  const suffix = await request.get(source, {
    headers: { Range: "bytes=-128" },
  });
  expect(suffix.status()).toBe(206);
  expect(suffix.headers()["content-range"]).toBe(
    `bytes ${size - 128}-${size - 1}/${size}`,
  );
  expect((await suffix.body()).byteLength).toBe(128);
  const invalid = await request.get(source, {
    headers: { Range: `bytes=${size}-` },
  });
  expect(invalid.status()).toBe(416);
  expect(invalid.headers()["content-range"]).toBe(`bytes */${size}`);
  const captions = await request.get(
    (await video.locator("track").getAttribute("src"))!,
  );
  expect(captions.ok()).toBe(true);
  expect(await captions.text()).toMatch(/^WEBVTT/);
  await film.locator(":scope > summary").click();
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBe(1440);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = Math.min(3, v.duration / 2);
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(2);
  await film.locator(":scope > summary").click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
});
