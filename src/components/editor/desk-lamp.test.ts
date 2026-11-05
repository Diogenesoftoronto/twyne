import { describe, expect, test } from "bun:test";
import { lampForHour } from "./desk-lamp";

describe("lampForHour", () => {
  test("the light crosses the desk from morning to evening", () => {
    const morning = lampForHour(8);
    const noon = lampForHour(13);
    const evening = lampForHour(19);
    expect(morning.x).toBeLessThan(noon.x);
    expect(noon.x).toBeLessThan(evening.x);
  });

  test("it is highest and palest at midday, warm at the day's edges", () => {
    const noon = lampForHour(13);
    const dusk = lampForHour(19);
    expect(noon.y).toBeLessThan(dusk.y);
    expect(noon.warmth).toBeLessThan(dusk.warmth);
  });

  test("night is a warm, low lamp", () => {
    for (const hour of [0, 3, 22]) {
      const lamp = lampForHour(hour);
      expect(lamp.warmth).toBe(1);
      expect(lamp.y).toBeGreaterThan(15);
    }
  });

  test("stays on the desk at every hour", () => {
    for (let hour = 0; hour < 24; hour++) {
      const { x, y, warmth } = lampForHour(hour);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(warmth).toBeGreaterThanOrEqual(0);
      expect(warmth).toBeLessThanOrEqual(1);
    }
  });
});
