import { expect, test, type Page } from "@playwright/test";

interface FixtureShare {
  lixId: string;
  folioId: string;
  folioName: string;
}
declare global {
  interface Window {
    sharingFixture: {
      shares: FixtureShare[];
      holdOpen?: boolean;
      releaseOpen?: () => void;
      online?: boolean;
    };
  }
}

const manuscript = (page: Page) => page.locator(".ProseMirror").first();

/** Fictional account/backend transports; the actual editor and IndexedDB stay real. */
async function installSharingFixture(page: Page) {
  await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name);
    const browserUrl = urls.find((url) => url.includes("/convex_browser.js"))!;
    const serverUrl = urls.find((url) => url.includes("/convex_server.js"))!;
    const { ConvexClient } = await import(/* @vite-ignore */ browserUrl);
    const { getFunctionName } = await import(/* @vite-ignore */ serverUrl);
    const fixture = (window.sharingFixture = {
      shares: JSON.parse(
        localStorage.getItem("sharing-browser-fixture") ?? "[]",
      ) as FixtureShare[],
      holdOpen: false,
      releaseOpen: undefined as (() => void) | undefined,
      online: false,
    });
    const prototype = ConvexClient.prototype;
    prototype.setAuth = (
      _fetcher: unknown,
      changed?: (authenticated: boolean) => void,
    ) => changed?.(true);
    prototype.onUpdate = () => () => {};
    prototype.query = async (reference: unknown, args: { lixId?: string }) => {
      const name = getFunctionName(reference);
      if (name === "preferences:list") return [];
      if (name === "collaboration:listMyShares") return fixture.shares;
      if (name === "collaboration:getSharedLixMeta") {
        if (fixture.holdOpen)
          await new Promise<void>((resolve) => {
            fixture.releaseOpen = resolve;
          });
        const share = fixture.shares.find((row) => row.lixId === args.lixId);
        return share ? { ...share, role: "owner" } : null;
      }
      if (
        [
          "collaboration:getCollaborators",
          "collaboration:getPresence",
          "collaboration:listPendingInvitations",
          "collaboration:listSharedWithMe",
        ].includes(name)
      )
        return [];
      return null;
    };
    prototype.action = async (
      reference: unknown,
      args: FixtureShare & { blob: ArrayBuffer },
    ) => {
      if (getFunctionName(reference) !== "collaboration:shareFolio")
        return null;
      fixture.shares.push({
        lixId: args.lixId,
        folioId: args.folioId,
        folioName: args.folioName,
      });
      localStorage.setItem(
        "sharing-browser-fixture",
        JSON.stringify(fixture.shares),
      );
      const path = "/src/utils/idb.ts";
      await (
        await import(/* @vite-ignore */ path)
      ).saveMetaToIdb("fixture-shared-blob", new Blob([args.blob]));
      return { lixId: args.lixId, alreadyShared: false };
    };
    prototype.mutation = async (
      reference: unknown,
      args: { lixId: string; expectedRevision?: number },
    ) => {
      if (getFunctionName(reference) === "preferences:put")
        return { accepted: true, revision: (args.expectedRevision ?? 0) + 1 };
      if (getFunctionName(reference) === "collaboration:unshareFolio") {
        fixture.shares = fixture.shares.filter(
          (row) => row.lixId !== args.lixId,
        );
        localStorage.setItem(
          "sharing-browser-fixture",
          JSON.stringify(fixture.shares),
        );
      }
      return { ok: true };
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/lsp/get-v1") && fixture.online) {
        const path = "/src/utils/idb.ts";
        const blob = await (
          await import(/* @vite-ignore */ path)
        ).loadMetaFromIdb("fixture-shared-blob");
        return new Response(blob);
      }
      if (url.includes("/lsp/"))
        return Promise.resolve(
          new Response("Offline sharing fixture", { status: 503 }),
        );
      return originalFetch(input, init);
    };
    const authPath = "/src/utils/auth-client.ts";
    const { authClient } = await import(/* @vite-ignore */ authPath);
    authClient.useSession.set({
      ...authClient.useSession.get(),
      isPending: false,
      data: {
        user: {
          id: "sharing-browser-user",
          email: "sharing@example.test",
          name: "Sharing fixture",
        },
        session: { id: "sharing-browser-session" },
      },
    });
  });
  await expect(
    page.getByTitle("Share this folio with collaborators"),
  ).toBeVisible();
}

