import { beforeEach, describe, expect, test } from "bun:test";
import {
  __resetSystemOneBudgetForTests,
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "./system-one-budget";

beforeEach(() => __resetSystemOneBudgetForTests());

describe("shared System One budget", () => {
  test("allows twelve calls a minute across every caller", () => {
    for (let i = 0; i < 12; i++) {
      expect(systemOneWait(1000 + i)).toBe(0);
      spendSystemOne(1000 + i);
    }
    expect(systemOneWait(1012)).toBe(60_000 - 12);
    expect(systemOneWait(61_001)).toBe(0);
  });

  test("a failure quiets every caller for thirty seconds", () => {
    backOffSystemOne(5000);
    expect(systemOneWait(5000)).toBe(30_000);
    expect(systemOneWait(35_000)).toBe(0);
  });
});
