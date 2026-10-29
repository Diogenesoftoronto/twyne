import { expect, test, type Page } from "@playwright/test";
import { startFakeSyncServer } from "./helpers/fake-sync-server";

/**
 * Several open tabs on one account, all syncing, one of them being typed in.
 *
 * Regression for 2026-10-29: each tab subscribed live to the whole account,
 * so every 4-second typing push re-sent every manuscript to every tab, each
 * tab rewrote them all into IndexedDB, re-serialised its Lix workspace and
 * remounted its editor. Writers with a second window or device saw the room
 * slow to a crawl. The budgets below fail on that behaviour.
 */

const PIECES = 20;
const PIECE_KB = 40;
const SENTENCE = " Then the cartographer wrote another line about the river.";

async function seedAccount(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__sync-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>Seed" }),
  );
  await page.goto("/__sync-seed");
  await page.evaluate(
    async ({ pieces, kb }) => {
      const path = "/src/utils/idb.ts";
      const idb = await import(/* @vite-ignore */ path);
      const now = Date.now();
      const paragraph = `<p>${"The ledger kept its own counsel through the long winter. ".repeat(12)}</p>`;
      const html = paragraph.repeat(Math.ceil((kb * 1024) / paragraph.length));
      const folios = Array.from({ length: pieces }, (_, i) => ({
        id: `piece-${i}`,
        name: `Piece ${i}`,
        type: "draft",
        createdAt: now,
        updatedAt: now,
      }));
      await idb.saveFoliosToIdb(folios);
      for (const folio of folios)
        await idb.saveFolioContentToIdb(folio.id, html);
      await idb.saveActiveFolioIdToIdb("piece-0");
      await idb.saveMetaToIdb("signin-toast-dismissed", true);
      await idb.saveMetaToIdb("live-review-enabled", false);
      localStorage.setItem(
        "twyne:editor:view:v1",
        JSON.stringify({ zenMode: false, compositorOpen: false }),
      );
    },
    { pieces: PIECES, kb: PIECE_KB },
  );
}

async function openEditor(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    "true",
    { timeout: 90_000 },
  );
  await page.evaluate(() => {
    const target = window as unknown as {
      __remounts: number;
      __longTasks: number[];
      __keyLatency: number[];
    };
    target.__remounts = 0;
    target.__longTasks = [];
    target.__keyLatency = [];
    // Key press to the next painted frame, as the writer feels it.
    document.addEventListener(
      "keydown",
      (event) =>
        requestAnimationFrame(() =>
          target.__keyLatency.push(performance.now() - event.timeStamp),
        ),
      true,
    );
    window.addEventListener("twyne:load-folio", () => target.__remounts++);
    new PerformanceObserver((list) =>
      target.__longTasks.push(...list.getEntries().map((e) => e.duration)),
    ).observe({ type: "longtask" });
  });
}

const counters = (page: Page) =>
  page.evaluate(() => {
    const target = window as unknown as {
      __remounts: number;
      __longTasks: number[];
      __keyLatency: number[];
      __syncStatus: () => { kind: string };
    };
    const sorted = [...target.__keyLatency].sort((a, b) => a - b);
    return {
      keys: sorted.length,
      keyP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      remounts: target.__remounts,
      longTaskMs: target.__longTasks.reduce((sum, n) => sum + n, 0),
      status: target.__syncStatus().kind,
    };
  });

test("typing with three tabs open stays light on every tab", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const server = await startFakeSyncServer(context);
  const seed = await context.newPage();
  await seedAccount(seed);
  await seed.close();

  // A writer's main tab, a second window on the same piece, and a third tab
  // left on another piece.
  const tabs = [
    await context.newPage(),
    await context.newPage(),
    await context.newPage(),
  ];
  for (const tab of tabs) await openEditor(tab);
  await tabs[2].evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    await idb.saveActiveFolioIdToIdb("piece-7");
  });
  for (const tab of tabs) await server.attach(tab);
  // Initial hydration pushes and pulls; budgets start after it settles.
  await expect
    .poll(async () => (await counters(tabs[0])).status, { timeout: 60_000 })
    .toBe("synced");
  await tabs[0].waitForTimeout(6_000);
  const baseline = await Promise.all(tabs.map(counters));
  const liveBefore = await server.liveBytes();
  const fetchedBefore = server.fetchedBytes;
  const snapshotsBefore = [...server.snapshotFetches];
  const pushesBefore = server.pushes;

  const writer = tabs[0];
  await writer.bringToFront();
  const manuscript = writer.locator(".ProseMirror");
  await manuscript.click();
  await writer.keyboard.press("ControlOrMeta+End");
  let sentences = 0;
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    await writer.keyboard.type(SENTENCE, { delay: 25 });
    sentences++;
  }
  // Let the last debounced push land and echo to the other tabs.
  await writer.waitForTimeout(7_000);

  const after = await Promise.all(tabs.map(counters));
  const pushes = server.pushes - pushesBefore;
  const liveBytes = (await server.liveBytes()) - liveBefore;
  const fetchedBytes = server.fetchedBytes - fetchedBefore;
  const snapshots = server.snapshotFetches.map(
    (n, i) => n - snapshotsBefore[i]!,
  );
  test.info().annotations.push({
    type: "sync budget",
    description: JSON.stringify({
      pushes,
      liveBytes,
      fetchedBytes,
      snapshots,
      status: after.map((a) => a.status),
      writerKeys: after[0]!.keys - baseline[0]!.keys,
      writerKeyP95: Math.round(after[0]!.keyP95),
      remounts: after.map((a, i) => a.remounts - baseline[i]!.remounts),
      longTaskMs: after.map((a, i) =>
        Math.round(a.longTaskMs - baseline[i]!.longTaskMs),
      ),
    }),
  });

  // The typing reached the server more than once, so the budgets below are
  // measured against real sync traffic.
  expect.soft(pushes).toBeGreaterThanOrEqual(2);
  // Every typed sentence is still in the writer's editor: nothing replaced it.
  await expect.soft
    .poll(
      async () =>
        (
          (await manuscript.innerText()).match(
            /cartographer wrote another line/g,
          ) ?? []
        ).length,
    )
    .toBe(sentences);
  // Live queries carry revision numbers, never the account.
  expect.soft(liveBytes).toBeLessThan(4_096);
  // The writer's own pushes echo back as revisions it already holds, so it
  // never re-downloads the account while typing.
  expect.soft(snapshots[0]).toBe(0);
  // Another tab that has fallen behind fetches at most one snapshot per push.
  for (const n of snapshots.slice(1))
    expect.soft(n).toBeLessThanOrEqual(pushes);
  // The writer's own editor is never remounted by its own pushes, and the
  // tab on another piece is not remounted by edits to piece-0.
  expect.soft(after[0]!.remounts - baseline[0]!.remounts).toBe(0);
  expect.soft(after[2]!.remounts - baseline[2]!.remounts).toBe(0);
  // No tab spends more than a fifth of the typing time blocked.
  for (const [i, tab] of after.entries())
    expect
      .soft(
        tab.longTaskMs - baseline[i]!.longTaskMs,
        `tab ${i} main-thread blocking`,
      )
      .toBeLessThan(4_000);
  for (const tab of after) expect.soft(tab.status).not.toBe("error");
  // Keystrokes in the writer's tab still paint promptly while the others sync.
  // The baseline keys are startup clicks, so the typing dominates this p95.
  expect.soft(after[0]!.keys - baseline[0]!.keys).toBeGreaterThan(200);
  expect
    .soft(after[0]!.keyP95, "writer key-to-frame p95 (ms)")
    .toBeLessThan(100);
  await context.close();
});