async function openEditor(page: Page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": route.request().headers().origin ?? "*",
        "access-control-allow-credentials": "true",
      },
      body: "null",
    }),
  );
  await page.route("**/__sharing_seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Sharing fixture</title>",
    }),
  );
  await page.goto("/__sharing_seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const db = await import(/* @vite-ignore */ path);
    const now = Date.now();
    await db.saveFoliosToIdb(
      ["a", "b"].map((id) => ({
        id: `sharing-${id}`,
        name: `Sharing regression ${id.toUpperCase()}`,
        type: "draft",
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.saveFolioContentToIdb(
      "sharing-a",
      "<p>Original manuscript before sharing.</p>",
    );
    await db.saveFolioContentToIdb(
      "sharing-b",
      "<p>Second private manuscript.</p>",
    );
    await db.saveActiveFolioIdToIdb("sharing-a");
    await db.saveMetaToIdb("live-review-enabled", false);
    await db.saveMetaToIdb("signin-toast-dismissed", true);
    localStorage.setItem("living-desk-open", "false");
    localStorage.setItem(
      "twyne:editor:view:v1",
      JSON.stringify({ zenMode: false, compositorOpen: false }),
    );
  });
  await page.goto("/editor/");
  await expect(manuscript(page)).toContainText("Original manuscript", {
    timeout: 60_000,
  });
  await installSharingFixture(page);
}

async function share(page: Page) {
  await page.getByTitle("Share this folio with collaborators").click();
  await page
    .getByRole("button", { name: "Share this folio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop sharing", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "✕", exact: true }).click();
}

async function diskHtml(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    return (await import(/* @vite-ignore */ path)).loadFolioContentFromIdb(
      "sharing-a",
    );
  });
}

async function writePassages(page: Page, lines: string[]) {
  await manuscript(page).fill(lines[0]);
  await manuscript(page).press("ControlOrMeta+End");
  for (const line of lines.slice(1)) {
    await manuscript(page).press("Enter");
    await manuscript(page).pressSequentially(line);
  }
  await expect.poll(() => diskHtml(page)).toContain(lines.at(-1)!);
}

