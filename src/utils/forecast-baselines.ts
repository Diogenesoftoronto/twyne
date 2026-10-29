/**
 * The deterministic half of every forecast Twyne shows.
 *
 * Clairic's forecasts drift toward the average, and with a week of history
 * there is no average worth drifting toward. So each surface is computed here
 * first, from the writer's own numbers, and the model is only allowed to
 * replace it when there is enough history and it lands near this answer
 * (`preferForecast`). Ranges describe plausible scenarios; summing step
 * quantiles does not establish 80% coverage for a total or crossing date.
 */
import type { Interval } from "./extraction";

/** z for the 10th/90th percentile of a normal. */
const Z80 = 1.2816;

export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export function meanAndSd(values: readonly number[]): { mean: number; sd: number } {
  if (!values.length) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, sd: 0 };
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

/* ── Today's pace ─────────────────────────────────────────────── */

export interface PaceHistoryDay {
  /** 0 = Sunday, as `Date#getDay`. */
  weekday: number;
  /** Net words per local hour. */
  hours: number[];
}

export const PACE_MIN_DAYS = 3;

/**
 * Words the writer will finish today with, from what they usually add after
 * this point in the day.
 *
 * Conditioned on writing days only: the line only shows once today has
 * begun, so the question is "on days like this, how much more came?". Uses
 * the same weekday when there are three of them, every writing day
 * otherwise. The interval is the empirical spread of those days' remainders.
 */
export function paceBaseline(input: {
  history: readonly PaceHistoryDay[];
  weekday: number;
  /** Fractional local hour now, e.g. 14.5 at half past two. */
  hourNow: number;
  wordsSoFar: number;
}): (Interval & { days: number }) | null {
  const writing = input.history.filter((d) =>
    d.hours.some((n) => n > 0),
  );
  if (writing.length < PACE_MIN_DAYS) return null;
  const sameDay = writing.filter((d) => d.weekday === input.weekday);
  const pool = sameDay.length >= PACE_MIN_DAYS ? sameDay : writing;
  const hour = Math.min(23, Math.max(0, Math.floor(input.hourNow)));
  const left = 1 - (input.hourNow - hour);
  const remainders = pool.map((d) => {
    let rest = Math.max(0, d.hours[hour] ?? 0) * left;
    for (let h = hour + 1; h < 24; h++) rest += Math.max(0, d.hours[h] ?? 0);
    return rest;
  });
  const base = Math.max(0, input.wordsSoFar);
  return {
    median: base + quantile(remainders, 0.5),
    p10: base + quantile(remainders, 0.1),
    p90: base + quantile(remainders, 0.9),
    days: pool.length,
  };
}

/* ── Reaching a total: draft length, or spending a balance ───────── */

/**
 * Days until a running sum of daily increments reaches `remaining`, as an
 * interval. Treats days as independent draws with the observed mean and
 * spread, so after `d` days the sum is ~N(d·m, d·s²); solving
 * d·m ± z·s·√d = remaining for √d gives the early and late crossings.
 * Null when the pace is not moving toward the total at all.
 */
export function daysToReach(
  dailyIncrements: readonly number[],
  remaining: number,
  minDays = PACE_MIN_DAYS,
): Interval | null {
  if (remaining <= 0) return { median: 0, p10: 0, p90: 0 };
  if (dailyIncrements.length < minDays) return null;
  const { mean, sd } = meanAndSd(dailyIncrements);
  if (mean <= 0) return null;
  const root = (sign: 1 | -1) => {
    const b = sign * Z80 * sd;
    const x = (-b + Math.sqrt(b * b + 4 * mean * remaining)) / (2 * mean);
    return x * x;
  };
  return {
    median: remaining / mean,
    p10: root(1),
    p90: root(-1),
  };
}

/* ── This month's hosted spend ─────────────────────────────────── */

export interface DailyAmount {
  weekday: number;
  amount: number;
}

/**
 * Total for a period given what is already spent and the days still to
 * come. Weekday-aware once each weekday has been seen three times (writers
 * often have a heavy day); a flat trailing mean before that. The interval
 * comes from the residuals of that model, widened by √days.
 */
