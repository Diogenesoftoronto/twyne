import { expect, test } from "@playwright/test";

test("native source commits atomically, survives no-op visual saves, and protects concurrent edits", async ({
  page,
}) => {
  await page.route("**/__typst-storage-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Typst storage</title>",
    }),
  );
  await page.goto("/__typst-storage-test");
  const result = await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const source = "#let custom = 42\n\nHello";
    await idb.saveFolioTypstToIdb("native", source, undefined, null);
    const first = await idb.loadFolioContentSnapshotFromIdb("native");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("twyne");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("folio-content", "readwrite");
        transaction.objectStore("folio-content").put({
          folioId: "legacy",
          html: "<p>Legacy text</p>",
          updatedAt: 99,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const migrated = await idb.loadFolioContentSnapshotFromIdb("legacy");
    await idb.saveFolioContentToIdb("native", first.html);
    const noOp = await idb.loadFolioContentSnapshotFromIdb("native");
    let staleRejected = false;
    try {
      await idb.saveFolioTypstToIdb("native", "Stale", undefined, null);
    } catch {
      staleRejected = true;
    }
    await idb.saveFolioTypstToIdb("native", "New source", undefined, source);
    let remote: unknown;
    window.addEventListener("twyne:typst-remote-change", (event) => {
      remote = (event as CustomEvent).detail;
    });
    await idb.saveFolioContentSnapshotToIdb({
      folioId: "native",
      html: "<p>Remote</p>",
      typstSource: "Remote",
      format: "typst",
      updatedAt: 123,
    });
    const latest = await idb.loadFolioContentSnapshotFromIdb("native");
    const draftsPath = "/src/utils/typst/source-drafts.ts";
    const drafts = await import(/* @vite-ignore */ draftsPath);
    await drafts.saveTypstSourceDraft({
      folioId: "native",
      source: "#incomplete(",
      baseSource: "Remote",
      updatedAt: 456,
    });
    const pending = await drafts.loadTypstSourceDraft("native");
    const canonicalWithDraft =
      await idb.loadFolioContentSnapshotFromIdb("native");
    await drafts.clearTypstSourceDraft("native");
    return {
      migrated,
      first,
      noOp,
      staleRejected,
      remote,
      latest,
      pending,
      canonicalWithDraft,
      cleared: await drafts.loadTypstSourceDraft("native"),
    };
  });
  expect(result.migrated).toMatchObject({
    format: "typst",
    html: "<p>Legacy text</p>",
    updatedAt: 99,
  });
  expect(result.migrated.typstSource).toContain("Legacy text");
  expect(result.first.typstSource).toBe("#let custom = 42\n\nHello");
  expect(result.noOp).toEqual(result.first);
  expect(result.staleRejected).toBe(true);
  expect(result.latest).toMatchObject({
    typstSource: "Remote",
    html: "<p>Remote</p>",
    updatedAt: 123,
  });
  expect(result.remote).toEqual({
    folioId: "native",
    source: "Remote",
    html: "<p>Remote</p>",
  });
  expect(result.pending.source).toBe("#incomplete(");
  expect(result.canonicalWithDraft).toEqual(result.latest);
  expect(result.cleared).toBeNull();
});
