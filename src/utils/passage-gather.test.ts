import { expect, test } from "bun:test";
import { documentFraction, trimContext } from "./passage-gather";

test("context keeps the end of what precedes and the start of what follows", () => {
  const before = `${"word ".repeat(80)}just before`;
  const after = `just after ${"word ".repeat(80)}`;
  const trimmed = trimContext(before, after, 60);
  expect(trimmed.before.startsWith("…")).toBe(true);
  expect(trimmed.before.endsWith("just before")).toBe(true);
  expect(trimmed.after.startsWith("just after")).toBe(true);
  expect(trimmed.after.endsWith("…")).toBe(true);
  // Cuts land between words, never inside one.
  expect(trimmed.before).toMatch(/^…word /);
  expect(trimmed.after).toMatch(/ word…$/);
  expect(trimContext("short", "also short")).toEqual({
    before: "short",
    after: "also short",
  });
});

test("a passage's place in the manuscript is a clamped fraction", () => {
  expect(documentFraction(150, 100, 1000)).toBeCloseTo(0.05);
  expect(documentFraction(50, 100, 1000)).toBe(0);
  expect(documentFraction(5000, 100, 1000)).toBe(1);
  expect(documentFraction(10, 0, 0)).toBe(0);
});
