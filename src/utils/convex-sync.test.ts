import { afterEach, describe, expect, mock, test } from "bun:test";

/**
 * These tests exercise the folio sync path — "gracefully sending information
 * through the folio" — without a real browser or Convex backend. We give the
 * module a minimal `window`, mock the IndexedDB + Lix layers it reads from, and
 * inject a fake Convex client to observe (or fail) the outgoing mutation.
 */

// Minimal browser global so the local-first guard (`typeof window`) passes.
(globalThis as { window?: unknown }).window = {
  localStorage: (() => {
    const store: Record<string, string> = {};
    return {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
  })(),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
};

const SAMPLE_FOLIOS = [
  { id: "f1", name: "Draft", type: "draft", createdAt: 1, updatedAt: 2 },
];
const SAMPLE_HTML = "<p>hello from the folio</p>";

// Stub the local storage layers buildLocalSnapshot() reads from.
mock.module("./idb", () => ({
  // Read paths used by buildLocalSnapshot()
  loadFoliosFromIdb: async () => SAMPLE_FOLIOS,
  loadActiveFolioIdFromIdb: async () => "f1",
  loadFolioContentFromIdb: async () => SAMPLE_HTML,
  loadPersonasFromIdb: async () => [],
  loadDraftHtmlFromIdb: async () => "",
  loadLixBlobFromIdb: async () => null,
  // Write paths convex-sync imports but our tests never hit — safe no-ops.
  saveFoliosToIdb: async () => {},
  saveFolioContentToIdb: async () => {},
  savePersonasToIdb: async () => {},
  saveDraftHtmlToIdb: async () => {},
  clearIdbStore: async () => {},
}));

mock.module("./lix", () => ({
  BRIEF_PATH: "/brief.json",
  readFileAsJson: async () => null,
  writeFileAsJson: async () => {},
  persistToIdb: async () => {},
}));

const { setConvexSyncContext, clearConvexSyncContext, flushNow } = await import(
  "./convex-sync"
);

interface RecordingClient {
  calls: Array<Record<string, unknown>>;
  query: (...args: unknown[]) => Promise<unknown>;
  mutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

function makeClient(opts: { fail?: boolean } = {}): RecordingClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    // No remote data → handleUserChanged takes the "seed the account" path.
    query: async () => null,
    mutation: async (_ref, args) => {
      calls.push(args);
      if (opts.fail) throw new Error("network down");
      return null;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  clearConvexSyncContext();
});

describe("folio sync (convex-sync)", () => {
  test("sends folios and their content through to the backend", async () => {
    const client = makeClient();
    setConvexSyncContext(client as never, "user-1");
    await tick(); // let the background sign-in push settle
    client.calls.length = 0; // isolate the explicit flush below

    await flushNow();

    expect(client.calls.length).toBe(1);
    const payload = client.calls[0];
    expect(payload.folios).toEqual(SAMPLE_FOLIOS);
    expect(payload.folioContent).toEqual([
      { folioId: "f1", html: SAMPLE_HTML },
    ]);
  });

  test("swallows a failing backend without throwing", async () => {
    const client = makeClient({ fail: true });
    setConvexSyncContext(client as never, "user-2");
    await tick();

    // The mutation throws, but the folio send must degrade gracefully.
    await expect(flushNow()).resolves.toBeUndefined();
  });

  test("is a safe no-op when signed out", async () => {
    clearConvexSyncContext();
    const client = makeClient();

    await flushNow();

    expect(client.calls.length).toBe(0);
  });
});
