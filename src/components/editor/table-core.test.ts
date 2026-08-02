import { describe, expect, test } from "bun:test";
import {
  FloatingTableToolbar,
  TABLE_ACTIONS,
  TableInsertionGrid,
  createTableCoreExtensions,
  createTableToolbarController,
  runTableToolbarIntent,
} from "./table-core";

describe("table core integration contract", () => {
  test("exports the extension bundle, overlays, controller, and dispatcher", () => {
    expect(createTableCoreExtensions()).toHaveLength(5);
    expect(TableInsertionGrid).toBeFunction();
    expect(FloatingTableToolbar).toBeFunction();
    expect(createTableToolbarController).toBeFunction();
    expect(runTableToolbarIntent).toBeFunction();
    expect(TABLE_ACTIONS.length).toBeGreaterThan(0);
  });
});
