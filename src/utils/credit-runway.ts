/**
 * Hosted credit runway: this month's projected spend and, if it comes to
 * that, the day the wallet runs dry.
 *
 * Three inputs, each from where it is most trustworthy: the balance from
 * the Not Organic wallet, this month's charges from the gateway's billing
 * feed, and the day-by-day shape from this device's usage ledger (the feed
 * only returns totals). The desk always recomputes; the editor reads the
 * day's stored result and computes only when there is none.
 */
import type { ConvexClient } from "convex/browser";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import {
  getNotOrganicHostedUsage,
  getNotOrganicWallet,
} from "./notorganic-provider";
import { usageLedger } from "./usage-ledger";
import type { UsageEvent } from "./usage-domain";
import {
  clientAsk,
  creditForecast,
  dailyHostedSpend,
  type CreditForecast,
} from "./writing-forecasts";
import { addDays, dayToTime, localDay } from "./writing-pace-ledger";

export const CREDIT_RUNWAY_KEY = "credit-runway:v1";

interface StoredRunway {
  day: string;
  accountId: string;
  forecast: CreditForecast | null;
}

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

export async function computeCreditRunway(
  client: ConvexClient,
  accountId: string,
  now = Date.now(),
): Promise<CreditForecast | null> {
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
  const available = availableMicros(wallet);
  if (available === null) return null;
  const local = events.filter(
    (e) => e.source === "hosted" && e.occurredAt >= monthStart.getTime(),
  );
  const localMonth = local.reduce((sum, e) => sum + (e.costMicrousd ?? 0), 0);
  // The billing feed is capped at 100 requests; never project from less
  // than this device already knows was spent.
  const spent = Math.max(month.billedMicrousd, month.truncated ? localMonth : 0);
  const forecast = await creditForecast({
    history: dailyHostedSpend(events, today),
    spentMicros: spent,
    availableMicros: available,
    now,
    scope: accountId,
    options: { ask: clientAsk(client) },
  });
  const stored: StoredRunway = { day: today, accountId, forecast };
  await saveMetaToIdb(CREDIT_RUNWAY_KEY, stored);
  return forecast;
}

/** Today's stored runway for this account, computing it at most once a day. */
export async function dailyCreditRunway(
  client: ConvexClient,
  accountId: string,
  now = Date.now(),
): Promise<CreditForecast | null> {
  const stored = await loadMetaFromIdb<StoredRunway>(CREDIT_RUNWAY_KEY);
  if (stored?.day === localDay(now) && stored.accountId === accountId)
    return stored.forecast;
  try {
    return await computeCreditRunway(client, accountId, now);
  } catch {
    // No linked wallet, or the gateway is down: settle for silence today.
    const quiet: StoredRunway = { day: localDay(now), accountId, forecast: null };
    await saveMetaToIdb(CREDIT_RUNWAY_KEY, quiet);
    return null;
  }
}
