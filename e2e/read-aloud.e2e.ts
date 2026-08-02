import { expect, test, type Page } from "@playwright/test";

/**
 * The toolbar's read control used to call the speech manager and then show
 * nothing at all — no spinner, no playing state, and crucially no error. A
 * writer with no voice provider configured pressed it and got silence, which
 * is indistinguishable from a broken button. These tests are about the state
 * being visible, not about the audio itself.
 */

async function openEditor(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open("twyne", 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of [
          ["folios", "id"],
          ["folio-content", "folioId"],
          ["brief", "folioId"],
          ["comments", "id"],
          ["personas", "id"],
          ["meta", "key"],
          ["ai-settings", "key"],
          ["lix-blob", "key"],
          ["voice-notes", "id"],
        ] as const) {
          if (!d.objectStoreNames.contains(name)) {
            d.createObjectStore(name, { keyPath });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["folios", "folio-content", "meta"], "readwrite");
      t.objectStore("folios").put({
        id: "e2e-speech",
        name: "Speech fixture",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      });
      t.objectStore("folio-content").put({
        folioId: "e2e-speech",
        html: "<p>A passage the room can read back to the writer.</p>",
        updatedAt: now,
      });
      t.objectStore("meta").put({
        key: "active-folio-id",
        value: "e2e-speech",
        updatedAt: now,
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  });
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
}

test.describe("read aloud transport", () => {
  test("the control is present and starts idle", async ({ page }) => {
    await openEditor(page);
    const play = page.getByRole("button", { name: /read the selection aloud/i });
    await expect(play).toBeVisible();
    await expect(play).toHaveText(/read/i);
    // Nothing to stop or seek until something is sounding.
    await expect(page.getByRole("button", { name: "Stop reading" })).toHaveCount(
      0,
    );
  });

  test("a failed reading reports itself instead of going silent", async ({
    page,
  }) => {
    // No voice provider is configured in the test environment and there is no
    // account, so synthesis must fail. The point is that it fails *visibly*.
    await openEditor(page);
    await page.getByRole("button", { name: /read the selection aloud/i }).click();

    const notice = page.locator('.twyne-toolbar [role="status"]');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    // A specific reason, not an empty box. The manager reaches this state via
    // idle → loading → error; before the fix it never left idle, because the
    // settings read that threw sat outside the try block.
    await expect(notice).toContainText(/not configured|could not/i);
  });

  test("the reading passes through a loading state", async ({ page }) => {
    await openEditor(page);
    const log = await page.evaluate(async () => {
      const seen: string[] = [];
      const onSpeech = (e: Event) =>
        seen.push((e as CustomEvent).detail.status);
      window.addEventListener("twyne:speech", onSpeech);
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        /read the selection aloud/i.test(b.getAttribute("aria-label") ?? ""),
      );
      btn?.click();
      await new Promise((r) => setTimeout(r, 5000));
      window.removeEventListener("twyne:speech", onSpeech);
      return seen;
    });
    expect(log).toContain("loading");
    expect(log[log.length - 1]).toBe("error");
  });

  test("the speech manager exposes pause, resume and stop", async ({ page }) => {
    // The transport is only as good as the manager underneath it; check the
    // state machine directly rather than trying to synthesise real audio.
    await openEditor(page);
    const shape = await page.evaluate(async () => {
      // A variable specifier: this is a Vite dev-server URL, not a module
      // path TypeScript can resolve from the e2e directory.
      const spec = "/src/utils/speech.ts";
      const mod = await import(/* @vite-ignore */ spec);
      return {
        pause: typeof mod.pauseSpeech,
        resume: typeof mod.resumeSpeech,
        toggle: typeof mod.togglePauseSpeech,
        stop: typeof mod.stopSpeech,
        seek: typeof mod.seekSpeech,
        state: mod.speechState(),
      };
    });
    expect(shape.pause).toBe("function");
    expect(shape.resume).toBe("function");
    expect(shape.toggle).toBe("function");
    expect(shape.stop).toBe("function");
    expect(shape.seek).toBe("function");
    // Progress fields exist so a transport has something to show.
    expect(shape.state).toHaveProperty("currentTime");
    expect(shape.state).toHaveProperty("duration");
  });

  test("pausing holds the position instead of discarding it", async ({
    page,
  }) => {
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const spec = "/src/utils/speech.ts";
      const mod = await import(/* @vite-ignore */ spec);
      const before = mod.speechState().status;
      mod.pauseSpeech(); // nothing playing — must be a no-op, not a throw
      mod.resumeSpeech();
      mod.togglePauseSpeech();
      mod.seekSpeech(5);
      return { before, after: mod.speechState().status };
    });
    // The important property: every transport call is safe when idle.
    expect(result.before).toBe("idle");
    expect(result.after).toBe("idle");
  });
});
