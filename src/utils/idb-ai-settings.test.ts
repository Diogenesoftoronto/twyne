import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "../types";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();
const originalDescriptors = new Map(
  ["window", "localStorage", "indexedDB"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const storageKey = "twyne.ai-settings.current";
let moduleId = 0;
const freshIdb = () => import(`./idb?ai-settings-regression=${++moduleId}`);

function settings(advancedMode: boolean): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    advancedMode,
    providers: [
      {
        id: "saved-provider",
        name: "Saved provider",
        type: "openai",
        apiKey: "test-key-never-sent",
        defaultModel: "test-model",
        availableModels: ["test-model"],
      },
    ],
    defaultProviderId: "saved-provider",
    perFeature: {
      "persona-feedback": { providerId: "saved-provider", model: "test-model" },
    },
  };
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function install(
  localStorage: ReturnType<typeof storage> | undefined,
  indexedDB?: IDBFactory,
) {
  // Other full-suite tests install DOM event constructors from another realm.
  // This storage fixture only observes the notification, not DOM dispatch.
  let savedEvents = 0;
  const target = {
    dispatchEvent: (event: Event) => {
      if (event.type === "twyne:ai-settings-saved") savedEvents++;
      return true;
    },
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: target },
    localStorage: { configurable: true, writable: true, value: localStorage },
    indexedDB: { configurable: true, writable: true, value: indexedDB },
  });
  return () => savedEvents;
}

