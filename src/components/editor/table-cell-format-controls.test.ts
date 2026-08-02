import { describe, expect, test } from "bun:test";
import {
  TableCellFormatControls,
  type TableCellFormatControlsProps,
} from "./table-cell-format-controls";

describe("table cell format controls integration contract", () => {
  test("exports an isolated component accepting selection state and intents", () => {
    expect(TableCellFormatControls).toBeFunction();
    const format: TableCellFormatControlsProps["format"] = {
      cellCount: 2,
      backgroundColor: "mixed",
      horizontalAlignment: "center",
      verticalAlignment: "middle",
      borderColor: "#2c4a7c",
      borderStyle: "solid",
      borderWidth: 1,
      stylePreset: null,
    };
    expect(format.cellCount).toBe(2);
  });
});
