import { expect, test } from "bun:test";
import {
  FlowInterruptions,
  normalizeInterruptions,
} from "./flow-interruptions";

test("cost is the per-kind median after five recoveries, with one observation per exposure", () => {
  const tracker = new FlowInterruptions();
  expect(tracker.interruptionCostSeconds("source")).toBeNull();
  for (const seconds of [50, 30, 40, 60, 20]) {
    tracker.shown("source", 1000);
    tracker.shown("source", 2000);
    tracker.shown("comment", 1000);
    expect(tracker.steady(1000 + seconds * 1000)).toBe(true);
    expect(tracker.steady(100_000)).toBe(false);
  }
  expect(tracker.interruptionCostSeconds("source")).toBe(40);
  expect(tracker.skip("source", "settling", 0.5)).toBe(true);
  expect(tracker.skip("source", "working", 0.5)).toBe(false);
  expect(tracker.interruptionCostSeconds("work")).toBeNull();
});
test("long absences are censored, samples bounded and corrupt stored values removed", () => {
  const tracker = new FlowInterruptions();
  tracker.shown("source", 0);
  expect(tracker.steady(600_001)).toBe(false);
  for (let i = 0; i < 80; i++) {
    tracker.shown("source", 0);
    tracker.steady(30_000);
  }
  expect(tracker.history.source).toHaveLength(60);
  expect(
    normalizeInterruptions({ source: [NaN, Infinity, -1, 601, 20], bad: 42 }),
  ).toEqual({ source: [20] });
});

test("recovering requires fresh steady keys after the exposure", () => {
  const tracker = new FlowInterruptions();
  tracker.shown("source", 1000);
  expect(tracker.steady(10_000, 30_000)).toBe(false);
  expect(tracker.steady(31_000, 30_000)).toBe(true);
  expect(tracker.history.source).toEqual([30]);
});
