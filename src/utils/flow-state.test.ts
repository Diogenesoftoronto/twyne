import { expect, test } from "bun:test";
import {
  DEFAULT_THRESHOLDS,
  isQuiet,
  readFlow,
  trimSamples,
  type KeySample,
} from "./flow-state";

const steady = (seconds: number): KeySample[] =>
  Array.from({ length: seconds + 1 }, (_, i) => ({
    at: i * 1_000,
    inserted: 5,
    deleted: 0,
  }));

test("writing progresses from working to settling to flow only after sustained keys", () => {
  expect(readFlow([], 0, "away").mode).toBe("working");
  expect(readFlow(steady(29), 29_000, "working").mode).toBe("working");
  expect(readFlow(steady(30), 30_000, "working").mode).toBe("settling");
  expect(readFlow(steady(90), 90_000, "settling").mode).toBe("flow");
  expect(
    readFlow([{ at: 90_000, inserted: 2_000, deleted: 0 }], 90_000, "working")
      .mode,
  ).toBe("working");
});

test("flow survives a rewrite and a brief pause, then yields to a long pause, reaching or absence", () => {
  const samples = [...steady(90), { at: 91_000, inserted: 0, deleted: 500 }];
  expect(readFlow(samples, 100_000, "flow").mode).toBe("flow");
  expect(readFlow(samples, 116_000, "flow").mode).toBe("working");
  expect(
    readFlow(samples, 91_000, "flow", undefined, { reaching: true }).mode,
  ).toBe("working");
  expect(readFlow(samples, 271_000, "flow").mode).toBe("away");
});

test("circling plus a pause reads as stuck; a normal thinking pause does not", () => {
  const samples = [{ at: 0, inserted: 10, deleted: 20 }];
  expect(readFlow(samples, 17_999, "working").mode).toBe("working");
  expect(readFlow(samples, 18_000, "working").mode).toBe("stuck");
  expect(
    readFlow([{ at: 0, inserted: 20, deleted: 0 }], 18_000, "working").mode,
  ).toBe("working");
  expect(
    readFlow(
      [{ at: 0, inserted: 20, deleted: 0 }],
      18_000,
      "working",
      undefined,
      { struggle: 0.8 },
    ).mode,
  ).toBe("stuck");
  expect(
    readFlow([{ at: 0, inserted: 20, deleted: 0 }], 5_000, "stuck").mode,
  ).toBe("stuck");
  expect(readFlow([{ at: 0, inserted: 20, deleted: 0 }], 0, "stuck").mode).toBe(
    "working",
  );
});

test("a gap breaks the run, sparse edits do not enter flow, and learned thresholds apply", () => {
  const samples = [...steady(90), { at: 100_000, inserted: 5, deleted: 0 }];
  expect(readFlow(samples, 100_000, "working").runMs).toBe(0);
  const sparse = steady(90).filter((_, i) => i % 4 === 0);
  expect(readFlow(sparse, 88_000, "working").mode).toBe("working");
  expect(
    readFlow(steady(90), 90_000, "working", {
      ...DEFAULT_THRESHOLDS,
      flowMs: 120_000,
    }).mode,
  ).toBe("settling");
});

test("trimming preserves the cutoff and quiet modes are exactly settling and flow", () => {
  const samples = [
    { at: 0, inserted: 1, deleted: 0 },
    { at: 1_000, inserted: 1, deleted: 0 },
  ];
  expect(trimSamples(samples, 601_000)).toEqual([samples[1]]);
  expect(samples).toHaveLength(2);
  for (const mode of ["away", "working", "settling", "flow", "stuck"] as const)
    expect(isQuiet(mode)).toBe(mode === "flow" || mode === "settling");
});