for (const width of [1280, 390]) {
  test(`review unsent passages, preview choices, and recover both copies at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    await writePassages(page, [
      "Shared first.",
      "Unchanged anchor.",
      "Shared last.",
    ]);
    await share(page);
    await writePassages(page, [
      "Local first.",
      "Unchanged anchor.",
      "Local last.",
    ]);
    await page.reload();
    await expect(manuscript(page)).toContainText("Local first.", {
      timeout: 60_000,
    });
    await installSharingFixture(page);
    const paused = page.getByRole("complementary", { name: "Sharing paused" });
    await expect(paused).toContainText("saved locally");
    await page.evaluate(() => {
      window.sharingFixture.online = true;
    });
    await paused.getByRole("button", { name: "Check shared copy" }).click();
    const review = page.getByRole("dialog", { name: "Review shared changes" });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("group", { name: /Changed passage/ }),
    ).toHaveCount(2);
    expect(
      await page.evaluate(async () => {
        const path = "/src/utils/lix.ts";
        return (await import(/* @vite-ignore */ path)).sharedSessionLixId();
      }),
    ).toBeNull();
    // Escape pauses the review without discarding the manuscript or choices.
    await page.keyboard.press("Escape");
    await expect(review).not.toBeVisible();
    await expect(paused).toContainText("choices are waiting");
    await manuscript(page).press("ControlOrMeta+End");
    await manuscript(page).pressSequentially(" Another local sentence.");
    await expect
      .poll(() => diskHtml(page))
      .toContain("Another local sentence.");
    await paused.getByRole("button", { name: "Review saved changes" }).click();
    await review
      .getByRole("button", { name: "Apply choices and resume sharing" })
      .click();
    await expect(review).toContainText(
      "A copy changed while you were reviewing",
    );
    await review
      .getByRole("group", { name: "Changed passage 2", exact: true })
      .getByRole("radio", { name: "Keep shared passage", exact: true })
      .check();
    const preview = review.getByRole("region", {
      name: "Preview of your choices",
    });
    await expect(preview).toContainText("Local first.");
    await expect(preview).toContainText("Shared last.");
    await expect(preview).not.toContainText("Another local sentence.");
    const downloaded = page.waitForEvent("download");
    await review.getByText("Download original copies", { exact: true }).click();
    await review
      .getByRole("button", { name: "Download this device’s copy", exact: true })
      .click();
    expect((await downloaded).suggestedFilename()).toBe(
      "twyne-device-recovery.html",
    );
    await review.getByText("Download original copies", { exact: true }).click();
    await page.screenshot({
      path: `test-results/shared-review-${width}.png`,
      fullPage: true,
    });
    const noOverflow = await review.evaluate(
      (node) => node.scrollWidth <= node.clientWidth + 1,
    );
    expect(noOverflow).toBe(true);
    await review
      .getByRole("button", { name: "Apply choices and resume sharing" })
      .click();
    await expect(review).toHaveCount(0);
    await expect(manuscript(page)).toContainText("Local first.");
    await expect(manuscript(page)).toContainText("Shared last.");
    await expect(manuscript(page)).not.toContainText("Local last.");
    await expect.poll(() => diskHtml(page)).toContain("Shared last.");
    await page.getByTitle("Share this folio with collaborators").click();
    await page.getByRole("button", { name: "View recovery copies" }).click();
    const recovery = page.getByRole("dialog", { name: "Recovery copies" });
    await expect(recovery).toContainText("Another local sentence.");
    await expect(recovery).toContainText("Shared first.");
    await recovery
      .getByRole("button", { name: "Close recovery copies" })
      .click();
    await expect(recovery).toHaveCount(0);
  });
}

for (const width of [1280, 390]) {
  test(`stopping sharing preserves live edits and the next save at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    await share(page);
    await manuscript(page).fill("Edits made after sharing must survive.");
    await page.getByTitle("Share this folio with collaborators").click();
    await page
      .getByRole("button", { name: "Stop sharing", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Stop sharing", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(manuscript(page)).toContainText(
      "Edits made after sharing must survive.",
    );
    await expect
      .poll(() => diskHtml(page))
      .toContain("Edits made after sharing must survive.");
    await manuscript(page).press("ControlOrMeta+End");
    await manuscript(page).pressSequentially(" Another saved sentence.");
    await expect
      .poll(() => diskHtml(page))
      .toContain("Another saved sentence.");
    await expect
      .poll(() => diskHtml(page))
      .toContain("Edits made after sharing must survive.");
  });
}

test("offline edits survive reopening, and a delayed open cannot attach to the next folio", async ({
  page,
}) => {
  await openEditor(page);
  await share(page);
  await manuscript(page).fill(
    "Offline edits survive reopening the shared manuscript.",
  );
  await expect
    .poll(() => diskHtml(page))
    .toContain("Offline edits survive reopening");
  await page.reload();
  await expect(manuscript(page)).toContainText(
    "Offline edits survive reopening",
  );
  await installSharingFixture(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/utils/lix.ts";
        return (await import(/* @vite-ignore */ path)).sharedSessionLixId();
      }),
    )
    .toBeNull();
  await expect(
    page.getByRole("complementary", { name: "Sharing paused" }),
  ).toContainText("saved locally");
  await expect(manuscript(page)).toContainText(
    "Offline edits survive reopening",
  );
  await page.getByRole("button", { name: "Toggle the drawer sidebar" }).click();
  await page
    .getByRole("button", { name: /Folio II Sharing regression B/ })
    .click();
  await expect(manuscript(page)).toContainText("Second private manuscript");
  await page.evaluate(() => {
    window.sharingFixture.holdOpen = true;
  });
  await page.getByRole("button", { name: "Toggle the drawer sidebar" }).click();
  await page
    .getByRole("button", { name: /Folio I Sharing regression A/ })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.sharingFixture.releaseOpen)))
    .toBe(true);
  await page.getByRole("button", { name: "Toggle the drawer sidebar" }).click();
  await page
    .getByRole("button", { name: /Folio II Sharing regression B/ })
    .click();
  await page.evaluate(() => {
    window.sharingFixture.holdOpen = false;
    window.sharingFixture.releaseOpen?.();
  });
  await expect(manuscript(page)).toContainText("Second private manuscript");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/utils/lix.ts";
        return (await import(/* @vite-ignore */ path)).sharedSessionLixId();
      }),
    )
    .toBeNull();
  await expect(
    page.getByTitle("Share this folio with collaborators"),
  ).toHaveText("Share");
});
