import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { HouseState, LedgerEntry } from "./house-model";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import {
  HOUSE_CHANGED_EVENT,
  loadHouseState,
  replaceHouseState,
  type HouseChangedDetail,
} from "./house-store";

/** Equal timestamps keep the local value. Neither input is mutated. */
export function mergeHouseStates(
  local: HouseState,
  remote: HouseState,
): HouseState {
  const winner =
    remote.house.updatedAt > local.house.updatedAt ? remote : local;
  const ledger = new Map(remote.ledger.map((entry) => [entry.id, entry]));
  for (const entry of local.ledger) ledger.set(entry.id, entry);
  return {
    house: winner.house,
    collections: winner.collections,
    // Charter membership belongs to the snapshot too; unioning resurrects deletions.
    charter: winner.charter,
    ledger: [...ledger.values()].sort(
      (a, b) => b.at - a.at || a.id.localeCompare(b.id),
    ),
  };
}

export interface HouseSyncDependencies {
  loadState: typeof loadHouseState;
  replaceState: typeof replaceHouseState;
  loadAcknowledgements(accountId: string): Promise<string[]>;
  saveAcknowledgements(accountId: string, ids: string[]): Promise<void>;
  defer(work: () => void): () => void;
}

const acknowledgementKey = (accountId: string) =>
  `house-sync-acknowledgements:${accountId}`;

