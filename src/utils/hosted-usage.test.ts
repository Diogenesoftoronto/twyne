import { describe, expect, test } from "bun:test";
import { summarizeHostedUsage } from "./hosted-usage";

const range = { from: 100, to: 200 };
const row = (overrides: Record<string, unknown> = {}) => ({
  requestId: "request-a",
  product: "twyne",
  createdAt: 150,
  state: "succeeded",
  billedMicros: 1234,
  ...overrides,
});

describe("hosted billing evidence", () => {
  test("counts only settled Twyne charges in the selected half-open range, once", () => {
    expect(
      summarizeHostedUsage(
        {
          data: [
            row(),
            row(),
            row({ requestId: "other-product", product: "keating" }),
            row({ requestId: "old", createdAt: 99 }),
            row({ requestId: "future", createdAt: 200 }),
            row({ requestId: "start", createdAt: 100, billedMicros: 0 }),
          ],
        },
        range,
      ),
    ).toEqual({
      billedMicrousd: 1234,
      settledRequests: 2,
      unresolvedRequests: 0,
      unverifiedCostRequests: 0,
      unverifiedCostMicrousd: 0,
      truncated: false,
    });
  });
  test("reservations and reconciliations never become confirmed charges", () => {
    expect(
      summarizeHostedUsage(
        {
          data: [
            row({ state: "running", billedMicros: 5000 }),
            row({
              requestId: "reconcile",
              state: "reconciliation_required",
              billedMicros: 5000,
            }),
            row({ requestId: "missing", billedMicros: null }),
            row({ requestId: "invalid", billedMicros: -1 }),
            row({ requestId: "failed", state: "failed", billedMicros: null }),
          ],
        },
        range,
      ),
    ).toEqual({
      billedMicrousd: 0,
      settledRequests: 0,
      unresolvedRequests: 4,
      unverifiedCostRequests: 0,
      unverifiedCostMicrousd: 0,
      truncated: false,
    });
  });
  test("discloses conservative wallet charges stored as succeeded by the gateway", () => {
    const summary = summarizeHostedUsage(
      {
        data: [
          row(),
          row({
            requestId: "conservative",
            billedMicros: 50000,
            reconciliationReason: "upstream_cost_unavailable",
          }),
        ],
      },
      range,
    );
    expect(summary.billedMicrousd).toBe(51234);
    expect(summary.settledRequests).toBe(2);
    expect(summary.unverifiedCostRequests).toBe(1);
    expect(summary.unverifiedCostMicrousd).toBe(50000);
  });
  test("marks a full account feed as partial even when other products fill it", () => {
    const data = Array.from({ length: 100 }, (_, i) =>
      row({ requestId: String(i), product: "keating" }),
    );
    expect(
      summarizeHostedUsage({ data }, { from: null, to: 200 }).truncated,
    ).toBe(true);
  });
  test("malformed responses cannot be presented as zero charges", () => {
    for (const payload of [
      null,
      {},
      { data: [null] },
      { data: [row({ createdAt: "150" })] },
    ]) {
      expect(() => summarizeHostedUsage(payload, range)).toThrow();
    }
  });
});
