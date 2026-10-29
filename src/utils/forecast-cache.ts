/**
 * At most one successful Clairic forecast per account, surface and local day.
 *
 * Each account/surface (pace, finish, credit) has one record holding the day it
 * last asked, what it asked about (`scope`: a folio, an account), and the
 * steps that came back. Failed calls retry with bounded backoff, up to three
 * attempts a day. Same day but a different scope → no call; the caller keeps
 * its baseline until tomorrow. Account keys keep responses and budgets apart.
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
  attempts: number;
  /** Next eligible attempt after a failed/interrupted call; absent on success. */
  retryAt?: number;
}

export interface ForecastCacheStore {
  load(key: string): Promise<unknown>;
  save(key: string, value: CachedForecast): Promise<void>;
}

const idbStore: ForecastCacheStore = {
  load: (key) => loadMetaFromIdb(key),
  save: (key, value) => saveMetaToIdb(key, value),
};

export const FORECAST_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000] as const;
export const FORECAST_MAX_ATTEMPTS = FORECAST_RETRY_DELAYS_MS.length + 1;

export const forecastCacheKey = (surface: ForecastSurface, accountId: string) =>
  `clairic-forecast:v2:${surface}:${encodeURIComponent(accountId)}`;

function validSteps(value: unknown): value is Interval[] {
  return Array.isArray(value) && value.every((s) =>
    s && typeof s === "object" &&
    Number.isFinite(s.median) && Number.isFinite(s.p10) && Number.isFinite(s.p90) &&
    s.p10 <= s.median && s.median <= s.p90,
  );
}

function readCached(value: unknown): CachedForecast | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CachedForecast>;
  if (typeof v.day !== "string" || typeof v.scope !== "string") return null;
  return {
    day: v.day,
    scope: v.scope,
    askedAt: typeof v.askedAt === "number" ? v.askedAt : 0,
    steps: validSteps(v.steps) ? v.steps : [],
    attempts: Number.isInteger(v.attempts) && v.attempts! > 0 ? v.attempts! : 1,
    ...(typeof v.retryAt === "number" && Number.isFinite(v.retryAt)
      ? { retryAt: v.retryAt }
      : {}),
  };
}

const inflight = new WeakMap<ForecastCacheStore, Map<string, Promise<CachedForecast | null>>>();

/**
 * Today's forecast for `scope`, with a capped recovery path for failed calls.
 * Returns null when today's budget was claimed by another scope.
 */
export function dailyForecast(input: {
  surface: ForecastSurface;
  accountId: string;
  scope: string;
  day: string;
  ask: () => Promise<Interval[]>;
  now?: number;
  store?: ForecastCacheStore;
}): Promise<CachedForecast | null> {
  const store = input.store ?? idbStore;
  if (!input.accountId) return Promise.resolve(null);
  const key = forecastCacheKey(input.surface, input.accountId);
  let tasks = inflight.get(store);
  if (!tasks) {
    tasks = new Map();
    inflight.set(store, tasks);
  }
  const running = tasks.get(key);
  if (running) return running.then((c) => {
    if (c?.day !== input.day) return dailyForecast(input);
    return c.scope === input.scope ? c : null;
  });
  const task = (async () => {
    const cached = readCached(await store.load(key));
    const now = input.now ?? Date.now();
    const today = cached?.day === input.day ? cached : null;
    if (today) {
      if (today.scope !== input.scope) return null;
      if (today.steps.length || today.attempts >= FORECAST_MAX_ATTEMPTS ||
          now < (today.retryAt ?? today.askedAt + FORECAST_RETRY_DELAYS_MS[0]))
        return today;
    }
    const attempts = (today?.attempts ?? 0) + 1;
    // Claim the attempt before asking, so a crash mid-call still counts.
    const claim: CachedForecast = {
      day: input.day,
      scope: input.scope,
      askedAt: now,
      steps: [],
      attempts,
      retryAt: now + FORECAST_RETRY_DELAYS_MS[Math.min(attempts - 1, FORECAST_RETRY_DELAYS_MS.length - 1)],
    };
    await store.save(key, claim);
    let steps: Interval[] = [];
    try {
      const answer = await input.ask();
      steps = validSteps(answer) ? answer : [];
    } catch {
      steps = [];
    }
    const done = { ...claim, steps, ...(steps.length ? { retryAt: undefined } : {}) };
    await store.save(key, done);
    return done;
  })();
  tasks.set(key, task);
  void task.finally(() => tasks.delete(key)).catch(() => undefined);
  return task;
}

/** Read today's record without asking. */
export async function peekForecast(
  surface: ForecastSurface,
  accountId: string,
  day: string,
  store: ForecastCacheStore = idbStore,
): Promise<CachedForecast | null> {
  const cached = readCached(await store.load(forecastCacheKey(surface, accountId)));
  return cached?.day === day ? cached : null;
}
