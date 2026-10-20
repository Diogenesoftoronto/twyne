/**
 * Clairic — typed values read out of text.
 *
 * Jev answers questions whose options we wrote down; Clairic reads values we
 * did not enumerate: spans of the state, numbers, dates, durations, lists, and
 * estimates or forecasts with an 80% interval (p10–p90). One parallel forward
 * pass, no generated text, so a `text` answer is always a substring of the
 * state it was given.
 *
 * Every scalar answer carries `p_null`, the probability the value is not in
 * the input. Past `null_threshold` (default 0.5) `value` is null, but `guess`
 * still holds the closest candidate — the near miss is data, not an error.
 *
 * Transport-free, like `system-one.ts`: `convex/extraction.ts` holds the
 * credentials and talks to Not Organic's `POST /v1/extraction`.
 */

export type ExtractionFieldType =
  | "text"
  | "number"
  | "date"
  | "time"
  | "datetime"
  | "duration"
  | "list"
  | "estimate"
  | "forecast";

export type DurationUnit =
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "years";

export type ForecastInterval =
  | "step"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

export interface ExtractionField {
  type: ExtractionFieldType;
  instructions?: string;
  unit?: string;
  integer?: boolean;
  decimals?: number;
  items?: "text" | "number" | "date";
  min?: number | string;
  max?: number | string;
  step?: number | "month" | "year";
  scale?: "linear" | "log";
  null_threshold?: number;
  horizon?: number;
  interval?: ForecastInterval;
}

export interface ExtractionRequest {
  state?: string;
  fields: Record<string, ExtractionField>;
  /** ISO date anchoring relative dates and dates written without a year. */
  reference_date?: string;
  options?: { include_quantiles?: boolean; return_state_text?: boolean };
}

export interface ExtractionAnswer {
  type: ExtractionFieldType;
  value: unknown;
  guess?: unknown;
  p_null?: number;
  confidence?: number;
  unit?: string;
  /** `text` answers: [start, end) into the state. */
  span?: [number, number];
  /** `list` answers: one span per item, in input order. */
  spans?: [number, number][];
  mean?: unknown;
  median?: unknown;
  p10?: unknown;
  p90?: unknown;
  p_below?: number;
  p_above?: number;
  quantiles?: unknown[];
  steps?: unknown[];
}

export interface ExtractionUsage {
  input_tokens: number;
  output_tokens: number;
  passes?: number;
}

export interface ExtractionResult {
  ok: boolean;
  model?: string;
  answers?: Record<string, ExtractionAnswer>;
  truncated?: boolean;
  usage?: ExtractionUsage;
  transport?: "notorganic" | "direct" | "none";
  error?: string;
  latencyMs?: number;
}

/** Input tokens only, at the published Workers AI rate. */
export const USD_PER_INPUT_TOKEN = 0.1 / 1_000_000;

/* ── Builders ──────────────────────────────────────────────────── */

export const text = (instructions?: string): ExtractionField => ({
  type: "text",
  ...(instructions ? { instructions } : {}),
});

export const list = (
  items: "text" | "number" | "date",
  instructions?: string,
): ExtractionField => ({
  type: "list",
  items,
  ...(instructions ? { instructions } : {}),
});

export function estimate(
  instructions: string,
  range: { min: number; max: number; unit?: string; step?: number; log?: boolean },
): ExtractionField {
  return {
    type: "estimate",
    instructions,
    min: range.min,
    max: range.max,
    ...(range.unit ? { unit: range.unit } : {}),
    ...(range.step ? { step: range.step } : {}),
    ...(range.log ? { scale: "log" as const } : {}),
  };
}

export function forecast(
  instructions: string,
  range: {
    min: number;
    max: number;
    horizon: number;
    interval: ForecastInterval;
    log?: boolean;
  },
): ExtractionField {
  return {
    type: "forecast",
    instructions,
    min: range.min,
    max: range.max,
    horizon: range.horizon,
    interval: range.interval,
    ...(range.log ? { scale: "log" as const } : {}),
  };
}

/* ── Reading answers ───────────────────────────────────────────── */

/** The exact substring a `text` answer points at, or null. */
export function spanText(
  state: string,
  answer: ExtractionAnswer | undefined,
): string | null {
  const span = answer?.span;
  if (!span || answer?.value === null) return null;
  return state.slice(span[0], span[1]);
}

/** Every substring a `list` answer points at, in input order. */
export function spanTexts(
  state: string,
  answer: ExtractionAnswer | undefined,
): string[] {
  return (answer?.spans ?? []).map(([s, e]) => state.slice(s, e));
}

/**
 * The closest candidate when the value is judged absent: `value` is null but
 * `guess` is not. For text answers the guess is still a span of the state.
 */
export function nearMiss(
  answer: ExtractionAnswer | undefined,
): { guess: unknown; pNull: number } | null {
  if (!answer || answer.value !== null || answer.guess == null) return null;
  return { guess: answer.guess, pNull: answer.p_null ?? 1 };
}

export interface Interval {
  median: number;
  p10: number;
  p90: number;
}

/** The numeric 80% interval of an estimate, or null for date estimates and gaps. */
export function interval(answer: ExtractionAnswer | undefined): Interval | null {
  const { median, p10, p90 } = answer ?? {};
  return typeof median === "number" &&
    typeof p10 === "number" &&
    typeof p90 === "number"
    ? { median, p10, p90 }
    : null;
}

/** One interval per forecast step. */
export function forecastSteps(answer: ExtractionAnswer | undefined): Interval[] {
  if (!answer) return [];
  if (Array.isArray(answer.steps))
    return answer.steps
      .map((s) => interval(s as ExtractionAnswer))
      .filter((s): s is Interval => s !== null);
  const { median, p10, p90 } = answer;
  if (Array.isArray(median) && Array.isArray(p10) && Array.isArray(p90))
    return median.map((m, i) => ({
      median: m as number,
      p10: p10[i] as number,
      p90: p90[i] as number,
    }));
  const single = interval(answer);
  return single ? [single] : [];
}
