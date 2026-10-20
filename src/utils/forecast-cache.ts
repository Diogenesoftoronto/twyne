/**
 * At most one Clairic forecast per surface per local day.
 *
 * Each surface (pace, finish, credit) has one meta record holding the day it
 * last asked, what it asked about (`scope`: a folio, an account), and the
 * steps that came back. Same day → the stored answer, even a failed one, so
 * a gateway outage cannot turn into a retry loop. Same day but a different
 * scope → no call; the caller keeps its baseline until tomorrow.
 */
import type { Interval } from "./extraction";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

export type ForecastSurface = "pace" | "finish" | "credit";

export interface CachedForecast {
  day: string;
  scope: string;
  askedAt: number;
  /** Empty when the call failed or returned nothing usable. */
  steps: Interval[];
}

export interface ForecastCacheStore {
  load(key: string): Promise<unknown>;
  save(key: string, value: CachedForecast): Promise<void>;
}

const idbStore: ForecastCacheStore = {
  load: (key) => loadMetaFromIdb(key),
  save: (key, value) => saveMetaToIdb(key, value),
};

export const forecastCacheKey = (surface: ForecastSurface) =>
  `clairic-forecast:${surface}`;

function readCached(value: unknown): CachedForecast | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CachedForecast>;
  if (typeof v.day !== "string" || typeof v.scope !== "string") return null;
  return {
    day: v.day,
    scope: v.scope,
    askedAt: typeof v.askedAt === "number" ? v.askedAt : 0,
    steps: Array.isArray(v.steps) ? v.steps : [],
  };
}

const inflight = new Map<string, Promise<CachedForecast | null>>();

/**
 * Today's forecast for `scope`, asking `ask` only if this surface has not
 * asked yet today. Returns null when today's one call went to another scope.
 */
export function dailyForecast(input: {
  surface: ForecastSurface;
  scope: string;
  day: string;
  ask: () => Promise<Interval[]>;
  now?: number;
  store?: ForecastCacheStore;
}): Promise<CachedForecast | null> {
  const store = input.store ?? idbStore;
  const key = forecastCacheKey(input.surface);
  const running = inflight.get(key);
  if (running) return running.then((c) => (c?.scope === input.scope ? c : null));
  const task = (async () => {
    const cached = readCached(await store.load(key));
    if (cached?.day === input.day)
      return cached.scope === input.scope ? cached : null;
    // Claim the day before asking, so a crash mid-call still counts as asked.
    const claim: CachedForecast = {
      day: input.day,
      scope: input.scope,
      askedAt: input.now ?? Date.now(),
      steps: [],
    };
    await store.save(key, claim);
    let steps: Interval[] = [];
    try {
      steps = await input.ask();
    } catch {
      steps = [];
    }
    const done = { ...claim, steps };
    await store.save(key, done);
    return done;
  })();
  inflight.set(key, task);
  void task.finally(() => inflight.delete(key)).catch(() => undefined);
  return task;
}

/** Read today's record without asking. */
export async function peekForecast(
  surface: ForecastSurface,
  day: string,
  store: ForecastCacheStore = idbStore,
): Promise<CachedForecast | null> {
  const cached = readCached(await store.load(forecastCacheKey(surface)));
  return cached?.day === day ? cached : null;
}
