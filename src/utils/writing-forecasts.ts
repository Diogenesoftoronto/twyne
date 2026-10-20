/**
 * The three forecasts the writer sees — today's pace, when the draft is
 * done, and how long hosted credit lasts — each a baseline from
 * `forecast-baselines`, optionally replaced by one Clairic forecast a day.
 *
 * Nothing here renders. Callers get a median and an 80% interval, or null
 * when there is nothing honest to say yet.
 */
import type { ConvexClient } from "convex/browser";
import type { ProjectBrief } from "../types";
import {
  forecast,
  forecastSteps,
  type ExtractionRequest,
  type ExtractionResult,
  type Interval,
} from "./extraction";
import { askExtraction } from "./extraction-client";
import {
  daysToReach,
  paceBaseline,
  periodTotalBaseline,
  preferForecast,
  stepsToReach,
  sumSteps,
  type DailyAmount,
  type PaceHistoryDay,
} from "./forecast-baselines";
import { dailyForecast, type ForecastCacheStore } from "./forecast-cache";
import {
  addDays,
  dayToTime,
  dayTotal,
  folioDailyGains,
  localDay,
  type PaceLedger,
} from "./writing-pace-ledger";

/** Days of history before Clairic is asked at all. */
export const MODEL_MIN_DAYS = 14;
/** Below this many words today, a pace line is noise. */
export const PACE_MIN_WORDS_TODAY = 50;
const HISTORY_DAYS = 28;
const FINISH_HORIZON_DAYS = 60;
const CREDIT_HORIZON_DAYS = 45;

export type ForecastSource = "baseline" | "clairic";

/** Development only: inject `{ pace, finish, credit, hosted }` for browser checks. */
export const FORECAST_PREVIEW_EVENT = "twyne:forecast-preview";

type Ask = (request: ExtractionRequest) => Promise<ExtractionResult>;

interface ModelOptions {
  /** Absent → baseline only. */
  ask?: Ask;
  store?: ForecastCacheStore;
}