export function startHouseSync(
  getClient: () => ConvexClient | null,
  accountId: string,
  overrides: Partial<HouseSyncDependencies> = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  const deps: HouseSyncDependencies = {
    loadState: loadHouseState,
    replaceState: replaceHouseState,
    loadAcknowledgements: async (id) => {
      const ids = await loadMetaFromIdb<unknown>(acknowledgementKey(id));
      return Array.isArray(ids) ? ids.filter((v) => typeof v === "string") : [];
    },
    saveAcknowledgements: async (id, ids) => {
      const key = acknowledgementKey(id);
      await saveMetaToIdb(key, ids);
      if (JSON.stringify(await loadMetaFromIdb(key)) !== JSON.stringify(ids)) {
        throw new Error("House sync acknowledgements could not be saved.");
      }
    },
    defer: (work) => {
      const timer = setTimeout(work, 2000);
      return () => clearTimeout(timer);
    },
    ...overrides,
  };
  let stopped = false;
  let cancelPush: (() => void) | undefined;
  let snapshotDirty = false;
  let revision = 0;
  let latestLocalState: HouseState | undefined;
  let loadedAcknowledgements = false;
  let acknowledgementsDirty = false;
  const acknowledged = new Set<string>();
  const unacknowledged = new Map<string, LedgerEntry>();
  const isCurrent = (client: ConvexClient) =>
    !stopped && getClient() === client;
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    pending = pending
      .then(async () => {
        if (!stopped) await work();
      })
      .catch(() => {
        // Retain the pending snapshot/entries for online or client recovery.
      });
  };
  const loadAcknowledgements = async () => {
    if (loadedAcknowledgements) return;
    for (const id of await deps.loadAcknowledgements(accountId)) {
      acknowledged.add(id);
      unacknowledged.delete(id);
    }
    loadedAcknowledgements = true;
  };
  const trackEntries = (state: HouseState) => {
    for (const entry of state.ledger) {
      if (!acknowledged.has(entry.id)) unacknowledged.set(entry.id, entry);
    }
  };
  const persistAcknowledgements = async () => {
    if (!acknowledgementsDirty) return;
    await deps.saveAcknowledgements(accountId, [...acknowledged]);
    acknowledgementsDirty = false;
  };
  const acknowledge = async (ids: string[]) => {
    for (const id of ids) {
      if (!acknowledged.has(id)) acknowledgementsDirty = true;
      acknowledged.add(id);
      unacknowledged.delete(id);
    }
    // The bounded display history is not the set of all accepted entries.
    // Keep successes even when those entries leave the local ledger.
    await persistAcknowledgements();
  };
  const push = async () => {
    const client = getClient();
    if (!client || stopped) return;
    await loadAcknowledgements();
    if (!isCurrent(client)) return;
    await persistAcknowledgements();
    if (!isCurrent(client)) return;
    const version = revision;
    const state = await deps.loadState();
    if (!isCurrent(client) || version !== revision) return;
    trackEntries(state);
    const entries = [...unacknowledged.values()];
    if (!snapshotDirty && entries.length === 0) return;
    for (let offset = 0; offset < Math.max(1, entries.length); offset += 200) {
      if (!isCurrent(client)) return;
      const batch = entries.slice(offset, offset + 200);
      await client.mutation(api.house.putHouseSnapshot, {
        ...state,
        ledger: batch,
      });
      // A successful earlier batch stays acknowledged if a later batch fails.
      // An in-flight success still belongs to this account after teardown.
      await acknowledge(batch.map((entry) => entry.id));
      if (!isCurrent(client)) return;
    }
    if (revision === version) snapshotDirty = false;
  };
  const schedule = () => {
    if (stopped) return;
    cancelPush?.();
    cancelPush = deps.defer(() => {
      cancelPush = undefined;
      enqueue(push);
    });
  };
  const pull = async () => {
    const client = getClient();
    if (!client || stopped) return;
    await loadAcknowledgements();
    if (!isCurrent(client)) return;
    const remote = await client.query(api.house.getHouse, {});
    if (!isCurrent(client)) return;
    let version = revision;
    const local = await deps.loadState();
    if (!isCurrent(client) || version !== revision) return;
    // Capture pending history before a remote merge can trim the display.
    trackEntries(local);
    let merged = remote ? mergeHouseStates(local, remote) : local;
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      merged = await deps.replaceState(merged, { remote: true });
      if (!isCurrent(client)) return;
      // Local writes do not share this queue. If one finished during the
      // remote write, restore its snapshot and retain both ledger histories.
      while (version !== revision && latestLocalState) {
        version = revision;
        merged = await deps.replaceState(
          {
            ...latestLocalState,
            ledger: mergeHouseStates(latestLocalState, merged).ledger,
          },
          { remote: true },
        );
        if (!isCurrent(client)) return;
      }
    }
    if (!isCurrent(client) || version !== revision) return;
    // getHouse returns only the newest 200 ledger entries, not a complete
    // acknowledgement. Missing IDs are pending only if we have never sent them.
    if (remote) await acknowledge(remote.ledger.map((entry) => entry.id));
    else {
      // A missing server House needs a full initial upload, including history.
      acknowledged.clear();
      acknowledgementsDirty = true;
      await persistAcknowledgements();
    }
    if (!isCurrent(client) || version !== revision) return;
    trackEntries(merged);
    const snapshot = ({ house, collections, charter }: HouseState) => ({
      house,
      collections,
      charter,
    });
    snapshotDirty =
      !remote ||
      JSON.stringify(snapshot(merged)) !== JSON.stringify(snapshot(remote));
    if (snapshotDirty || unacknowledged.size > 0) schedule();
  };
  const refresh = () => enqueue(pull);
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<HouseChangedDetail>).detail;
    if (detail?.remote !== false) return;
    revision++;
    latestLocalState = detail.state;
    trackEntries(detail.state);
    snapshotDirty = true;
    schedule();
  };
  window.addEventListener(HOUSE_CHANGED_EVENT, changed);
  window.addEventListener("twyne:remote-sync", refresh);
  window.addEventListener("online", refresh);
  const unsubscribe = getClient()?.onUpdate(
    api.house.getHouse,
    {},
    refresh,
    () => {},
  );
  refresh();
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    cancelPush?.();
    window.removeEventListener(HOUSE_CHANGED_EVENT, changed);
    window.removeEventListener("twyne:remote-sync", refresh);
    window.removeEventListener("online", refresh);
  };
}
