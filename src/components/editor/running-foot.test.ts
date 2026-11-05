import { describe, expect, test } from "bun:test";
import { sectionAt } from "./running-foot";

describe("sectionAt", () => {
  const offsets = [400, 1200, 2600];

  test("nothing above the first section's heading", () => {
    expect(sectionAt(offsets, 0)).toBe(-1);
    expect(sectionAt(offsets, 399)).toBe(-1);
  });

  test("a heading on the reading line starts its section", () => {
    expect(sectionAt(offsets, 400)).toBe(0);
    expect(sectionAt(offsets, 1199)).toBe(0);
    expect(sectionAt(offsets, 1200)).toBe(1);
  });

  test("the last section runs to the end", () => {
    expect(sectionAt(offsets, 99_999)).toBe(2);
  });

  test("a manuscript without sections never has one", () => {
    expect(sectionAt([], 500)).toBe(-1);
  });
});
