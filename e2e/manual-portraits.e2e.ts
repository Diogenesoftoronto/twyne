import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  for (const theme of ["editorial", "nightpress"]) {
    test(`manual portraits preserve transparency and fit ${viewport.name} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.route(/\/api\/auth\//, (route) =>
        route.fulfill({ contentType: "application/json", body: "null" }),
      );
      await page.goto("/docs/#room");
      await page.waitForLoadState("networkidle");
      await page.evaluate((theme) => {
        document.documentElement.setAttribute("data-theme", theme);
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      }, theme);
      const portraits = page.locator(".manual-editors__portrait");
      await expect(portraits).toHaveCount(5);
      for (const id of ["reader", "devil", "angel", "scholar", "editor"]) {
        const image = portraits
          .filter({ hasNot: page.locator("unused") })
          .locator(
            `xpath=self::img[contains(@src, '/${id}-transparent.webp')]`,
          );
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
          )
          .toBe(true);
        const pixels = await image.evaluate((img: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(img, 0, 0);
          return {
            alpha: [
              [0, 0],
              [canvas.width - 1, 0],
              [0, canvas.height - 1],
              [canvas.width - 1, canvas.height - 1],
            ].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]),
            background: getComputedStyle(img).backgroundColor,
            src: img.currentSrc,
          };
        });
        expect(pixels.alpha.slice(0, 2)).toEqual([0, 0]);
        expect(pixels.alpha.every((alpha) => alpha <= 2)).toBe(true);
        expect(pixels.background).toBe("rgba(0, 0, 0, 0)");
        expect(pixels.src).toContain(`${id}-transparent-480.webp`);
        const box = (await image.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(96);
        expect(box.width).toBeLessThanOrEqual(144);
        expect(Math.abs(box.height / box.width - 1402 / 1122)).toBeLessThan(
          0.01,
        );
        await image.locator("..").screenshot({
          path: info.outputPath(`${id}-${viewport.name}-${theme}.png`),
          animations: "disabled",
        });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(".manual-editors").screenshot({
        path: info.outputPath(`all-editors-${viewport.name}-${theme}.png`),
        animations: "disabled",
      });
    });
  }
}
