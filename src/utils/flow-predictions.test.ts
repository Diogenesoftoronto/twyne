import { expect, test } from "bun:test";
import {
  appendPrediction,
  calibration,
  intervalScore,
  MAX_PREDICTIONS,
  normalizePredictions,
  pinball,
  resolvePause,
  resolveRun,
  trustClairic,
  type RhythmPrediction,
} from "./flow-predictions";

function prediction(
  source: "baseline" | "clairic",
  id = "pause",
): RhythmPrediction {
  return {
    id,
    source,
    at: 100_000,
    lastKeyAt: 96_000,
    runStartedAt: 1_000,
    runSeconds: 95,
    pauseSeconds: 4,
    estimate: {
      focus: { p10: 10, median: 20, p90: 30 },
      pause: { p10: 10, median: 20, p90: 30 },
    },
  };
}
function calibratedLog(count = 20): RhythmPrediction[] {
  return Array.from({ length: count }, (_, i) => {
    const actual = i % 5 === 0 ? 31 : 20;
    const baseline = prediction("baseline", String(i));
    baseline.estimate = {
      focus: { p10: 1, median: 50, p90: 100 },
      pause: { p10: 1, median: 50, p90: 100 },
    };
    return [baseline, prediction("clairic", String(i))].map((p) => ({
      ...p,
      actualFocus: actual,
      actualPause: actual,
    }));
  }).flat();
}

test("outcomes resolve only the matching run/pause, in seconds from prediction time", () => {
  const first = prediction("baseline");
  const other = {
    ...prediction("clairic", "other"),
    lastKeyAt: 200_000,
    runStartedAt: 200_000,
  };
  const run = resolveRun([first, other], 1_000, 150_000);
  expect(run[0].actualFocus).toBe(50);
  expect(run[1].actualFocus).toBeUndefined();
  expect(resolvePause(run, 96_000, 110_000)[0].actualPause).toBe(10);
  expect(resolveRun([first], 1_000, 96_000)[0].actualFocus).toBe(0);
  expect(first.actualFocus).toBeUndefined();
});
test("coverage, pinball and interval scores penalize confident misses", () => {
  expect(pinball(20, 10, 0.1)).toBe(1);
  expect(pinball(0, 10, 0.1)).toBe(9);
  expect(intervalScore(20, { p10: 10, median: 20, p90: 30 })).toBe(20);
  expect(intervalScore(40, { p10: 10, median: 20, p90: 30 })).toBe(120);
  const stats = calibration(calibratedLog(), "clairic", "focus");
  expect(stats.count).toBe(20);
  expect(stats.coverage).toBe(0.8);
  expect(stats.intervalScore).toBe(22);
});
test("trust needs twenty paired, resolved, calibrated wins on both targets", () => {
  expect(trustClairic(calibratedLog(19))).toBe(false);
  expect(trustClairic(calibratedLog())).toBe(true);
  expect(
    trustClairic(calibratedLog().filter((p) => p.source === "clairic")),
  ).toBe(false);
  expect(
    trustClairic(
      calibratedLog().map((p) => ({ ...p, actualPause: undefined })),
    ),
  ).toBe(false);
  expect(
    trustClairic(calibratedLog().map((p) => ({ ...p, actualFocus: 20 }))),
  ).toBe(false);
  expect(
    trustClairic(calibratedLog().map((p) => ({ ...p, actualFocus: 1000 }))),
  ).toBe(false);
  expect(
    trustClairic(
      calibratedLog().map((p) =>
        p.source === "baseline"
          ? { ...p, estimate: prediction("clairic").estimate }
          : p,
      ),
    ),
  ).toBe(false);
});
test("calibration rolls over fifty pairs; storage rejects bad intervals and stays bounded", () => {
  const log = calibratedLog(100);
  expect(calibration(log, "clairic", "focus").count).toBe(50);
  expect(trustClairic(log)).toBe(true);
  let bounded: RhythmPrediction[] = [];
  for (let i = 0; i < 300; i++)
    bounded = appendPrediction(bounded, prediction("baseline", String(i)));
  expect(bounded).toHaveLength(MAX_PREDICTIONS);
  expect(bounded[0].id).toBe("60");
  expect(
    normalizePredictions([
      {},
      { ...prediction("baseline"), at: NaN },
      prediction("clairic"),
    ]),
  ).toHaveLength(1);
  expect(normalizePredictions(null)).toEqual([]);
});

test("trust rejects mismatched pair outcomes and requires both metrics to improve", () => {
  expect(
    trustClairic(
      calibratedLog().map((p) =>
        p.source === "baseline" ? { ...p, at: 99 } : p,
      ),
    ),
  ).toBe(false);
  expect(
    trustClairic(
      calibratedLog().map((p) =>
        p.source === "baseline" ? { ...p, actualPause: 21 } : p,
      ),
    ),
  ).toBe(false);
});
