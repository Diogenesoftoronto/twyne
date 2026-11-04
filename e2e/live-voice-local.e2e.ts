import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${resolve("src/assets/live-voice-benchmark.wav")}%noloop`,
    ],
  },
});

test("the desk starts a chosen local session with a stubbed worker", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: async () => ({
          features: new Set(["shader-f16"]),
          info: {
            vendor: "test",
            architecture: "gpu",
            device: "",
            description: "",
          },
        }),
      },
    });
    const NativeWorker = window.Worker;
    class FakeLocalWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(data: { type: string; id: number; mode?: string }) {
        const send = (message: unknown) =>
          queueMicrotask(() => {
            const event = new MessageEvent("message", { data: message });
            this.onmessage?.(event);
            this.dispatchEvent(event);
          });
        if (data.type === "load") send({ type: "loaded", id: data.id });
        if (data.type === "turn" && data.mode === "asr") {
          send({ type: "text", id: data.id, delta: "What is two plus two?" });
          send({ type: "done", id: data.id });
        }
        if (data.type === "turn" && data.mode === "interleaved") {
          send({ type: "text", id: data.id, delta: "The answer is four." });
          send({ type: "audio", id: data.id, samples: new Float32Array(2400) });
          send({ type: "done", id: data.id });
        }
      }
      terminate() {}
    }
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (String(url).includes("live-voice-local.worker"))
          return new FakeLocalWorker() as unknown as Worker;
        super(url, options);
      }
    } as typeof Worker;
  });
  await page.route("**/__local-live-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__local-live-seed");
  await page.evaluate(async () => {
    const idb = await import(/* @vite-ignore */ "/src/utils/idb.ts");
    const model = await import(
      /* @vite-ignore */ "/src/utils/live-voice-local-model.ts"
    );
    const id = "local-live-e2e",
      now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id,
        name: "Local voice",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(id, "<p>A local voice draft.</p>");
    await idb.saveBriefToIdb(id, {
      answers: {
        workingTitle: "Local voice",
        format: "Essay",
        audience: "Readers",
        goal: "Explain",
        tone: "Plain",
        constraints: "",
        successSignal: "",
      },
      attachments: [],
      completedAt: now,
      updatedAt: now,
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("twyne");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("models", "readwrite");
      for (const file of model.LOCAL_LIVE_MANIFEST)
        tx.objectStore("models").put({
          id: file.url,
          blob: new Blob(),
          bytes: file.size,
          updatedAt: now,
        });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem("twyne.live.local", "selected");
    localStorage.setItem(
      "twyne.local-live.benchmark.v1",
      JSON.stringify({
        adapter: "test|gpu",
        revision: model.LOCAL_LIVE_REVISION,
        rate: 2,
      }),
    );
  });
  await page.goto("/editor/");
  const desk = page.getByRole("complementary", { name: "Live voice desk" });
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("twyne:live-voice-open", { detail: {} }),
        ),
      );
      return desk.isVisible();
    })
    .toBe(true);
  await expect(
    desk.getByRole("button", { name: "Using local voice" }),
  ).toBeVisible();
  await desk.getByRole("button", { name: "Start talking" }).click();
  await expect(desk).toHaveAttribute("data-status", /listening|speaking/);
  await expect(desk).toContainText("The answer is four.", { timeout: 30000 });
  await desk.getByRole("button", { name: "End", exact: true }).click();
  await expect(desk).toHaveAttribute("data-status", "idle");
});
