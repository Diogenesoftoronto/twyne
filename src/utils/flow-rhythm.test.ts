import { expect, test } from "bun:test";
import { emptyProfile } from "./flow-profile";
import {
  awayHours,
  pauseDecision,
  predictedBreak,
  remainingQuantiles,
  rhythmBaseline,
  rhythmCounts,
  skipFragileKind,
} from "./flow-rhythm";

const interval = (p10: number, median: number, p90: number) => ({
  p10,
  median,
  p90,
});
test("conditional remaining quantiles exclude completed/equal runs and preserve input", () => {
  const runs = [10_000, 20_000, 30_000, 40_000, NaN, Infinity, -1];
  expect(remainingQuantiles(runs, 20, 2)).toEqual(interval(11, 15, 19));
  expect(runs[0]).toBe(10_000);
  expect(remainingQuantiles(runs, 20)).toBeNull();
  expect(remainingQuantiles(runs, -1, 1)).toBeNull();
  expect(remainingQuantiles(runs, Infinity, 1)).toBeNull();
  expect(remainingQuantiles(Array(8).fill(60_000), 10)).toEqual(
    interval(50, 50, 50),
  );
});
test("baseline independently conditions the current run and pause", () => {
  expect(
    rhythmBaseline(
      {
        ...emptyProfile(),
        runs: Array(8).fill(120_000),
        pauses: Array(8).fill(15_000),
      },
      90,
      4,
    ),
  ).toEqual({ focus: interval(30, 30, 30), pause: interval(11, 11, 11) });
  expect(rhythmBaseline(emptyProfile(), 90, 4)).toEqual({
    focus: null,
    pause: null,
  });
});
test("hold/release thresholds are exact, and old predictions lose their hold", () => {
  const estimate = { focus: interval(30, 50, 90), pause: interval(1, 24, 60) };
  expect(pauseDecision(estimate, 25_000)).toBe("hold");
  expect(pauseDecision(estimate, 25_000, 1)).toBe("timer");
  expect(
    pauseDecision({ ...estimate, pause: interval(1, 25, 60) }, 25_000),
  ).toBe("timer");
  expect(
    pauseDecision({ ...estimate, focus: interval(0, 5, 9.99) }, 25_000),
  ).toBe("release");
  expect(
    pauseDecision({ ...estimate, focus: interval(0, 5, 10) }, 25_000),
  ).toBe("timer");
  expect(pauseDecision({ focus: null, pause: estimate.pause }, 25_000)).toBe(
    "timer",
  );
  expect(
    pauseDecision({ focus: interval(10, 5, 1), pause: estimate.pause }, 25_000),
  ).toBe("timer");
});
test("break uses the lower bound plus the observed pause, never the median", () => {
  expect(predictedBreak(interval(56, 90, 150), 4)).toBe(true);
  expect(predictedBreak(interval(55, 90, 150), 4)).toBe(false);
  expect(predictedBreak(null, 60)).toBe(false);
});
test("six rhythm bins carry event counts without characters", () => {
  const keys = [0, 1_000, 10_000, 50_000, 59_000, 60_001].map((at) => ({
    at,
    inserted: 20,
    deleted: 5,
  }));
  expect(rhythmCounts(keys, 60_000)).toEqual([2, 0, 0, 0, 1, 1]);
});
test("away hours need history and prefer the least-used local hours", () => {
  const profile = emptyProfile();
  expect(awayHours(profile)).toEqual([]);
  profile.hours = Array(24).fill(3);
  expect(awayHours(profile)).toEqual([]);
  profile.hours[9] = 120;
  profile.hours[3] = 0;
  profile.hours[4] = 1;
  expect(awayHours(profile, 2)).toEqual([3, 4]);
});
test("only costly, little-used kinds are held while settling", () => {
  expect(skipFragileKind("settling", 0.79, 30)).toBe(true);
  expect(skipFragileKind("settling", 0.8, 30)).toBe(false);
  expect(skipFragileKind("settling", 0.5, null)).toBe(false);
  expect(skipFragileKind("settling", 0.5, 29)).toBe(false);
  expect(skipFragileKind("working", 0.5, 100)).toBe(false);
});