export function periodTotalBaseline(input: {
  history: readonly DailyAmount[];
  spentSoFar: number;
  /** Weekdays of the days left in the period, today's remainder excluded. */
  upcoming: readonly number[];
}): Interval | null {
  if (input.history.length < PACE_MIN_DAYS) return null;
  const byWeekday = new Map<number, number[]>();
  for (const d of input.history)
    byWeekday.set(d.weekday, [...(byWeekday.get(d.weekday) ?? []), d.amount]);
  const weekdayAware = [...Array(7).keys()].every(
    (w) => (byWeekday.get(w)?.length ?? 0) >= 3,
  );
  const overall = meanAndSd(input.history.map((d) => d.amount)).mean;
  const expected = (weekday: number) =>
    weekdayAware ? meanAndSd(byWeekday.get(weekday)!).mean : overall;
  const residuals = input.history.map((d) => d.amount - expected(d.weekday));
  const sd = meanAndSd(residuals).sd;
  const ahead = input.upcoming.reduce((sum, w) => sum + expected(w), 0);
  const spread = Z80 * sd * Math.sqrt(input.upcoming.length);
  const median = input.spentSoFar + ahead;
  return {
    median,
    p10: Math.max(input.spentSoFar, median - spread),
    p90: median + spread,
  };
}

/* ── Model vs baseline ──────────────────────────────────────────── */

export interface ReachInterval {
  median: number;
  p10: number;
  /** Null when the slow scenario does not reach the target in the horizon. */
  p90: number | null;
}

/**
 * Take the model's interval only when history is long enough to trust it
 * and its median sits within the baseline's band widened by half its width
 * on each side (never less than 15% of the baseline median, so a perfectly
 * steady record does not shut the model out entirely). Otherwise the baseline stands: a model answer far from the
 * writer's own record is the drift-to-average failure, not insight.
 */
export function preferForecast<Model extends ReachInterval = Interval>(
  baseline: Interval | null,
  model: Model | null,
  enoughHistory: boolean,
): { value: Interval | Model; source: "baseline" | "clairic" } | null {
  if (!baseline) return null;
  if (!model || !enoughHistory) return { value: baseline, source: "baseline" };
  const half = Math.max(
    (baseline.p90 - baseline.p10) / 2,
    Math.abs(baseline.median) * 0.15,
    1e-9,
  );
  const ok =
    model.median >= baseline.p10 - half &&
    model.median <= baseline.p90 + half &&
    model.p10 <= model.median &&
    (model.p90 === null || model.median <= model.p90);
  return ok
    ? { value: model, source: "clairic" }
    : { value: baseline, source: "baseline" };
}

/**
 * Steps of a per-day (or per-hour) forecast, summed until they cover
 * `remaining`. Returns the 1-based step index where the median, the fast
 * edge (p90 increments) and the slow edge (p10 increments) cross, or null
 * when the median never crosses inside the horizon. A slow edge that never
 * crosses has a null upper bound, not an invented crossing date. These
 * scenario crossings are not quantiles of the total's crossing time.
 */
export function stepsToReach(
  steps: readonly Interval[],
  remaining: number,
): ReachInterval | null {
  if (remaining <= 0) return { median: 0, p10: 0, p90: 0 };
  const cross = (pick: (s: Interval) => number) => {
    let sum = 0;
    for (let i = 0; i < steps.length; i++) {
      sum += Math.max(0, pick(steps[i]));
      if (sum >= remaining) return i + 1;
    }
    return null;
  };
  const median = cross((s) => s.median);
  if (median === null) return null;
  return {
    median,
    p10: cross((s) => s.p90) ?? median,
    p90: cross((s) => s.p10),
  };
}

/** Sum corresponding step scenarios, not calibrated quantiles of the total. */
export function sumSteps(steps: readonly Interval[]): Interval {
  return steps.reduce(
    (acc, s) => ({
      median: acc.median + s.median,
      p10: acc.p10 + s.p10,
      p90: acc.p90 + s.p90,
    }),
    { median: 0, p10: 0, p90: 0 },
  );
}
