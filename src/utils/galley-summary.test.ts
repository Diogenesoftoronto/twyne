import { describe, expect, test } from "bun:test";
import {
  GALLEY_PANEL_SUMMARY_LENGTH,
  truncateGalleySummary,
} from "./galley-summary";

describe("Galley side-panel summary", () => {
  test("leaves a short summary intact", () => {
    expect(truncateGalleySummary("A concise editorial verdict.")).toBe(
      "A concise editorial verdict.",
    );
  });

  test("limits the side-panel preview to 120 characters", () => {
    const summary = "word ".repeat(40).trim();
    const preview = truncateGalleySummary(summary);
    expect(preview.length).toBeLessThanOrEqual(GALLEY_PANEL_SUMMARY_LENGTH);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).not.toBe(summary);
  });

  test("does not leave whitespace before the ellipsis", () => {
    expect(truncateGalleySummary("123456789   remainder", 12)).toBe(
      "123456789…",
    );
  });
});