export function clientAsk(client: ConvexClient | null | undefined): Ask | undefined {
  return client ? (request) => askExtraction(client, request) : undefined;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayOf = (day: string) => new Date(dayToTime(day)).getDay();

async function stepsFrom(
  ask: Ask,
  request: ExtractionRequest,
): Promise<Interval[]> {
  const result = await ask(request);
  return result.ok ? forecastSteps(result.answers?.next) : [];
}

/* ── Today's pace ─────────────────────────────────────────────── */

export interface PaceForecast extends Interval {
  wordsSoFar: number;
  source: ForecastSource;
}

export function paceHistory(ledger: PaceLedger, today: string): PaceHistoryDay[] {
  const out: PaceHistoryDay[] = [];
  for (let i = HISTORY_DAYS; i >= 1; i--) {
    const key = addDays(today, -i);
    const day = ledger.days[key];
    if (day) out.push({ weekday: weekdayOf(key), hours: day.hours });
  }
  return out;
}

export async function paceForecast(
  ledger: PaceLedger,
  now: number,
  options: ModelOptions = {},
): Promise<PaceForecast | null> {
  const today = localDay(now);
  const wordsSoFar = Math.max(0, dayTotal(ledger.days[today]));
  if (wordsSoFar < PACE_MIN_WORDS_TODAY) return null;
  const date = new Date(now);
  const hourNow = date.getHours() + date.getMinutes() / 60;
  const history = paceHistory(ledger, today);
  const baseline = paceBaseline({
    history,
    weekday: date.getDay(),
    hourNow,
    wordsSoFar,
  });
  if (!baseline) return null;

  const writingDays = history.filter((d) => d.hours.some((n) => n > 0)).length;
  const enough = writingDays >= MODEL_MIN_DAYS;
  let model: Interval | null = null;
  if (enough && options.ask) {
    const ask = options.ask;
    const startHour = date.getHours();
    const cached = await dailyForecast({
      surface: "pace",
      scope: "all",
      day: today,
      now,
      store: options.store,
      ask: () =>
        stepsFrom(ask, {
          state: paceState(ledger, today, startHour),
          reference_date: today,
          fields: {
            next: forecast(
              "Net words this writer will write in each remaining hour of today, from their hourly history.",
              { min: 0, max: 3_000, horizon: 24 - startHour, interval: "hour" },
            ),
          },
        }),
    });
    if (cached?.steps.length) {
      // The steps begin at the hour of the day's one call; drop the past.
      const askedHour = new Date(cached.askedAt).getHours();
      const offset = date.getHours() - askedHour;
      const ahead = cached.steps.slice(Math.max(0, offset));
      if (ahead.length) {
        const left = 1 - date.getMinutes() / 60;
        const rest = sumSteps([
          { ...scale(ahead[0], left) },
          ...ahead.slice(1),
        ]);
        model = {
          median: wordsSoFar + rest.median,
          p10: wordsSoFar + rest.p10,
          p90: wordsSoFar + rest.p90,
        };
      }
    }
  }
  const chosen = preferForecast(baseline, model, enough)!;
  return { ...chosen.value, wordsSoFar, source: chosen.source };
}

const scale = (s: Interval, k: number): Interval => ({
  median: s.median * k,
  p10: s.p10 * k,
  p90: s.p90 * k,
});

function paceState(ledger: PaceLedger, today: string, hour: number): string {
  const lines = ["Net words written per local hour (00–23), recent days:"];
  for (let i = HISTORY_DAYS; i >= 1; i--) {
    const key = addDays(today, -i);
    const day = ledger.days[key];
    if (!day) continue;
    lines.push(`${key} ${WEEKDAYS[weekdayOf(key)]}: ${day.hours.map(Math.round).join(",")}`);
  }
  const todays = ledger.days[today]?.hours.slice(0, hour) ?? [];
  lines.push(
    `Today ${today} ${WEEKDAYS[weekdayOf(today)]}, hours 00–${String(hour - 1).padStart(2, "0")}: ${todays.map(Math.round).join(",")}`,
    `Forecast hours ${String(hour).padStart(2, "0")}–23.`,
  );
  return lines.join("\n");
}

/* ── Draft finish ─────────────────────────────────────────────── */

/**
 * The writer's stated length, if the brief states one in words. Pages and
 * "a chapter" are left alone: turning those into a word count would be
 * inventing a target. A range resolves to its lower end — the draft is
 * long enough once it is inside the range.
 */
export function briefWordTarget(brief: ProjectBrief | null | undefined): number | null {
  if (!brief) return null;
  const text = [
    brief.answers.format,
    brief.answers.constraints,
    ...(brief.probes ?? [])
      .filter((p) => p.relatesTo === "format" || p.relatesTo === "constraints")
      .map((p) => (Array.isArray(p.answer) ? p.answer.join(" ") : String(p.answer ?? ""))),
  ].join(" \n ");
  const number = String.raw`(\d{1,3}(?:[,  ]\d{3})+|\d+(?:\.\d+)?)\s*(k)?`;
  const match = new RegExp(
    String.raw`(?:${number})\s*(?:(?:-|–|—|to)\s*(?:${number})\s*)?(?:words?|wds)\b`,
    "i",
  ).exec(text);
  if (!match) return null;
  const value = (raw: string, k?: string) =>
    Number(raw.replace(/[,  ]/g, "")) * (k ? 1_000 : 1);
  // "3–5k words": the k on the upper end applies to a bare lower one.
  const sharedK = !match[2] && match[4] && Number(match[1]) < 1_000;
  const low = value(match[1], match[2] ?? (sharedK ? "k" : undefined));
  if (!Number.isFinite(low) || low < 100 || low > 500_000) return null;
  return Math.round(low);
}

export interface FinishForecast {
  target: number;
  current: number;
  /** Local day keys. */
  median: string;
  early: string;
  late: string;
  source: ForecastSource;
}

export async function finishForecast(input: {
  ledger: PaceLedger;
  folioId: string;
  currentWords: number;
  target: number | null;
  now: number;
  options?: ModelOptions;
}): Promise<FinishForecast | null> {
  const { target, currentWords } = input;
  if (!target || currentWords >= target) return null;
  const today = localDay(input.now);
  const { gains, observedDays } = folioDailyGains(
    input.ledger,
    input.folioId,
    today,
    HISTORY_DAYS,
  );
  // Today is still being written; judge the pace on finished days.
  const finished = gains.slice(0, -1);
  const remaining = target - currentWords;
  const baseline = daysToReach(finished, remaining);
  if (!baseline || baseline.median > 366) return null;

  const enough = observedDays - 1 >= MODEL_MIN_DAYS;
  let model: Interval | null = null;
  const ask = input.options?.ask;
  if (enough && ask) {
    const cached = await dailyForecast({
      surface: "finish",
      scope: input.folioId,
      day: today,
      now: input.now,
      store: input.options?.store,
      ask: () =>
        stepsFrom(ask, {
          state: [
            "Net words added to one draft per day, oldest first:",
            ...finished.map(
              (n, i) =>
                `${addDays(today, i - finished.length)} ${WEEKDAYS[weekdayOf(addDays(today, i - finished.length))]}: ${Math.round(n)}`,
            ),
            `Draft is ${currentWords} words; target ${target}.`,
          ].join("\n"),
          reference_date: today,
          fields: {
            next: forecast(
              "Net words this writer will add to the draft on each coming day, starting today.",
              { min: 0, max: 10_000, horizon: FINISH_HORIZON_DAYS, interval: "day" },
            ),
          },
        }),
    });
    // Step n covers day n-1 (today is step 1): convert to days from today.
    const crossing = cached?.steps.length
      ? stepsToReach(cached.steps, remaining)
      : null;
    if (crossing)
      model = {
        median: crossing.median - 1,
        p10: crossing.p10 - 1,
        p90: crossing.p90 - 1,
      };
  }
  const chosen = preferForecast(baseline, model, enough)!;
  const day = (n: number) => addDays(today, Math.max(0, Math.ceil(n)));
  return {
    target,
    current: currentWords,
    median: day(chosen.value.median),
    early: day(chosen.value.p10),
    late: day(chosen.value.p90),
    source: chosen.source,
  };
}

/* ── Hosted credit ─────────────────────────────────────────────── */

export interface HostedSpendDay {
  /** Local day key. */
  day: string;
  micros: number;
}

export interface CreditForecast {
  /** This month's projected total spend, micro-USD. */
  month: Interval;
  spentMicros: number;
  availableMicros: number;
  /** Local day keys when credit runs out, or null when it outlasts the horizon. */
  runsOut: { median: string; early: string; late: string } | null;
  /** True when even the slow edge lands before month end. */
  outlastsMonth: boolean;
  monthEnd: string;
  source: ForecastSource;
}

/** Group hosted ledger charges into local days, filling gaps with zero. */
export function dailyHostedSpend(
  events: readonly { occurredAt: number; source: string; costMicrousd?: number }[],
  today: string,
  span = HISTORY_DAYS,
): HostedSpendDay[] {
  const totals = new Map<string, number>();
  for (const e of events) {
    if (e.source !== "hosted" || !e.costMicrousd) continue;
    const key = localDay(e.occurredAt);
    totals.set(key, (totals.get(key) ?? 0) + e.costMicrousd);
  }
  const first = [...totals.keys()].sort()[0];
  if (!first) return [];
  const out: HostedSpendDay[] = [];
  for (let i = span; i >= 1; i--) {
    const key = addDays(today, -i);
    if (key >= first) out.push({ day: key, micros: totals.get(key) ?? 0 });
  }
  return out;
}

export function monthEndDay(today: string): string {
  const d = new Date(dayToTime(today));
  return localDay(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getTime());
}

export async function creditForecast(input: {
  history: readonly HostedSpendDay[];
  spentMicros: number;
  availableMicros: number;
  now: number;
  scope: string;
  options?: ModelOptions;
}): Promise<CreditForecast | null> {
  const today = localDay(input.now);
  const monthEnd = monthEndDay(today);
  const upcoming: number[] = [];
  for (let d = addDays(today, 1); d <= monthEnd; d = addDays(d, 1))
    upcoming.push(weekdayOf(d));
  const daily: DailyAmount[] = input.history.map((h) => ({
    weekday: weekdayOf(h.day),
    amount: h.micros,
  }));
  const monthBase = periodTotalBaseline({
    history: daily,
    spentSoFar: input.spentMicros,
    upcoming,
  });
  if (!monthBase) return null;
  const runBase = daysToReach(
    daily.map((d) => d.amount),
    input.availableMicros,
  );

  const spendDays = input.history.filter((h) => h.micros > 0).length;
  const enough = spendDays >= MODEL_MIN_DAYS;
  let monthModel: Interval | null = null;
  let runModel: Interval | null = null;
  const ask = input.options?.ask;
  if (enough && ask) {
    const cached = await dailyForecast({
      surface: "credit",
      scope: input.scope,
      day: today,
      now: input.now,
      store: input.options?.store,
      ask: () =>
        stepsFrom(ask, {
          state: [
            "Hosted AI spend per day in US dollars, oldest first:",
            ...input.history.map(
              (h) => `${h.day} ${WEEKDAYS[weekdayOf(h.day)]}: ${(h.micros / 1e6).toFixed(4)}`,
            ),
          ].join("\n"),
          reference_date: today,
          fields: {
            next: forecast(
              "Hosted AI spend in US dollars on each coming day, starting tomorrow.",
              { min: 0, max: 20, horizon: CREDIT_HORIZON_DAYS, interval: "day" },
            ),
          },
        }),
    });
    const steps = (cached?.steps ?? []).map((s) => scale(s, 1e6));
    if (steps.length) {
      const inMonth = sumSteps(steps.slice(0, upcoming.length));
      monthModel = {
        median: input.spentMicros + inMonth.median,
        p10: input.spentMicros + inMonth.p10,
        p90: input.spentMicros + inMonth.p90,
      };
      runModel = stepsToReach(steps, input.availableMicros);
    }
  }
  const month = preferForecast(monthBase, monthModel, enough)!;
  const run = preferForecast(runBase, runModel, enough);
  const day = (n: number) => addDays(today, Math.max(0, Math.ceil(n)));
  const runsOut =
    run && run.value.median <= CREDIT_HORIZON_DAYS
      ? {
          median: day(run.value.median),
          early: day(run.value.p10),
          late: day(run.value.p90),
        }
      : null;
  return {
    month: month.value,
    spentMicros: input.spentMicros,
    availableMicros: input.availableMicros,
    runsOut,
    outlastsMonth: !runsOut || runsOut.early > monthEnd,
    monthEnd,
    source: month.source,
  };
}

/** Credit worth a quiet line in the editor: the median runs out within a week. */
export function creditNeedsNotice(f: CreditForecast | null, now: number): boolean {
  if (!f?.runsOut) return false;
  return f.runsOut.median <= addDays(localDay(now), 7);
}

/* ── Formatting ─────────────────────────────────────────────────── */

const roundWords = (n: number) =>
  n >= 1_000 ? Math.round(n / 50) * 50 : n >= 200 ? Math.round(n / 10) * 10 : Math.round(n);

export function formatWords(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(roundWords(Math.max(0, n)));
}

export function formatWordRange(i: Interval, locale?: string): string {
  const lo = formatWords(i.p10, locale);
  const hi = formatWords(i.p90, locale);
  return lo === hi ? lo : `${lo}–${hi}`;
}

export function formatDay(day: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
    new Date(dayToTime(day)),
  );
}

/** "Nov 8 – 25" in one month, "Oct 29 – Nov 4" across two. */
export function formatDayRange(early: string, late: string, locale?: string): string {
  if (early === late) return formatDay(early, locale);
  const a = new Date(dayToTime(early));
  const b = new Date(dayToTime(late));
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const end = sameMonth
    ? new Intl.DateTimeFormat(locale, { day: "numeric" }).format(b)
    : formatDay(late, locale);
  return `${formatDay(early, locale)} – ${end}`;
}

export function formatUsd(micros: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(micros / 1e6);
}
