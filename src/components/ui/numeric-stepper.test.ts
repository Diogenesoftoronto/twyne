import { describe, expect, test } from "bun:test";
import { normalizeNumericValue, stepNumericValue } from "./numeric-stepper";

describe("NumericStepper", () => {
  test("steps decimal values without floating point noise", () => {
    expect(stepNumericValue(0.2, 1, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(stepNumericValue(1.05, -1, { min: 0.25, max: 4, step: 0.05 })).toBe(
      1,
    );
  });

  test("clamps typed and stepped values to their bounds", () => {
    expect(normalizeNumericValue(5000, { min: 50, max: 4000 })).toBe(4000);
    expect(stepNumericValue(1, 1, { min: 0, max: 1, step: 0.1 })).toBe(1);
  });

  test("uses the field-specific seed when an optional value is blank", () => {
    expect(
      stepNumericValue(null, 1, {
        min: 0.25,
        max: 4,
        step: 0.05,
        emptyValue: 1,
      }),
    ).toBe(1);
  });

  test("is the only component that owns a native number input", async () => {
    const owners: string[] = [];
    for (const path of new Bun.Glob("src/**/*.tsx").scanSync()) {
      if (path.endsWith("numeric-stepper.tsx")) continue;
      if ((await Bun.file(path).text()).includes('type="number"')) {
        owners.push(path);
      }
    }
    expect(owners).toEqual([]);
  });
});