/** Controllable transaction completion, including an abort after put succeeds. */
function indexedDbFixture(initial?: AiSettings) {
  let value = initial;
  let delayReads = false;
  const reads: Array<() => void> = [];
  const writes: Array<{
    value: AiSettings;
    commit: () => void;
    abort: () => void;
  }> = [];
  const db = {
    transaction: (_name: string, mode?: string) => {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: new Error("Storage transaction aborted"),
        objectStore: () => ({
          get: () => {
            const snapshot =
              value && structuredClone({ key: "current", value });
            const request = {
              result: snapshot,
              onsuccess: null as (() => void) | null,
            };
            const finish = () => request.onsuccess?.();
            if (delayReads) reads.push(finish);
            else queueMicrotask(finish);
            return request;
          },
          put: (record: { value: AiSettings }) => {
            if (mode !== "readwrite")
              throw new Error("Expected a write transaction");
            const snapshot = structuredClone(record.value);
            writes.push({
              value: snapshot,
              commit: () => {
                value = snapshot;
                transaction.oncomplete?.();
              },
              abort: () => transaction.onabort?.(),
            });
            // Request success alone is deliberately insufficient to commit.
            return { result: "current" };
          },
        }),
      };
      return transaction;
    },
  };
  const factory = {
    open: () => {
      const request = { result: db, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    writes,
    reads,
    delayReads: () => {
      delayReads = true;
    },
  };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Expected storage operation was not queued");
}

afterEach(() => {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
afterAll(releaseBrowserGlobalsLock);

describe.serial("AI settings durable persistence", () => {
  test("turning BYOK off survives a fresh load and preserves providers and keys", async () => {
    const local = storage();
    local.setItem(storageKey, JSON.stringify(settings(true)));
    const db = indexedDbFixture(settings(true));
    const savedEvents = install(local, db.factory);
    const idb = await freshIdb();
    const off = settings(false);
    const save = idb.saveAiSettingsToIdb(off);
    await waitFor(() => db.writes.length === 1);
    expect(savedEvents()).toBe(0);
    db.writes[0].commit();
    await save;
    expect(savedEvents()).toBe(1);
    expect(await (await freshIdb()).loadAiSettingsFromIdb()).toEqual(off);
    expect(db.writes[0].value).toEqual(off);
  });

  test("rapid saves are ordered and snapshot nested provider data at invocation", async () => {
    const db = indexedDbFixture();
    install(undefined, db.factory);
    const idb = await freshIdb();
    const first = settings(true);
    const second = settings(false);
    const saveOn = idb.saveAiSettingsToIdb(first);
    const saveOff = idb.saveAiSettingsToIdb(second);
    second.providers[0].apiKey = "mutated-after-save";
    await waitFor(() => db.writes.length === 1);
    expect(db.writes[0].value.advancedMode).toBe(true);
    db.writes[0].commit();
    await waitFor(() => db.writes.length === 2);
    expect(db.writes[1].value).toEqual(settings(false));
    db.writes[1].commit();
    await Promise.all([saveOn, saveOff]);
    expect(await (await freshIdb()).loadAiSettingsFromIdb()).toEqual(
      settings(false),
    );
  });

  test("IndexedDB-only saves announce success only after transaction commit", async () => {
    const db = indexedDbFixture();
    const savedEvents = install(undefined, db.factory);
    const idb = await freshIdb();
    let resolved = false;
    const save = idb.saveAiSettingsToIdb(settings(false)).then(() => {
      resolved = true;
    });
    await waitFor(() => db.writes.length === 1);
    expect(resolved).toBe(false);
    expect(savedEvents()).toBe(0);
    db.writes[0].commit();
    await save;
    expect(savedEvents()).toBe(1);
  });

  test("an aborted transaction rejects without announcing success, and retry works", async () => {
    const db = indexedDbFixture();
    const savedEvents = install(undefined, db.factory);
    const idb = await freshIdb();
    const save = idb.saveAiSettingsToIdb(settings(false));
    const rejected = save.catch((error: Error) => error);
    await waitFor(() => db.writes.length === 1);
    db.writes[0].abort();
    expect(await rejected).toMatchObject({
      message: expect.stringContaining("could not be saved"),
    });
    expect(savedEvents()).toBe(0);
    const retry = idb.saveAiSettingsToIdb(settings(false));
    await waitFor(() => db.writes.length === 2);
    db.writes[1].commit();
    await retry;
    expect(savedEvents()).toBe(1);
  });

  test("localStorage remains a durable fallback when the IndexedDB transaction aborts", async () => {
    const local = storage();
    const db = indexedDbFixture();
    const savedEvents = install(local, db.factory);
    const idb = await freshIdb();
    const save = idb.saveAiSettingsToIdb(settings(false));
    await waitFor(() => db.writes.length === 1);
    db.writes[0].abort();
    await save;
    expect(savedEvents()).toBe(1);
    expect(await idb.loadAiSettingsFromIdb()).toEqual(settings(false));
  });

  test("an unwritable old localStorage copy cannot override a successful IDB save", async () => {
    const local = storage();
    local.setItem(storageKey, JSON.stringify(settings(true)));
    local.setItem = () => {
      throw new Error("Quota exceeded");
    };
    const db = indexedDbFixture(settings(true));
    install(local, db.factory);
    const idb = await freshIdb();
    const save = idb.saveAiSettingsToIdb(settings(false));
    await waitFor(() => db.writes.length === 1);
    // Keep the previous persisted value until the replacement commits.
    expect(JSON.parse(local.getItem(storageKey)!).advancedMode).toBe(true);
    db.writes[0].commit();
    await save;
    expect(local.getItem(storageKey)).toBe(null);
    expect(await (await freshIdb()).loadAiSettingsFromIdb()).toEqual(
      settings(false),
    );
  });

  test("a blocked localStorage getter falls back to IndexedDB", async () => {
    const db = indexedDbFixture();
    install(undefined, db.factory);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    const idb = await freshIdb();
    const save = idb.saveAiSettingsToIdb(settings(false));
    await waitFor(() => db.writes.length === 1);
    db.writes[0].commit();
    await save;
    expect(await idb.loadAiSettingsFromIdb()).toEqual(settings(false));
  });

  test("failure of both storage backends rejects instead of claiming settings were saved", async () => {
    const local = storage();
    local.setItem = () => {
      throw new Error("Quota exceeded");
    };
    const savedEvents = install(local);
    await expect(
      (await freshIdb()).saveAiSettingsToIdb(settings(false)),
    ).rejects.toThrow("could not be saved");
    expect(savedEvents()).toBe(0);
  });

  test("a slow older read cannot resurrect BYOK after an off save", async () => {
    const local = storage();
    const db = indexedDbFixture(settings(true));
    db.delayReads();
    install(local, db.factory);
    const idb = await freshIdb();
    const read = idb.loadAiSettingsFromIdb();
    await waitFor(() => db.reads.length === 1);
    const save = idb.saveAiSettingsToIdb(settings(false));
    await waitFor(() => db.writes.length === 1);
    db.writes[0].commit();
    await save;
    db.reads[0]();
    expect(await read).toEqual(settings(false));
  });
});
