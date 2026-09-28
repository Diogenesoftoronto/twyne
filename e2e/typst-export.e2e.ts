import { expect, test } from "@playwright/test";

test("the real browser worker produces a PDF using only local compiler and font assets", async ({
  page,
}) => {
  // Exercise the actual Vite worker pipeline without requiring a signed-in account.
  await page.route("**/__typst-export-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Typst export integration</title>",
    }),
  );
  await page.goto("/__typst-export-test");
  const origin = new URL(page.url()).origin;
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      externalRequests.push(request.url());
  });
  const result = await page.evaluate(async () => {
    const modulePath = "/src/utils/typst/export.ts";
    const { exportTypst } = await import(/* @vite-ignore */ modulePath);
    const progress: string[] = [];
    const svg =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>',
      );
    const blob = await exportTypst(
      {
        title: "Browser export",
        html: `<h1>Browser export</h1><p>Live worker <strong>bold</strong> and note<sup data-type="footnote" data-endnote-text="Footnote survives."></sup>.</p><figure data-image-width="25"><img src="${svg}" alt="Red square"><figcaption>Embedded image</figcaption></figure>`,
      },
      "pdf",
      { onProgress: (message: string) => progress.push(message) },
    );
    return {
      type: blob.type,
      size: blob.size,
      header: await blob.slice(0, 5).text(),
      progress,
    };
  });
  expect(result.type).toBe("application/pdf");
  expect(result.header).toBe("%PDF-");
  expect(result.size).toBeGreaterThan(1000);
  expect(result.progress).toContain("Typesetting your PDF…");
  expect(externalRequests).toEqual([]);
});
