import { beforeEach, expect, test } from "bun:test";
import {
  __resetExtractionBudgetForTests,
  backOffExtraction,
  extractionWait,
  spendExtraction,
} from "./extraction-budget";
beforeEach(__resetExtractionBudgetForTests);
test("all Clairic pause callers share four calls per minute and thirty-second backoff", () => {
  expect(extractionWait(1000)).toBe(0);
  for (let i = 0; i < 4; i++) spendExtraction(1000 + i);
  expect(extractionWait(2000)).toBe(59_000);
  expect(extractionWait(61_000)).toBe(0);
  backOffExtraction(61_000);
  expect(extractionWait(61_001)).toBe(29_999);
  expect(extractionWait(91_000)).toBe(0);
});

test("session spend survives a fresh conductor and expiry of every rate window", () => {
  for (let i = 0; i < 12; i++) {
    expect(extractionWait(i * 61_000)).toBe(0);
    spendExtraction(i * 61_000);
  }
  expect(extractionWait(60 * 60_000)).toBe(Infinity);
});
