import { afterEach, afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

/**
 * The store layer is mocked so the bundle logic can be tested without a real
 * IndexedDB. Records mimic the real store's content key: files land under
 * their full remote URL, and listing filters by a prefix.
 */
const store = new Map<
  string,
  { blob: Blob; bytes: number }
>();

mock.module("./idb", () => ({
  saveModelFileToIdb: async (id: string, blob: Blob) => {
    store.set(id, { blob, bytes: blob.size });
  },
  loadModelFileFromIdb: async (id: string) => store.get(id)?.blob ?? null,
  listModelFilesFromIdb: async (prefix: string) =>
    [...store.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, rec]) => ({ id, ...rec, updatedAt: 0 })),
  deleteModelFileFromIdb: async (id: string) => {
    store.delete(id);
  },
}));

const {
  evictModelBundle,
  isModelBundleDownloaded,
  modelDownloadState,
} = await import(`./models-cache?models-cache-test=${Date.now()}`);

const REMOTE_BASE = "https://huggingface.co/example/voice-model/resolve/main/";
const manifest = [
  { url: `${REMOTE_BASE}config.json`, size: 10 },
  { url: `${REMOTE_BASE}onnx/model.onnx`, size: 20 },
  { url: `${REMOTE_BASE}voices/F1.bin`, size: 30 },
];
const BUNDLE_ID = "browser-voice";

beforeAll(() => {
  // `canPersist()` gates every function on a browser-like global.
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, "indexedDB", {
    value: {},
    configurable: true,
  });
});

afterEach(() => {
  store.clear();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).indexedDB;
});

function seed(name: string, size: number): void {
  store.set(`${REMOTE_BASE}${name}`, {
    blob: new Blob([new Uint8Array(size)]),
    bytes: size,
  });
}

describe("model bundle download state", () => {
  test("is ready when every manifest file is on disk, keyed by URL", async () => {
    seed("config.json", 10);
    seed("onnx/model.onnx", 20);
    seed("voices/F1.bin", 30);
    // The bundle id never matches a stored key — only the URL prefix does.
    expect(await isModelBundleDownloaded(BUNDLE_ID, manifest)).toBe(true);
    const state = await modelDownloadState(BUNDLE_ID, manifest);
    expect(state.phase).toBe("ready");
    expect(state.progress).toBe(1);
    expect(state.downloadedBytes).toBe(60);
  });

  test("reports partial progress", async () => {
    seed("config.json", 10);
    const state = await modelDownloadState(BUNDLE_ID, manifest);
    expect(state.phase).toBe("downloading");
    expect(state.downloadedBytes).toBe(10);
    expect(state.progress).toBeCloseTo(10 / 60);
  });

  test("is not downloaded when nothing matches the URL prefix", async () => {
    expect(await isModelBundleDownloaded(BUNDLE_ID, manifest)).toBe(false);
    const state = await modelDownloadState(BUNDLE_ID, manifest);
    expect(state.phase).toBe("not-downloaded");
  });
});

describe("downloadBundle eviction", () => {
  test("removes only the bundle's own files, leaving unrelated keys alone", async () => {
    seed("config.json", 10);
    seed("onnx/model.onnx", 20);
    seed("voices/F1.bin", 30);
    store.set("some-unrelated-key", {
      blob: new Blob([new Uint8Array(4)]),
      bytes: 4,
    });

    await evictModelBundle(BUNDLE_ID, manifest);

    expect(store.has(`${REMOTE_BASE}config.json`)).toBe(false);
    expect(store.has(`${REMOTE_BASE}onnx/model.onnx`)).toBe(false);
    expect(store.has(`${REMOTE_BASE}voices/F1.bin`)).toBe(false);
    expect(store.has("some-unrelated-key")).toBe(true);
    expect(await isModelBundleDownloaded(BUNDLE_ID, manifest)).toBe(false);
  });
});