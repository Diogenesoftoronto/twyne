/**
 * Words written, by local day and hour — the history the pace and finish
 * forecasts read.
 *
 * The flow profile already knows *minutes* per hour; forecasts need *words*,
 * and per draft, so this is its own small ledger. Only counts, never text,
 * and on this device only (one meta record, capped at `MAX_DAYS`).
 *
 * Words are net: a cut is negative. A single observation that moves the
 * count by more than `MAX_STEP` is treated as a load, paste or folio switch
 * and re-baselines instead of counting as writing.
 */
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

export const PACE_LEDGER_KEY = "writing-pace:v1";
const MAX_DAYS = 60;
const MAX_STEP = 1_500;

export interface PaceDay {
  /** Net words written in each local hour. */
  hours: number[];
  /** Each draft's word count at its first and latest observation that day. */
  folios: Record<string, { start: number; end: number }>;
}

export interface PaceLedger {
  version: 1;
  /** Keyed by local calendar day, `YYYY-MM-DD`. */
  days: Record<string, PaceDay>;
  /** Latest count seen per draft, carried across days. */
  last: Record<string, number>;
}

export function emptyLedger(): PaceLedger {
  return { version: 1, days: {}, last: {} };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day for a timestamp. */
export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midday on a local day key, so DST never pushes it into a neighbour. */
export function dayToTime(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

export function addDays(day: string, n: number): string {
  const d = new Date(dayToTime(day));
  d.setDate(d.getDate() + n);
  return localDay(d.getTime());
}

export function normalizeLedger(value: unknown): PaceLedger {
  if (!value || typeof value !== "object") return emptyLedger();
  const raw = value as Partial<PaceLedger>;
  const days: Record<string, PaceDay> = {};
  for (const [key, day] of Object.entries(raw.days ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day) continue;
    const hours = Array.isArray(day.hours) ? day.hours : [];
    days[key] = {
      hours: Array.from({ length: 24 }, (_, h) =>
        Number.isFinite(hours[h]) ? hours[h] : 0,
      ),
      folios: day.folios && typeof day.folios === "object" ? day.folios : {},
    };
  }
  return {
    version: 1,
    days,
    last: raw.last && typeof raw.last === "object" ? raw.last : {},
  };
}

/** Fold one word-count observation of a draft into the ledger. */
export function observeWordCount(
  ledger: PaceLedger,
  folioId: string,
  wordCount: number,
  at: number,
): PaceLedger {
  if (!folioId || !Number.isFinite(wordCount) || wordCount < 0) return ledger;
  const key = localDay(at);
  const previous = ledger.last[folioId];
  const day: PaceDay = ledger.days[key]
    ? {
        hours: [...ledger.days[key].hours],
        folios: { ...ledger.days[key].folios },
      }
    : { hours: Array.from({ length: 24 }, () => 0), folios: {} };
  const jump = previous === undefined ? 0 : wordCount - previous;
  const delta = Math.abs(jump) > MAX_STEP ? 0 : jump;
  const folio = day.folios[folioId];
  // The day starts from where the draft stood, minus anything just counted;
  // a rejected jump moves the start with it, so it never reads as writing.
  day.folios[folioId] = {
    start: (folio?.start ?? wordCount - delta) + (folio ? jump - delta : 0),
    end: wordCount,
  };
  if (delta !== 0) day.hours[new Date(at).getHours()] += delta;

  const days = { ...ledger.days, [key]: day };
  const keys = Object.keys(days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DAYS)))
    delete days[old];
  return { version: 1, days, last: { ...ledger.last, [folioId]: wordCount } };
}

/** Net words across every draft on a day. */
export function dayTotal(day: PaceDay | undefined): number {
  return day ? day.hours.reduce((sum, n) => sum + n, 0) : 0;
}

/**
 * One draft's net words per calendar day, oldest first, ending today.
 * Days with no record count as zero — rest days are part of the pace.
 */
export function folioDailyGains(
  ledger: PaceLedger,
  folioId: string,
  today: string,
  span: number,
): { gains: number[]; observedDays: number } {
  const seen = Object.keys(ledger.days)
    .filter((key) => ledger.days[key].folios[folioId])
    .sort();
  if (!seen.length) return { gains: [], observedDays: 0 };
  const first = seen[0];
  const gains: number[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    if (key < first) continue;
    const f = ledger.days[key]?.folios[folioId];
    gains.push(f ? f.end - f.start : 0);
  }
  return { gains, observedDays: gains.length };
}

let queue: Promise<unknown> = Promise.resolve();

export async function loadPaceLedger(): Promise<PaceLedger> {
  return normalizeLedger(await loadMetaFromIdb(PACE_LEDGER_KEY));
}

/** Serialised so two quick saves cannot read the same stale ledger. */
export function recordWordCount(
  folioId: string,
  wordCount: number,
  at = Date.now(),
): Promise<PaceLedger> {
  const next = queue.then(async () => {
    const ledger = observeWordCount(
      await loadPaceLedger(),
      folioId,
      wordCount,
      at,
    );
    await saveMetaToIdb(PACE_LEDGER_KEY, ledger);
    return ledger;
  });
  queue = next.catch(() => undefined);
  return next;
}
