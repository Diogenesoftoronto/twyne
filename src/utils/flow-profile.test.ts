import { expect, test } from "bun:test";
import {
  emptyProfile,
  kindWeight,
  normalizeProfile,
  quantile,
  recordFlowEntry,
  recordItem,
  recordOverride,
  recordPause,
  recordRun,
  thresholdsFor,
  writingHours,
} from "./flow-profile";
import { DEFAULT_THRESHOLDS } from "./flow-state";

test("pause thresholds learn only after twelve observations and remain bounded", () => {
  let profile = emptyProfile();
  for (let i = 0; i < 11; i++) profile = recordPause(profile, 20_000, i);
  expect(thresholdsFor(profile)).toEqual(DEFAULT_THRESHOLDS);
  profile = recordPause(profile, 20_000, 12);
  expect(thresholdsFor(profile)).toMatchObject({
    stuckPauseMs: 40_000,
    exitPauseMs: 30_000,
  });
  expect(
    thresholdsFor({ ...profile, pauses: Array(12).fill(1_500) }),
  ).toMatchObject({ stuckPauseMs: 12_000, exitPauseMs: 15_000 });
  expect(
    thresholdsFor({ ...profile, pauses: Array(12).fill(600_000) }),
  ).toMatchObject({ stuckPauseMs: 60_000, exitPauseMs: 45_000 });
});

test("confirmed runs teach flow and settling thresholds after five entries", () => {
  let profile = emptyProfile();
  for (let i = 0; i < 4; i++) profile = recordFlowEntry(profile, 150_000, i);
  expect(thresholdsFor(profile).flowMs).toBe(90_000);
  profile = recordFlowEntry(profile, 150_000, 5);
  expect(thresholdsFor(profile)).toMatchObject({
    flowMs: 150_000,
    settleMs: 50_000,
  });
  expect(
    thresholdsFor({ ...profile, flowEntries: Array(5).fill(1) }).flowMs,
  ).toBe(60_000);
  expect(
    thresholdsFor({ ...profile, flowEntries: Array(5).fill(1_000_000) }).flowMs,
  ).toBe(240_000);
});

test("learning is immutable, ignores typing/tea gaps and bounds its history", () => {
  const base = emptyProfile();
  expect(recordPause(base, 1_499, 1)).toBe(base);
  expect(recordPause(base, 600_001, 1)).toBe(base);
  expect(recordRun(base, 4_999, 1)).toBe(base);
  let profile = base;
  for (let i = 0; i < 250; i++) profile = recordPause(profile, 5_000 + i, i);
  expect(profile.pauses).toHaveLength(240);
  expect(profile.pauses[0]).toBe(5_010);
  expect(base.pauses).toEqual([]);
  const run = recordRun(base, 120_000, 100, 9);
  expect(run.hours[9]).toBe(2);
  expect(writingHours(run)).toEqual([9]);
  expect(base.hours[9]).toBe(0);
  expect(recordOverride(base, 42)).toMatchObject({
    overrides: 1,
    updatedAt: 42,
  });
});

test("kind preferences start neutral, rise with use, fall with dismissal and stay bounded", () => {
  const base = emptyProfile();
  expect(kindWeight(base, "way-in")).toBe(1);
  expect(kindWeight(recordItem(base, "way-in", "shown", 1), "way-in")).toBe(1);
  expect(
    kindWeight(recordItem(base, "way-in", "engaged", 1), "way-in"),
  ).toBeGreaterThan(1);
  expect(
    kindWeight(recordItem(base, "way-in", "dismissed", 1), "way-in"),
  ).toBeLessThan(1);
  const profile = {
    ...base,
    kinds: {
      used: { shown: 100, engaged: 100, dismissed: 0 },
      waved: { shown: 100, engaged: 0, dismissed: 100 },
    },
  };
  expect(kindWeight(profile, "used")).toBe(1.8);
  expect(kindWeight(profile, "waved")).toBe(0.2);
  expect(base.kinds).toEqual({});
});

test("stored profiles discard nonfinite samples and quantiles leave inputs unchanged", () => {
  expect(normalizeProfile(null)).toEqual(emptyProfile());
  const profile = normalizeProfile({
    pauses: [5_000, NaN, Infinity, "bad"],
    hours: [1],
  });
  expect(profile.pauses).toEqual([5_000]);
  expect(profile.hours).toHaveLength(24);
  const values = [30, 10, 20];
  expect(quantile(values, 0.75)).toBe(25);
  expect(quantile([], 0.5)).toBeNull();
  expect(values).toEqual([30, 10, 20]);
});
