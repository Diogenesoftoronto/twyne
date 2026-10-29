/** Bounded on-device evidence. Outcomes never depend on the prediction's gate. */
import type { Interval } from "./extraction";
import { validInterval, type RhythmEstimate } from "./flow-rhythm";

// The zero-inclusive target and matched empirical baseline must earn trust
// afresh; old cadence-based comparisons cannot qualify this version.
export const PREDICTION_LOG_KEY = "flow-rhythm-predictions-v2";
export const MAX_PREDICTIONS = 240;
export const MIN_CALIBRATION_PAIRS = 20;
const CALIBRATION_WINDOW = 50;
export type PredictionSource = "baseline" | "clairic";
export interface RhythmPrediction {
  id: string;
  source: PredictionSource;
  at: number;
  /** Observed focus bout, closed by the ordinary exit pause, never the model. */
  runStartedAt: number;
  lastKeyAt: number;
  runSeconds: number;
  pauseSeconds: number;
  estimate: RhythmEstimate;
  actualFocus?: number;
  actualPause?: number;
}

export function normalizePredictions(value: unknown): RhythmPrediction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is RhythmPrediction => {
      if (!p || typeof p !== "object") return false;
      return (
        typeof p.id === "string" &&
        ["baseline", "clairic"].includes(p.source) &&
        [p.at, p.runStartedAt, p.lastKeyAt, p.runSeconds, p.pauseSeconds].every(
          (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
        ) &&
        p.estimate &&
        (p.estimate.focus === null || validInterval(p.estimate.focus)) &&
        (p.estimate.pause === null || validInterval(p.estimate.pause)) &&
        [p.actualFocus, p.actualPause].every(
          (n) =>
            n === undefined ||
            (typeof n === "number" && Number.isFinite(n) && n >= 0),
        )
      );
    })
    .slice(-MAX_PREDICTIONS);
}

export function appendPrediction(
  log: readonly RhythmPrediction[],
  prediction: RhythmPrediction,
): RhythmPrediction[] {
  return [...log, prediction].slice(-MAX_PREDICTIONS);
}

export function resolveRun(
  log: readonly RhythmPrediction[],
  runStartedAt: number,
  lastKeyAt: number,
): RhythmPrediction[] {
  return log.map((p) =>
    p.runStartedAt === runStartedAt && p.actualFocus === undefined
      ? { ...p, actualFocus: Math.max(0, (lastKeyAt - p.at) / 1000) }
      : p,
  );
}

export function resolvePause(
  log: readonly RhythmPrediction[],
  lastKeyAt: number,
  nextKeyAt: number,
): RhythmPrediction[] {
  return log.map((p) =>
    p.lastKeyAt === lastKeyAt && p.actualPause === undefined
      ? { ...p, actualPause: Math.max(0, (nextKeyAt - p.at) / 1000) }
      : p,
  );
}

export function pinball(actual: number, predicted: number, q: number): number {
  const error = actual - predicted;
  return error * (error >= 0 ? q : q - 1);
}

export function intervalScore(actual: number, interval: Interval): number {
  return (
    interval.p90 -
    interval.p10 +
    10 * Math.max(0, interval.p10 - actual) +
    10 * Math.max(0, actual - interval.p90)
  );
}

export interface Calibration {
  count: number;
  coverage: number;
  pinball: number;
  intervalScore: number;
}

export function calibration(
  log: readonly RhythmPrediction[],
  source: PredictionSource,
  target: "focus" | "pause",
): Calibration {
  const resolved = log
    .filter(
      (p) =>
        p.source === source &&
        validInterval(p.estimate[target]) &&
        (target === "focus" ? p.actualFocus : p.actualPause) !== undefined,
    )
    .slice(-CALIBRATION_WINDOW);
  let covered = 0,
    loss = 0,
    score = 0;
  for (const p of resolved) {
    const interval = p.estimate[target]!;
    const actual = (target === "focus" ? p.actualFocus : p.actualPause)!;
    covered += Number(actual >= interval.p10 && actual <= interval.p90);
    loss +=
      (pinball(actual, interval.p10, 0.1) +
        pinball(actual, interval.median, 0.5) +
        pinball(actual, interval.p90, 0.9)) /
      3;
    score += intervalScore(actual, interval);
  }
  const count = resolved.length;
  return {
    count,
    coverage: count ? covered / count : 0,
    pinball: count ? loss / count : Infinity,
    intervalScore: count ? score / count : Infinity,
  };
}

/** Compare the same pauses, never two sources' unrelated samples. */
export function trustClairic(log: readonly RhythmPrediction[]): boolean {
  const complete = (p: RhythmPrediction) =>
    validInterval(p.estimate.focus) &&
    validInterval(p.estimate.pause) &&
    p.actualFocus !== undefined &&
    p.actualPause !== undefined;
  const baselines = new Map(
    log
      .filter((p) => p.source === "baseline" && complete(p))
      .map((p) => [p.id, p]),
  );
  const models = log
    .filter((p) => {
      const baseline = baselines.get(p.id);
      return (
        p.source === "clairic" &&
        complete(p) &&
        baseline &&
        baseline.at === p.at &&
        baseline.lastKeyAt === p.lastKeyAt &&
        baseline.runStartedAt === p.runStartedAt &&
        baseline.actualFocus === p.actualFocus &&
        baseline.actualPause === p.actualPause
      );
    })
    .slice(-CALIBRATION_WINDOW);
  if (models.length < MIN_CALIBRATION_PAIRS) return false;
  const paired = [...models, ...models.map((p) => baselines.get(p.id)!)];
  return (["focus", "pause"] as const).every((target) => {
    const model = calibration(paired, "clairic", target);
    const baseline = calibration(paired, "baseline", target);
    return (
      model.coverage >= 0.7 &&
      // Discrete outcomes (especially zero) can validly exceed 80% coverage.
      // Proper scores below still penalize unhelpfully wide intervals.
      model.pinball < baseline.pinball &&
      model.intervalScore < baseline.intervalScore
    );
  });
}
