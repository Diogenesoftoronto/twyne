import { describe, expect, test } from "bun:test";
import { buildHeatmapWeeks, levelFor } from "./writing-heatmap";

describe("writing heatmap view model", () => {
  test("builds 53 Sunday-first UTC weeks with future cells disabled", () => {
    const weeks = buildHeatmapWeeks(
      [{ day: "2026-08-26", count: 4 }],
      Date.parse("2026-08-26T18:00:00.000Z"),
    );
    expect(weeks).toHaveLength(53);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().find((cell) => cell.day === "2026-08-26")?.count).toBe(
      4,
    );
    expect(weeks.flat().find((cell) => cell.day === "2026-08-27")?.count).toBe(
      -1,
    );
  });

  test("uses stable activity thresholds", () => {
    expect([0, 1, 2, 4, 7].map(levelFor)).toEqual([0, 1, 2, 3, 4]);
  });
});
