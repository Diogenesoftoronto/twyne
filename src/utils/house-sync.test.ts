import { afterAll, afterEach, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project.
import { JSDOM } from "jsdom";
import type { ConvexClient } from "convex/browser";
import {
  emptyHouseState,
  type HouseState,
  type LedgerEntry,
} from "./house-model";
import { HOUSE_CHANGED_EVENT } from "./house-store";
import { mergeHouseStates, startHouseSync } from "./house-sync";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
// Keep event constructors in the same realm even when another test replaces
// the global CustomEvent with a browser shim.
const browser = new JSDOM("", { url: "https://house-sync.test" }).window;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: browser,
});
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
});
afterAll(() => {
  if (windowDescriptor)
    Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
  browser.close();
  releaseBrowserGlobalsLock();
});

function state(at: number): HouseState {
  return {
    ...emptyHouseState(at),
    house: { name: String(at), dossier: { tone: String(at) }, updatedAt: at },
    collections: [
      {
        id: String(at),
        name: "Series",
        description: "",
        dossier: {},
        folioIds: ["folio"],
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
}
describe("mergeHouseStates", () => {
  test("newer house selects the house and entire collection snapshot", () => {
    const local = state(1),
      remote = state(2);
    expect(mergeHouseStates(local, remote).house).toEqual(remote.house);
    expect(mergeHouseStates(local, remote).collections).toEqual(
      remote.collections,
    );
    expect(mergeHouseStates(remote, local).collections).toEqual(
      remote.collections,
    );
    expect(
      mergeHouseStates(local, { ...remote, collections: [] }).collections,
    ).toEqual([]);
  });
  test("ties preserve local house and collections", () => {
    const local = state(2),
      remote = state(2);
    remote.house.name = "Other";
    remote.collections = [];
    expect(mergeHouseStates(local, remote)).toEqual(local);
  });
  test("newer withdrawals survive an older remote charter", () => {
    const local = state(3),
      remote = state(1);
    remote.charter = [
      {
        id: "item",
        scope: "house",
        ownerRef: "house",
        text: "Withdrawn",
        severity: "must",
        kind: "style",
        order: 0,
        updatedAt: 1,
      },
    ];
    const before = JSON.stringify([local, remote]);
    expect(mergeHouseStates(local, remote).charter).toEqual([]);
    expect(mergeHouseStates(remote, local).charter).toEqual([]);
    expect(JSON.stringify([local, remote])).toBe(before);
  });
  test("ledger unions ids newest first and retains local duplicates", () => {
    const local = state(1),
      remote = state(2);
    const entry = {
      id: "a",
      at: 1,
      layer: "house",
      ownerRef: "house",
      source: "manual",
    } as const;
    local.ledger = [entry];
    remote.ledger = [
      { ...entry, reason: "duplicate" },
      { ...entry, id: "b", at: 3 },
    ];
    expect(mergeHouseStates(local, remote).ledger).toEqual([
      { ...entry, id: "b", at: 3 },
      entry,
    ]);
  });
});

function ledger(count: number, prefix = "entry", start = 0): LedgerEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${start + count - i}`,
    at: start + count - i,
    layer: "house",
    ownerRef: "house",
    source: "manual",
  }));
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function syncHarness(
  initialLocal: HouseState,
  initialRemote: HouseState | null = null,
  stored = new Map<string, string[]>(),
) {
  let local = structuredClone(initialLocal);
  let remote = structuredClone(initialRemote);
  const uploads: HouseState[] = [];
  const replacements: HouseState[] = [];
  const savedAccounts: string[] = [];
  const jobs = new Set<() => void>();
  let subscriber: (() => void) | undefined;
  let stop = () => {};
  let unsubscribeCount = 0;
  let queryCount = 0;
  const hooks: {
    mutation?: (next: HouseState, call: number) => Promise<void> | void;
    query?: () => Promise<void> | void;
    load?: () => Promise<void> | void;
    replace?: (next: HouseState, call: number) => Promise<void> | void;
    save?: () => Promise<void> | void;
    loadAcknowledgements?: () => Promise<void> | void;
  } = {};
  const client = {
    query: async () => {
      queryCount++;
      // Model the actual query window, never a complete server ledger.
      const view =
        remote &&
        structuredClone({
          ...remote,
          ledger: remote.ledger.slice(0, 200),
        });
      await hooks.query?.();
      return view;
    },
    mutation: async (_fn: unknown, next: HouseState) => {
      uploads.push(structuredClone(next));
      await hooks.mutation?.(next, uploads.length);
      remote = remote ? mergeHouseStates(next, remote) : structuredClone(next);
    },
    onUpdate: (_fn: unknown, _args: unknown, callback: () => void) => {
      subscriber = callback;
      return () => {
        subscriber = undefined;
        unsubscribeCount++;
      };
    },
  } as unknown as ConvexClient;
  let currentClient: ConvexClient | null = client;
  const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const h = {
    client,
    hooks,
    uploads,
    replacements,
    stored,
    savedAccounts,
    idle,
    get local() {
      return local;
    },
    get remote() {
      return remote;
    },
    get unsubscribeCount() {
      return unsubscribeCount;
    },
    get queryCount() {
      return queryCount;
    },
    setClient(next: ConvexClient | null) {
      currentClient = next;
    },
    edit(next: HouseState) {
      local = structuredClone({ ...next, ledger: next.ledger.slice(0, 500) });
      browser.dispatchEvent(
        new browser.CustomEvent(HOUSE_CHANGED_EVENT, {
          detail: { state: structuredClone(local), remote: false },
        }),
      );
    },
    refresh() {
      browser.dispatchEvent(new browser.Event("twyne:remote-sync"));
    },
    online() {
      browser.dispatchEvent(new browser.Event("online"));
    },
    notify() {
      subscriber?.();
    },
    start(accountId = "account-a") {
      stop = startHouseSync(() => currentClient, accountId, {
        loadState: async () => {
          const value = structuredClone(local);
          await hooks.load?.();
          return value;
        },
        replaceState: async (next, options) => {
          replacements.push(structuredClone(next));
          await hooks.replace?.(next, replacements.length);
          local = structuredClone({
            ...next,
            ledger: next.ledger.slice(0, 500),
          });
          browser.dispatchEvent(
            new browser.CustomEvent(HOUSE_CHANGED_EVENT, {
              detail: {
                state: structuredClone(local),
                remote: options?.remote === true,
              },
            }),
          );
          return structuredClone(local);
        },
        loadAcknowledgements: async (id) => {
          await hooks.loadAcknowledgements?.();
          return [...(stored.get(id) ?? [])];
        },
        saveAcknowledgements: async (id, ids) => {
          await hooks.save?.();
          stored.set(id, [...ids]);
          savedAccounts.push(id);
        },
        defer: (work) => {
          jobs.add(work);
          return () => {
            jobs.delete(work);
          };
        },
      });
      cleanups.push(stop);
    },
    stop() {
      stop();
    },
    async flush() {
      // Yield through all queued async work, then run only the injected timers.
      // A blocked gate deliberately remains pending until the test releases it.
      for (let i = 0; i < 20; i++) {
        await idle();
        if (jobs.size === 0) return;
        const scheduled = [...jobs];
        jobs.clear();
        for (const job of scheduled) job();
      }
      throw new Error("House sync did not settle.");
    },
  };
  return h;
}

describe("startHouseSync", () => {
  test("uploads 500 entries in batches once across refreshes and restart", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const h = syncHarness(local);
    h.start();
    await h.flush();
    expect(h.uploads.map((s) => s.ledger.length)).toEqual([200, 200, 100]);
    expect(h.remote?.ledger).toHaveLength(500);
    expect(h.stored.get("account-a")).toHaveLength(500);
    h.refresh();
    h.online();
    h.notify();
    await h.flush();
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(3);
    expect(h.local).toEqual(local);
  });

  test("a latest-200 query acknowledges only its visible ids", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const h = syncHarness(local, local);
    h.start();
    await h.flush();
    expect(h.uploads.map((s) => s.ledger.length)).toEqual([200, 100]);
    expect(h.uploads.flatMap((s) => s.ledger)).toEqual(local.ledger.slice(200));
    h.refresh();
    await h.flush();
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(2);
  });

  test("partial batch failure retries only unacknowledged entries after restart", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const h = syncHarness(local);
    h.hooks.mutation = (_next, call) => {
      if (call === 2) throw new Error("offline");
    };
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(2);
    expect(new Set(h.stored.get("account-a"))).toEqual(
      new Set(local.ledger.slice(0, 200).map((e) => e.id)),
    );
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads.slice(2).flatMap((s) => s.ledger)).toEqual(
      local.ledger.slice(200),
    );
    expect(h.remote?.ledger).toHaveLength(500);
    h.refresh();
    await h.flush();
    expect(h.uploads).toHaveLength(4);
  });

  test("acknowledgement storage failure recovers without resending accepted batches", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const h = syncHarness(local, { ...local, ledger: [] });
    let fail = true;
    h.hooks.save = () => {
      if (fail) throw new Error("storage unavailable");
    };
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(1);
    expect(h.stored.has("account-a")).toBe(false);
    fail = false;
    h.online();
    await h.flush();
    expect(h.uploads.map((s) => s.ledger.length)).toEqual([200, 200, 100]);
    expect(h.stored.get("account-a")).toHaveLength(500);
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(3);
  });

  test("dirty acknowledgements persist on refresh even with no entries left to send", async () => {
    const local = { ...state(1000), ledger: ledger(300) };
    const h = syncHarness(local, { ...local, ledger: [] });
    let fail = true;
    h.hooks.save = () => {
      if (fail && h.uploads.length === 2)
        throw new Error("storage unavailable");
    };
    h.start();
    await h.flush();
    expect(h.stored.get("account-a")).toHaveLength(200);
    fail = false;
    h.refresh();
    await h.flush();
    expect(h.stored.get("account-a")).toHaveLength(300);
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(2);
  });

  test("a local edit during upload survives and sends only its new ledger entry", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const h = syncHarness(local);
    const blocked = gate();
    h.hooks.mutation = (_next, call) =>
      call === 1 ? blocked.promise : undefined;
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(1);
    const edited = {
      ...state(1001),
      ledger: [...ledger(1, "edit", 1000), ...local.ledger],
    };
    h.edit(edited);
    blocked.resolve();
    await h.flush();
    expect(h.uploads.map((s) => s.ledger.length)).toEqual([200, 200, 100, 1]);
    expect(h.uploads.at(-1)?.house).toEqual(edited.house);
    expect(h.local.house).toEqual(edited.house);
    expect(h.remote?.house).toEqual(edited.house);
    expect(h.stored.get("account-a")).toHaveLength(501);
    h.refresh();
    await h.flush();
    expect(h.uploads).toHaveLength(4);
  });

  test("a local edit during a remote write is restored with both ledger histories", async () => {
    const local = { ...state(1000), ledger: ledger(1) };
    const remote = { ...state(1001), ledger: ledger(1, "remote", 1000) };
    const h = syncHarness(local, remote);
    const blocked = gate();
    h.hooks.replace = (_next, call) =>
      call === 1 ? blocked.promise : undefined;
    h.start();
    await h.idle();
    expect(h.replacements).toHaveLength(1);
    const edited = {
      ...state(1002),
      ledger: [...ledger(1, "edit", 1001), ...local.ledger],
    };
    h.edit(edited);
    blocked.resolve();
    await h.flush();
    expect(h.local.house).toEqual(edited.house);
    expect(h.local.collections).toEqual(edited.collections);
    expect(h.local.ledger).toEqual(mergeHouseStates(edited, remote).ledger);
    expect(h.remote?.house).toEqual(edited.house);
    expect(
      h.uploads
        .flatMap((s) => s.ledger)
        .map((e) => e.id)
        .sort(),
    ).toEqual(edited.ledger.map((e) => e.id).sort());
  });

  test("remote history can trim the local display without discarding pending history or acknowledgements", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const remote = { ...state(1001), ledger: ledger(200, "remote", 1000) };
    const h = syncHarness(local, remote);
    h.start();
    await h.flush();
    expect(h.local.ledger).toHaveLength(500);
    expect(h.remote?.ledger).toHaveLength(700);
    expect(h.stored.get("account-a")).toHaveLength(700);
    expect(h.uploads.flatMap((s) => s.ledger)).toEqual(local.ledger);
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(3);
  });

  test("a snapshot change with acknowledged history sends an empty ledger only once", async () => {
    const local = { ...state(1000), ledger: ledger(300) };
    const stored = new Map([["account-a", local.ledger.map((e) => e.id)]]);
    const h = syncHarness(local, local, stored);
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(0);
    h.edit({
      ...local,
      house: { ...local.house, name: "Edited", updatedAt: 1001 },
    });
    await h.flush();
    expect(h.uploads.map((s) => s.ledger)).toEqual([[]]);
    h.refresh();
    await h.flush();
    h.stop();
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(1);
    expect(h.remote?.house.name).toBe("Edited");
  });

  test("acknowledgements are scoped to the account", async () => {
    const local = { ...state(1000), ledger: ledger(300) };
    const stored = new Map([["account-a", local.ledger.map((e) => e.id)]]);
    const h = syncHarness(local, { ...local, ledger: [] }, stored);
    h.start("account-b");
    await h.flush();
    expect(h.uploads.flatMap((s) => s.ledger)).toEqual(local.ledger);
    expect(h.savedAccounts.every((id) => id === "account-b")).toBe(true);
    expect(h.stored.get("account-a")).toEqual(local.ledger.map((e) => e.id));
    expect(h.stored.get("account-b")).toHaveLength(300);
  });

  test("a missing server snapshot resets previous acknowledgements and uploads retained history", async () => {
    const local = { ...state(1000), ledger: ledger(300) };
    const stored = new Map([["account-a", local.ledger.map((e) => e.id)]]);
    const h = syncHarness(local, null, stored);
    h.start();
    await h.flush();
    expect(h.uploads.flatMap((s) => s.ledger)).toEqual(local.ledger);
    expect(h.remote?.ledger).toHaveLength(300);
  });

  test("teardown cancels deferred uploads and removes refresh listeners", async () => {
    const h = syncHarness(state(1000));
    h.start();
    await h.idle();
    h.stop();
    h.stop();
    h.refresh();
    h.online();
    h.notify();
    h.edit(state(1001));
    await h.flush();
    expect(h.uploads).toHaveLength(0);
    expect(h.queryCount).toBe(1);
    expect(h.unsubscribeCount).toBe(1);
  });

  test("an in-flight successful batch is persisted after teardown without sending another batch", async () => {
    const local = { ...state(1000), ledger: ledger(500) };
    const h = syncHarness(local);
    const blocked = gate();
    h.hooks.mutation = (_next, call) =>
      call === 1 ? blocked.promise : undefined;
    h.start();
    await h.flush();
    expect(h.uploads).toHaveLength(1);
    h.stop();
    blocked.resolve();
    await h.flush();
    expect(h.uploads).toHaveLength(1);
    expect(h.stored.get("account-a")).toHaveLength(200);
    h.start();
    await h.flush();
    expect(h.uploads.map((s) => s.ledger.length)).toEqual([200, 200, 100]);
  });

  test("teardown during acknowledgement loading prevents the query", async () => {
    const h = syncHarness(state(1000));
    const blocked = gate();
    h.hooks.loadAcknowledgements = () => blocked.promise;
    h.start();
    await h.idle();
    h.stop();
    blocked.resolve();
    await h.flush();
    expect(h.queryCount).toBe(0);
    expect(h.uploads).toHaveLength(0);
  });

  test("a client change while the local read is pending discards the stale pull", async () => {
    const h = syncHarness(state(1000), state(1001));
    const blocked = gate();
    h.hooks.load = () => blocked.promise;
    h.start();
    await h.idle();
    h.setClient(null);
    blocked.resolve();
    await h.flush();
    expect(h.replacements).toHaveLength(0);
    expect(h.savedAccounts).toHaveLength(0);
    expect(h.uploads).toHaveLength(0);
    h.hooks.load = undefined;
    h.setClient(h.client);
    h.refresh();
    await h.flush();
    expect(h.local.house).toEqual(state(1001).house);
  });
});
