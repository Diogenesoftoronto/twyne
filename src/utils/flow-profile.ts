/**
 * What Twyne learns about how this writer works.
 *
 * Only rhythms and reactions, never words: how long their runs last, how long
 * they pause between them, how long it takes them to settle, what hours they
 * write, and which kinds of margin help they use versus wave away. Stored on
 * this device only.
 *
 * Two things read it:
 *   - `thresholdsFor` fits the flow detector to the writer. Someone who
 *     habitually pauses 20 seconds to think is not stuck at 20 seconds.
 *   - `kindWeight` ranks margin items. A kind the writer keeps dismissing
 *     sinks; one they open rises. Laplace-smoothed, so it starts neutral and
 *     no single click swings it.
 */
import { DEFAULT_THRESHOLDS, type FlowThresholds } from "./flow-state";

export type ItemOutcome = "shown" | "engaged" | "dismissed";

export interface KindStats {
  shown: number;
  engaged: number;
  dismissed: number;
}

export interface FlowProfile {
  version: 1;
  /** Pauses between runs, ms; most recent last. */
  pauses: number[];
  /** Run lengths, ms. */
  runs: number[];
  /** Run length at the moment flow was confirmed, ms. */
  flowEntries: number[];
  /** Minutes written in each hour of the day, local time. */
  hours: number[];
  kinds: Record<string, KindStats>;
  /** Times the writer switched automatic focus off by hand. */
  overrides: number;
  updatedAt: number;
}

const MAX_SAMPLES = 240;

export function emptyProfile(): FlowProfile {
  return {
    version: 1,
    pauses: [],
    runs: [],
    flowEntries: [],
    hours: Array.from({ length: 24 }, () => 0),
    kinds: {},
    overrides: 0,
    updatedAt: 0,
  };
}

export function normalizeProfile(value: unknown): FlowProfile {
  const base = emptyProfile();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<FlowProfile>;
  const numbers = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((n): n is number => typeof n === "number" && isFinite(n))
      : [];
  const hours = numbers(raw.hours);
  return {
    version: 1,
    pauses: numbers(raw.pauses).slice(-MAX_SAMPLES),
    runs: numbers(raw.runs).slice(-MAX_SAMPLES),
    flowEntries: numbers(raw.flowEntries).slice(-MAX_SAMPLES),
    hours: hours.length === 24 ? hours : base.hours,
    kinds: raw.kinds && typeof raw.kinds === "object" ? raw.kinds : {},
    overrides: typeof raw.overrides === "number" ? raw.overrides : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

const push = (list: number[], value: number) =>
  [...list, Math.round(value)].slice(-MAX_SAMPLES);

export function recordPause(
  p: FlowProfile,
  ms: number,
  now: number,
): FlowProfile {
  // Sub-second gaps are typing, and long ones are someone making tea.
  if (ms < 1_500 || ms > 10 * 60_000) return p;
  return { ...p, pauses: push(p.pauses, ms), updatedAt: now };
}

export function recordRun(
  p: FlowProfile,
  ms: number,
  now: number,
  hour = new Date(now).getHours(),
): FlowProfile {
  if (ms < 5_000) return p;
  const hours = [...p.hours];
  hours[hour] = (hours[hour] ?? 0) + ms / 60_000;
  return { ...p, runs: push(p.runs, ms), hours, updatedAt: now };
}

export function recordFlowEntry(
  p: FlowProfile,
  runMs: number,
  now: number,
): FlowProfile {
  return { ...p, flowEntries: push(p.flowEntries, runMs), updatedAt: now };
}

export function recordOverride(p: FlowProfile, now: number): FlowProfile {
  return { ...p, overrides: p.overrides + 1, updatedAt: now };
}

export function recordItem(
  p: FlowProfile,
  kind: string,
  outcome: ItemOutcome,
  now: number,
): FlowProfile {
  const stats = p.kinds[kind] ?? { shown: 0, engaged: 0, dismissed: 0 };
  return {
    ...p,
    kinds: { ...p.kinds, [kind]: { ...stats, [outcome]: stats[outcome] + 1 } },
    updatedAt: now,
  };
}

export function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, (sorted.length - 1) * q),
  );
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Fit the detector to the writer. Needs a dozen pauses before it trusts
 * them; until then the defaults hold.
 */
export function thresholdsFor(p: FlowProfile): FlowThresholds {
  const t = { ...DEFAULT_THRESHOLDS };
  if (p.pauses.length >= 12) {
    const typical = quantile(p.pauses, 0.75)!;
    const long = quantile(p.pauses, 0.9)!;
    t.stuckPauseMs = clamp(typical * 2, 12_000, 60_000);
    t.exitPauseMs = clamp(long * 1.5, 15_000, 45_000);
  }
  if (p.flowEntries.length >= 5) {
    t.flowMs = clamp(quantile(p.flowEntries, 0.5)!, 60_000, 240_000);
    t.settleMs = Math.round(t.flowMs / 3);
  }
  return t;
}

/** 0.2..1.8 — how much this writer uses help of this kind. Neutral at 1. */
export function kindWeight(p: FlowProfile, kind: string): number {
  const s = p.kinds[kind];
  if (!s) return 1;
  const rate = (s.engaged + 1) / (s.engaged + s.dismissed + 2);
  return clamp(rate * 2, 0.2, 1.8);
}

/** The writer's usual hours, strongest first — for the inspector. */
export function writingHours(p: FlowProfile, top = 3): number[] {
  return p.hours
    .map((minutes, hour) => ({ minutes, hour }))
    .filter((h) => h.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, top)
    .map((h) => h.hour);
}
