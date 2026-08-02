import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LAYOUT,
  MARGIN_PRESET_REM,
  resolveMargins,
  type LayoutSettings,
} from "../types";

/**
 * Margin resolution has to keep three generations of the setting readable:
 * the coarse `margin` preset, the symmetric `marginX`, and the independent
 * left/right the ruler writes. A writer who set their page a year ago must
 * still open it to the page they chose.
 */
describe("resolveMargins", () => {
  const base: LayoutSettings = {
    width: "normal",
    margin: "normal",
    runningHeader: false,
    pageNumbers: true,
  };

  test("falls back to the coarse preset when nothing numeric is set", () => {
    const m = resolveMargins({ ...base, margin: "roomy" });
    expect(m.left).toBe(MARGIN_PRESET_REM.roomy);
    expect(m.right).toBe(MARGIN_PRESET_REM.roomy);
    expect(m.top).toBe(5);
    expect(m.bottom).toBe(5);
  });

  test("a document with only marginX gets it on both sides", () => {
    const m = resolveMargins({ ...base, marginX: 2.25 });
    expect(m.left).toBe(2.25);
    expect(m.right).toBe(2.25);
  });

  test("independent left/right win over marginX", () => {
    const m = resolveMargins({
      ...base,
      marginX: 3,
      marginLeft: 1.5,
      marginRight: 6,
    });
    expect(m.left).toBe(1.5);
    expect(m.right).toBe(6);
  });

  test("one edge can be set without disturbing the other", () => {
    // Dragging the left marker writes only marginLeft; the right must stay
    // where marginX put it rather than snapping to a default.
    const m = resolveMargins({ ...base, marginX: 3, marginLeft: 0.5 });
    expect(m.left).toBe(0.5);
    expect(m.right).toBe(3);
  });

  test("zero is honoured rather than treated as absent", () => {
    const m = resolveMargins({ ...base, marginX: 3, marginLeft: 0 });
    expect(m.left).toBe(0);
  });

  test("the default layout resolves to its own declared numbers", () => {
    const m = resolveMargins(DEFAULT_LAYOUT);
    expect(m).toEqual({ left: 2, right: 2, top: 1, bottom: 1 });
  });
});
