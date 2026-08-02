import { describe, expect, test } from "bun:test";
import {
  clampTableDimensions,
  isTableGridCellSelected,
  moveTableGridSelection,
} from "./table-insertion-grid";

describe("table insertion grid", () => {
  test("clamps dimensions to positive, bounded integers", () => {
    expect(
      clampTableDimensions(
        { rows: 4.8, columns: 7.2 },
        { rows: 8, columns: 10 },
      ),
    ).toEqual({ rows: 4, columns: 7 });
    expect(
      clampTableDimensions(
        { rows: -1, columns: 999 },
        { rows: 8, columns: 10 },
      ),
    ).toEqual({ rows: 1, columns: 10 });
  });

  test("arrow keys resize the selected rectangle without wrapping", () => {
    const limits = { rows: 4, columns: 5 };
    expect(
      moveTableGridSelection({ rows: 1, columns: 1 }, "ArrowLeft", limits),
    ).toEqual({ rows: 1, columns: 1 });
    expect(
      moveTableGridSelection({ rows: 1, columns: 1 }, "ArrowDown", limits),
    ).toEqual({ rows: 2, columns: 1 });
    expect(
      moveTableGridSelection({ rows: 4, columns: 5 }, "ArrowRight", limits),
    ).toEqual({ rows: 4, columns: 5 });
  });

  test("Home selects 1-by-1 and End selects the full grid", () => {
    const limits = { rows: 8, columns: 10 };
    expect(
      moveTableGridSelection({ rows: 4, columns: 5 }, "Home", limits),
    ).toEqual({ rows: 1, columns: 1 });
    expect(
      moveTableGridSelection({ rows: 1, columns: 1 }, "End", limits),
    ).toEqual(limits);
  });

  test("selection fills the complete N-by-M preview rectangle", () => {
    const selection = { rows: 3, columns: 4 };
    expect(isTableGridCellSelected({ rows: 3, columns: 4 }, selection)).toBe(
      true,
    );
    expect(isTableGridCellSelected({ rows: 2, columns: 1 }, selection)).toBe(
      true,
    );
    expect(isTableGridCellSelected({ rows: 4, columns: 4 }, selection)).toBe(
      false,
    );
    expect(isTableGridCellSelected({ rows: 3, columns: 5 }, selection)).toBe(
      false,
    );
  });
});
