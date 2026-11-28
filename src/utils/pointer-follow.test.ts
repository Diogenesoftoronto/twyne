import { describe, expect, test } from "bun:test";
import { leanAt, spotAt, swingFor } from "./pointer-follow";

const box = { left: 100, top: 50, width: 200, height: 100 };

describe("where the pointer is over something", () => {
  test("the centre is level, the edges are a full lean", () => {
    expect(leanAt(box, 200, 100)).toEqual({ x: 0, y: 0 });
    expect(leanAt(box, 100, 50)).toEqual({ x: -1, y: -1 });
    expect(leanAt(box, 300, 150)).toEqual({ x: 1, y: 1 });
  });

  test("a pointer past the edge leans no further", () => {
    expect(leanAt(box, 900, -40)).toEqual({ x: 1, y: -1 });
  });

  test("a box with no size does not lean", () => {
    expect(leanAt({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({
      x: 0,
      y: 0,
    });
  });

  test("the same point as a gradient centre", () => {
    expect(spotAt(box, 200, 100)).toEqual({ x: "50.0%", y: "50.0%" });
    expect(spotAt(box, 150, 75)).toEqual({ x: "25.0%", y: "25.0%" });
  });
});

describe("something carried by the pointer", () => {
  test("hangs level when held still and trails the hand when moved", () => {
    expect(swingFor(0)).toBe(0);
    expect(swingFor(10)).toBeCloseTo(4.5);
    expect(swingFor(-10)).toBeCloseTo(-4.5);
  });

  test("never swings past its limit", () => {
    expect(swingFor(400)).toBe(9);
    expect(swingFor(-400)).toBe(-9);
  });
});
