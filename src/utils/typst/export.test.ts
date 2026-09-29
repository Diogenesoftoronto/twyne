import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import { exportTypst } from "./export";
import type { TypstCompileResponse } from "./protocol";
import { DEFAULT_LAYOUT } from "../../types";

const payload = {
  title: "Draft",
  html: "<p>Current manuscript.</p>",
  layout: {
    ...DEFAULT_LAYOUT,
    openingInitial: {
      mode: "off" as const,
      collection: "botanical" as const,
      size: "medium" as const,
    },
  },
};
const dom = new JSDOM("", { url: "https://twyne.test/editor/" });
const originals = new Map<string, PropertyDescriptor | undefined>();

class FakeWorker {
  static instances: FakeWorker[] = [];
  static onPost: ((worker: FakeWorker) => void) | undefined;
  terminated = false;
  onmessage?: (event: { data: TypstCompileResponse }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage() {
    FakeWorker.onPost?.(this);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: TypstCompileResponse) {
    this.onmessage?.({ data });
  }
}

function replaceGlobal(name: string, value: unknown) {
  if (!originals.has(name))
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

beforeEach(() => {
  replaceGlobal("DOMParser", dom.window.DOMParser);
  replaceGlobal("window", dom.window);
  replaceGlobal("Worker", FakeWorker);
  FakeWorker.instances = [];
  FakeWorker.onPost = undefined;
});

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

describe("Typst export lifecycle", () => {
  test("standalone source embeds only the selected initial and border", async () => {
    const requests: string[] = [];
    replaceGlobal("fetch", async (url: URL) => {
      requests.push(url.pathname);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const source = await (
      await exportTypst(
        { ...payload, layout: { ...DEFAULT_LAYOUT, pageBorder: "botanical" } },
        "source",
      )
    ).text();
    expect(requests).toEqual([
      "/assets/illuminated-initials/c.avif",
      ...["nw", "n", "ne", "w", "e", "sw", "s", "se"].map(
        (part) => `/assets/page-borders/slices/botanical-${part}.avif`,
      ),
    ]);
    expect(source).not.toContain('image("/twyne-decoration/');
    expect(source).toContain("image(twyne-image-1,");
    expect(source).toContain("image(twyne-image-2,");
    expect(FakeWorker.instances).toHaveLength(0);
  });
  test("source export does not start a compiler and embeds a repeated image once", async () => {
    let requests = 0;
    replaceGlobal("fetch", async () => {
      requests++;
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const blob = await exportTypst(
      {
        ...payload,
        html: '<p><img src="/photo.png"><img src="/photo.png"></p>',
      },
      "source",
    );
    const source = await blob.text();
    expect(requests).toBe(1);
    expect(FakeWorker.instances).toHaveLength(0);
    expect(source.match(/#let twyne-image-1/g)).toHaveLength(1);
    expect(source.match(/#image\(twyne-image-1,/g)).toHaveLength(2);
    expect(source).not.toContain('image("/images/');
  });

  test("canonical Typst source remains authoritative over the HTML projection", async () => {
    const source = await (
      await exportTypst(
        {
          ...payload,
          html: "<p>STALE HTML</p>",
          typstSource: "= Authoritative\nNative source.",
        },
        "source",
      )
    ).text();
    expect(source).toContain("= Authoritative\nNative source.");
    expect(source).not.toContain("STALE HTML");
    expect(FakeWorker.instances).toHaveLength(0);
  });

  test("canonical image helpers embed fetched images into standalone source", async () => {
    replaceGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
    const source = await (
      await exportTypst(
        {
          ...payload,
          typstSource:
            '#twyne-image("https://twyne.test/photo.png", width: 50%, alt: "Photo")',
        },
        "source",
      )
    ).text();
    expect(source).toContain(
      '#image(bytes((1,2,3,)), width: 50%, alt: "Photo")',
    );
    expect(source).not.toContain("https://twyne.test/photo.png");
  });

  test("returns a PDF and terminates the worker after completion", async () => {
    const progress: string[] = [];
    FakeWorker.onPost = (worker) => {
      worker.reply({ type: "progress", message: "Typesetting…" });
      worker.reply({
        type: "pdf",
        bytes: new TextEncoder().encode("%PDF-fixture"),
      });
    };
    const blob = await exportTypst(payload, "pdf", {
      onProgress: (message) => progress.push(message),
    });
    expect(blob.type).toBe("application/pdf");
    expect(await blob.text()).toBe("%PDF-fixture");
    expect(progress).toContain("Typesetting…");
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  test("cancelling during compilation terminates the worker and rejects", async () => {
    const controller = new AbortController();
    FakeWorker.onPost = () => controller.abort();
    await expect(
      exportTypst(payload, "pdf", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  test("an already cancelled export starts neither fetch nor worker", async () => {
    let fetched = false;
    replaceGlobal("fetch", async () => {
      fetched = true;
      return new Response("image");
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportTypst({ ...payload, html: '<img src="/image.png">' }, "pdf", {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetched).toBe(false);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  test("compiler errors and worker crashes release the worker", async () => {
    FakeWorker.onPost = (worker) =>
      worker.reply({ type: "error", message: "Unsupported image" });
    await expect(exportTypst(payload, "pdf")).rejects.toThrow(
      "Unsupported image",
    );
    expect(FakeWorker.instances[0].terminated).toBe(true);
    FakeWorker.onPost = (worker) => worker.onerror?.();
    await expect(exportTypst(payload, "pdf")).rejects.toThrow("could not load");
    expect(FakeWorker.instances[1].terminated).toBe(true);
  });

  test("rejects oversized, empty, unavailable, and unsafe image sources", async () => {
    for (const response of [
      new Response("large", {
        headers: { "content-length": String(9 * 1024 * 1024) },
      }),
      new Response(new Uint8Array()),
      new Response("missing", { status: 404 }),
    ]) {
      replaceGlobal("fetch", async () => response);
      await expect(
        exportTypst({ ...payload, html: '<img src="/image.png">' }, "source"),
      ).rejects.toThrow();
    }
    await expect(
      exportTypst(
        { ...payload, html: '<img src="file:///private.png">' },
        "source",
      ),
    ).rejects.toThrow("cannot be exported");
    expect(FakeWorker.instances).toHaveLength(0);
  });

  test("streaming image limits apply even without a Content-Length header", async () => {
    let cancelled = false;
    replaceGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    await expect(
      exportTypst({ ...payload, html: '<img src="/large.png">' }, "source"),
    ).rejects.toThrow("too much image data");
    expect(cancelled).toBe(true);
  });
});
