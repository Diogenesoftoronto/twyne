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

test("native proof paginates source, equations and diagrams with local WASM", async ({
  page,
}) => {
  await page.route("**/__typst-proof-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Typst proof</title>",
    }),
  );
  await page.goto("/__typst-proof-test");
  const origin = new URL(page.url()).origin;
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      external.push(request.url());
  });
  const result = await page.evaluate(async () => {
    const modulePath = "/src/utils/typst/client.ts";
    const { compileTypstSource } = await import(/* @vite-ignore */ modulePath);
    const bridgePath = "/src/utils/typst/document.ts";
    const { htmlToTypst } = await import(/* @vite-ignore */ bridgePath);
    const source = htmlToTypst(
      '<h1>Native proof</h1><p>Equation <span data-type="inline-math" data-latex="\\frac{1}{2}"></span></p><div data-type="mermaid-diagram" data-mermaid-source="graph LR; A[Draft] --> B[Proof]"></div><div data-type="page-break"></div><p>Second page.</p>',
    );
    const proof = await compileTypstSource(
      source + "\n$frac(1, 2) + sqrt(x)$",
      { payload: { title: "Native proof", html: "" } },
    );
    const images = await Promise.all(
      proof.pages.map(
        (svg: string) =>
          new Promise<boolean>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src =
              "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
          }),
      ),
    );
    return {
      pageCount: proof.pageCount,
      pages: proof.pages.length,
      header: await proof.pdf.slice(0, 5).text(),
      images,
    };
  });
  expect(result.header).toBe("%PDF-");
  expect(result.pageCount).toBe(2);
  expect(result.pages).toBe(2);
  expect(result.images).toEqual([true, true]);
  expect(external).toEqual([]);
});
