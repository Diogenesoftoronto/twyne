/**
 * Hosted credit runway: this month's projected spend and, if it comes to
 * that, the day the wallet runs dry.
 *
 * Three inputs, each from where it is most trustworthy: the balance from
 * the Not Organic wallet, this month's charges from the gateway's billing
 * feed, and the day-by-day shape from this device's usage ledger (the feed
 * only returns totals). The desk always recomputes; the editor reads the
 * day's stored result, with bounded retries when it could not get a model
 * forecast or the account services were unavailable.
 */
import type { ConvexClient } from "convex/browser";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import {
  getNotOrganicHostedUsage,
  getNotOrganicWallet,
} from "./notorganic-provider";
import { usageLedger } from "./usage-ledger";
import type { UsageEvent } from "./usage-domain";
import { FORECAST_MAX_ATTEMPTS, FORECAST_RETRY_DELAYS_MS } from "./forecast-cache";
import {
  clientAsk,
  creditForecast,
  dailyHostedSpend,
  type CreditForecast,
} from "./writing-forecasts";
import { addDays, dayToTime, localDay } from "./writing-pace-ledger";

export const CREDIT_RUNWAY_KEY = "credit-runway:v2";

interface StoredRunway {
  day: string;
  accountId: string;
  forecast: CreditForecast | null;
  checkedAt: number;
  attempts: number;
}

interface RunwayStore {
  load(key: string): Promise<StoredRunway | null | undefined>;
  save(key: string, value: StoredRunway): Promise<void>;
}

interface RunwayOptions {
  store?: RunwayStore;
  calculate?: typeof calculateCreditRunway;
  /** Caller invalidates work when its authenticated account changes. */
  isCurrent?: () => boolean;
}

const runwayStore: RunwayStore = {
  load: (key) => loadMetaFromIdb<StoredRunway>(key),
  save: saveMetaToIdb,
};
type PendingRunway = { day: string; task: Promise<CreditForecast | null> };
const inflight = new WeakMap<RunwayStore, Map<string, PendingRunway>>();

function availableMicros(wallet: unknown): number | null {
  const w = wallet as { availableMicros?: unknown; hostedInferenceBlocked?: unknown } | null;
  if (!w || !Number.isSafeInteger(w.availableMicros)) return null;
  return w.hostedInferenceBlocked === true ? 0 : Math.max(0, w.availableMicros as number);
}

async function localEvents(from: number, to: number): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await usageLedger.listUsageEvents({ from, to, cursor, limit: 500 });
    events.push(...page.events);
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < 20);
  return events;
}

async function calculateCreditRunway(
  client: ConvexClient,
  accountId: string,
  now = Date.now(),
  isCurrent = () => true,
): Promise<CreditForecast | null> {
  if (!isCurrent()) return null;
  const today = localDay(now);
  const monthStart = new Date(dayToTime(today));
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const historyFrom = new Date(dayToTime(addDays(today, -28)));
  historyFrom.setHours(0, 0, 0, 0);
  const [wallet, month, events] = await Promise.all([
    getNotOrganicWallet(client),
    getNotOrganicHostedUsage(client, { from: monthStart.getTime(), to: now }),
    localEvents(Math.min(historyFrom.getTime(), monthStart.getTime()), now),
  ]);
  if (!isCurrent()) return null;
  const available = availableMicros(wallet);
  if (available === null) return null;
  const local = events.filter(
    (e) => e.source === "hosted" && e.occurredAt >= monthStart.getTime(),
  );
  const localMonth = local.reduce((sum, e) => sum + (e.costMicrousd ?? 0), 0);
  // The billing feed is capped at 100 requests; never project from less
  // than this device already knows was spent.
  const spent = Math.max(month.billedMicrousd, month.truncated ? localMonth : 0);
  const ask = clientAsk(client, accountId);
  return creditForecast({
    history: dailyHostedSpend(events, today),
    spentMicros: spent,
    availableMicros: available,
    now,
    scope: accountId,
    options: {
      ask: ask ? (request) => isCurrent() ? ask(request) : Promise.resolve({ ok: false }) : undefined,
      accountId,
    },
  });
}

/** Refresh the desk's runway on demand, reusing a request already in flight. */
export function computeCreditRunway(
  client: ConvexClient,
  accountId: string,
  now = Date.now(),
  options: RunwayOptions = {},
): Promise<CreditForecast | null> {
  return cachedCreditRunway(client, accountId, now, options, true);
}

/** Today's stored runway, recovering from failures without an unbounded loop. */
export function dailyCreditRunway(
  client: ConvexClient,
  accountId: string,
  now = Date.now(),
  options: RunwayOptions = {},
): Promise<CreditForecast | null> {
  return cachedCreditRunway(client, accountId, now, options, false);
}

function cachedCreditRunway(
  client: ConvexClient,
  accountId: string,
  now: number,
  options: RunwayOptions,
  force: boolean,
): Promise<CreditForecast | null> {
  if (!accountId) return Promise.resolve(null);
  const store = options.store ?? runwayStore;
  const key = `${CREDIT_RUNWAY_KEY}:${encodeURIComponent(accountId)}`;
  const day = localDay(now);
  const tasks = inflight.get(store) ?? new Map<string, PendingRunway>();
  inflight.set(store, tasks);
  const running = tasks.get(key);
  if (running) return running.day === day
    ? running.task
    : running.task.then(() => cachedCreditRunway(client, accountId, now, options, force));
  const task = (async () => {
    const loaded = await store.load(key);
    if (options.isCurrent?.() === false) return null;
    const stored = loaded?.day === day && loaded.accountId === accountId ? loaded : null;
    const delay = FORECAST_RETRY_DELAYS_MS[Math.min(Math.max((stored?.attempts ?? 1) - 1, 0), FORECAST_RETRY_DELAYS_MS.length - 1)];
    if (!force && stored && (
      stored.forecast?.source === "clairic" ||
      stored.attempts >= FORECAST_MAX_ATTEMPTS ||
      now < stored.checkedAt + delay
    )) return stored.forecast;
    const claim: StoredRunway = {
      day, accountId, checkedAt: now,
      attempts: (stored?.attempts ?? 0) + 1,
      forecast: stored?.forecast ?? null,
    };
    // Persist the attempt before any network work, including interrupted calls.
    await store.save(key, claim);
    let forecast = claim.forecast;
    try {
      forecast = await (options.calculate ?? calculateCreditRunway)(client, accountId, now, options.isCurrent);
    } catch {
      // Keep today's baseline, if any, until a bounded retry can recover.
    }
    if (options.isCurrent?.() === false) return null;
    await store.save(key, { ...claim, forecast });
    return forecast;
  })();
  tasks.set(key, { day, task });
  void task.finally(() => tasks.delete(key)).catch(() => undefined);
  return task;
}
