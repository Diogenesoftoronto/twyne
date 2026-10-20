/** Rhythm forecasts contain seconds and counts only; no manuscript state. */
import { quantile, type FlowProfile } from "./flow-profile";
import type { Interval } from "./extraction";
import type { FlowMode, KeySample } from "./flow-state";

export const MIN_RHYTHM_HISTORY = 8;
export type PauseDecision = "hold" | "release" | "timer";
export interface RhythmEstimate {
  focus: Interval | null;
  pause: Interval | null;
}

/** Remaining seconds, conditional on having already lasted `elapsedSeconds`. */
export function remainingQuantiles(
  durationsMs: readonly number[],
  elapsedSeconds: number,
  minimum = MIN_RHYTHM_HISTORY,
): Interval | null {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return null;
  const remaining = durationsMs
    .filter((ms) => Number.isFinite(ms) && ms / 1000 > elapsedSeconds)
    .map((ms) => ms / 1000 - elapsedSeconds);
  if (remaining.length < Math.max(1, minimum)) return null;
  return {
    p10: quantile(remaining, 0.1)!,
    median: quantile(remaining, 0.5)!,
    p90: quantile(remaining, 0.9)!,
  };
}

export function rhythmBaseline(
  profile: FlowProfile,
  runSeconds: number,
  pauseSeconds: number,
): RhythmEstimate {
  return {
    focus: remainingQuantiles(profile.runs, runSeconds),
    pause: remainingQuantiles(profile.pauses, pauseSeconds),
  };
}

export function validInterval(value: Interval | null): value is Interval {
  return (
    !!value &&
    [value.p10, value.median, value.p90].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) &&
    value.p10 <= value.median &&
    value.median <= value.p90
  );
}

/** Both estimates are remaining durations at the time they were made. */
export function pauseDecision(
  estimate: RhythmEstimate,
  exitPauseMs: number,
  ageSeconds = 0,
): PauseDecision {
  const { focus, pause } = estimate;
  if (!validInterval(focus) || !validInterval(pause)) return "timer";
  if (focus.p90 - ageSeconds < 10) return "release";
  if (focus.p10 - ageSeconds >= 30 && pause.median < exitPauseMs / 1000)
    return "hold";
  return "timer";
}

/** An estimate of the whole pause, including the time already observed. */
export function predictedBreak(
  pause: Interval | null,
  elapsedAtPrediction: number,
  minimumSeconds = 60,
): boolean {
  return (
    Number.isFinite(elapsedAtPrediction) &&
    elapsedAtPrediction >= 0 &&
    validInterval(pause) &&
    pause.p10 + elapsedAtPrediction >= minimumSeconds
  );
}

export function rhythmCounts(
  samples: readonly KeySample[],
  now: number,
): number[] {
  const bins = Array<number>(6).fill(0);
  for (const sample of samples) {
    const age = now - sample.at;
    if (age >= 0 && age < 60_000) bins[5 - Math.floor(age / 10_000)]++;
  }
  return bins;
}

/** Existing cards may stay in settling; costly, little-used kinds can wait. */
export function skipFragileKind(
  mode: FlowMode,
  weight: number,
  costSeconds: number | null,
): boolean {
  return (
    mode === "settling" &&
    weight < 0.8 &&
    costSeconds !== null &&
    costSeconds >= 30
  );
}

/** Least-used hours first. No preference until at least an hour was observed. */
export function awayHours(profile: FlowProfile, top = 3): number[] {
  const hours = profile.hours.map((minutes, hour) => ({
    hour,
    minutes: Math.max(0, minutes),
  }));
  const total = hours.reduce((sum, h) => sum + h.minutes, 0);
  if (total < 60 || hours.some((h) => !Number.isFinite(h.minutes))) return [];
  return hours
    .filter((h) => h.minutes < total / 24)
    .sort((a, b) => a.minutes - b.minutes || a.hour - b.hour)
    .slice(0, Math.max(0, top))
    .map((h) => h.hour);
}
