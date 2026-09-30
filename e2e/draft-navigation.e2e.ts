import { expect, test, type Page } from "@playwright/test";

const folioId = "navigation-draft";
const baseline = "The settled manuscript.";

async function seed(page: Page) {
  await page.route("**/__navigation-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>Seed" }),
  );
  await page.goto("/__navigation-seed");
  await page.evaluate(
    async ({ folioId, baseline }) => {
      const path = "/src/utils/idb.ts";
      const idb = await import(/* @vite-ignore */ path);
      const now = Date.now();
      await idb.saveFoliosToIdb([
        {
          id: folioId,
          name: "Navigation draft",
          type: "draft",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await idb.saveFolioContentToIdb(folioId, `<p>${baseline}</p>`);
      await idb.saveActiveFolioIdToIdb(folioId);
    },
    { folioId, baseline },
  );
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toContainText(baseline);
}

test("full navigation before either debounce recovers the final edit even if departure IDB cannot commit", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  // Hold the two persistence debounces rather than racing a wall-clock delay.
  // A pending IndexedDB request on departure is allowed to never complete.
  await page.evaluate(() => {
    const setTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 400 || delay === 500 || delay === 2500)
        return setTimeout(() => {}, 60000);
      return setTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name) => {
        const store = objectStore(name);
        if (name === "folio-content" && args[1] === "readwrite") {
          store.put = () => ({}) as IDBRequest<IDBValidKey>;
        }
        return store;
      };
      return tx;
    };
    // Chromium's same-tab departure may still be visible when pagehide fires.
    // Pin that state so the regression cannot pass by hiding the page first.
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
    });
  });
  const tail = " The final sentence survives navigation.";
  await page.keyboard.insertText(tail);
  await expect(editor).toContainText(tail.trim());
  const before = await page.evaluate(async (folioId) => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    return idb.loadFolioContentSnapshotFromIdb(folioId);
  }, folioId);
  expect(before.html).not.toContain(tail.trim());
  await page.goto("/library/");
  const mirror = await page.evaluate(() =>
    localStorage.getItem("twyne:draft-crash-mirror"),
  );
  expect(mirror).toContain(tail.trim());
  await page.getByRole("button", { name: /Navigation draft/ }).click();
  await expect(page.locator(".ProseMirror")).toContainText(tail.trim());
  const after = await page.evaluate(async (folioId) => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    return idb.loadFolioContentSnapshotFromIdb(folioId);
  }, folioId);
  expect(after.html).toContain(tail.trim());
  expect(after.typstSource).toContain(tail.trim());
  await page.screenshot({
    path: testInfo.outputPath("recovered-draft.png"),
    fullPage: true,
  });
  await testInfo.attach("navigation-recovery", {
    body: JSON.stringify(
      { before, mirror: JSON.parse(mirror!), after, errors },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

test("recovery preserves newer and historical remote restorations and dirty Typst source", async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async (folioId) => {
    const idbPath = "/src/utils/idb.ts";
    const mirrorPath = "/src/utils/crash-mirror.ts";
    const draftsPath = "/src/utils/typst/source-drafts.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const mirror = await import(/* @vite-ignore */ mirrorPath);
    const drafts = await import(/* @vite-ignore */ draftsPath);
    const original = await idb.loadFolioContentSnapshotFromIdb(folioId);
    const dirty = {
      folioId,
      source: "#let private = 7\n\nUnapplied source.",
      baseSource: original.typstSource,
      updatedAt: Date.now(),
    };
    await drafts.saveTypstSourceDraft(dirty);
    mirror.writeCrashMirror(folioId, "<p>Obsolete visual tail.</p>");
    // Historical restores deliberately have an older stamp than the mirror.
    const restored = {
      folioId,
      html: "<p>Remote restoration.</p>",
      typstSource: "#let custom = 42\n\nRemote restoration.",
      format: "typst",
      updatedAt: 1,
    };
    await idb.saveFolioContentSnapshotToIdb(restored);
    const remoteRecovered =
      await idb.recoverFolioContentFromCrashMirror(folioId);
    const remote = await idb.loadFolioContentSnapshotFromIdb(folioId);
    mirror.writeCrashMirror(folioId, "<p>Older local tail.</p>");
    // Install a newer canonical row without a live event to exercise the
    // transactional freshness check independently of remote invalidation.
    const newer = { ...restored, updatedAt: Date.now() + 10000 };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("twyne");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("folio-content", "readwrite");
        tx.objectStore("folio-content").put(newer);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const newerRecovered =
      await idb.recoverFolioContentFromCrashMirror(folioId);
    return {
      dirty,
      restored,
      remoteRecovered,
      remote,
      newer,
      newerRecovered,
      canonical: await idb.loadFolioContentSnapshotFromIdb(folioId),
      pending: await drafts.loadTypstSourceDraft(folioId),
    };
  }, folioId);
  expect(result.remoteRecovered).toBe(false);
  expect(result.remote).toEqual(result.restored);
  expect(result.newerRecovered).toBe(false);
  expect(result.canonical).toEqual(result.newer);
  expect(result.pending).toEqual(result.dirty);
});

test("an older IDB read finishing after the newer mirror cannot discard its tail", async ({
  page,
}) => {
  await page.route("**/__navigation-storage", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>Storage" }),
  );
  await page.goto("/__navigation-storage");
  const result = await page.evaluate(async () => {
    const idbPath = "/src/utils/idb.ts";
    const mirrorPath = "/src/utils/crash-mirror.ts";
    const idb = await import(/* @vite-ignore */ idbPath);
    const mirror = await import(/* @vite-ignore */ mirrorPath);
    const folioId = "in-flight";
    const documentPath = "/src/utils/typst/document.ts";
    const { typstToHtml } = await import(/* @vite-ignore */ documentPath);
    const source = "#let custom = 42\n\nBaseline.";
    const baselineHtml = typstToHtml(source);
    const draftA = baselineHtml.replace(
      "<p>Baseline.</p>",
      "<p>Baseline. Draft A.</p>",
    );
    const draftB = baselineHtml.replace(
      "<p>Baseline.</p>",
      "<p>Baseline. Draft A. Final draft B.</p>",
    );
    await idb.saveFolioTypstToIdb(folioId, source, baselineHtml);
    const realNow = Date.now;
    const queuedAt = realNow() + 100;
    let clock = queuedAt;
    Date.now = () => clock;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      const request = get.apply(this, args);
      if (this.name === "folio-content")
        request.addEventListener("success", () => {
          clock = queuedAt + 1;
          mirror.writeCrashMirror(folioId, draftB);
          // The pending IDB read completes only after B's emergency timestamp.
          clock = queuedAt + 2;
        });
      return request;
    };
    try {
      await idb.saveFolioContentToIdb(folioId, draftA);
    } finally {
      IDBObjectStore.prototype.get = get;
      Date.now = realNow;
    }
    const older = await idb.loadFolioContentSnapshotFromIdb(folioId);
    const recovered = await idb.recoverFolioContentFromCrashMirror(folioId);
    return {
      queuedAt,
      older,
      recovered,
      final: await idb.loadFolioContentSnapshotFromIdb(folioId),
    };
  });
  expect(result.older.updatedAt).toBe(result.queuedAt);
  expect(result.recovered).toBe(true);
  expect(result.final.html).toContain("Final draft B.");
  expect(result.final.typstSource).toContain("#let custom = 42");
});
