import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { HouseState } from "./house-model";
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

export function startHouseSync(
  getClient: () => ConvexClient | null,
): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let revision = 0;
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    pending = pending
      .then(async () => {
        if (!stopped) await work();
      })
      .catch(() => {
        // Keep dirty state for the next online/client-ready notification.
      });
  };
  const push = async () => {
    const client = getClient();
    if (!client || !dirty || stopped) return;
    const version = revision;
    const state = await loadHouseState();
    for (
      let offset = 0;
      offset < Math.max(1, state.ledger.length);
      offset += 200
    ) {
      if (stopped || getClient() !== client) return;
      await client.mutation(api.house.putHouseSnapshot, {
        ...state,
        ledger: state.ledger.slice(offset, offset + 200),
      });
    }
    if (revision === version) dirty = false;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => enqueue(push), 2000);
  };
  const pull = async () => {
    const client = getClient();
    if (!client) return;
    const remote = await client.query(api.house.getHouse, {});
    if (stopped || getClient() !== client) return;
    const version = revision;
    const local = await loadHouseState();
    if (stopped || version !== revision) return;
    const merged = remote ? mergeHouseStates(local, remote) : local;
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      await replaceHouseState(merged, { remote: true });
    }
    if (!remote || JSON.stringify(merged) !== JSON.stringify(remote))
      dirty = true;
    if (dirty) schedule();
  };
  const refresh = () => enqueue(pull);
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<HouseChangedDetail>).detail;
    if (detail?.remote !== false) return;
    revision++;
    dirty = true;
    schedule();
  };
  window.addEventListener(HOUSE_CHANGED_EVENT, changed);
  window.addEventListener("twyne:remote-sync", refresh);
  window.addEventListener("online", refresh);
  // Stay live while the House is open; client auth recovery also resubscribes.
  const unsubscribe = getClient()?.onUpdate(
    api.house.getHouse,
    {},
    refresh,
    () => {},
  );
  refresh();
  return () => {
    stopped = true;
    unsubscribe?.();
    clearTimeout(timer);
    window.removeEventListener(HOUSE_CHANGED_EVENT, changed);
    window.removeEventListener("twyne:remote-sync", refresh);
    window.removeEventListener("online", refresh);
  };
}
