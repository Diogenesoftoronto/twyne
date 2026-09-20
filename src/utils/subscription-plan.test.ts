import { describe, expect, test } from "bun:test";
import { hasCurrentTwynePlan, TWYNE_PRO_PLAN } from "./subscription-plan";

describe("Twyne provider subscription display", () => {
  const row = {
    product: "twyne",
    plan: TWYNE_PRO_PLAN.id,
    status: "active",
    currentPeriodEnd: 2000,
  };
  test("accepts only a current Twyne subscription from wallet state", () => {
    expect(hasCurrentTwynePlan({ subscriptions: [row] }, 1000)).toBe(true);
    for (const patch of [
      { product: "keating" },
      { plan: "twyne_pro" },
      { status: "canceled" },
      { currentPeriodEnd: 999 },
      { currentPeriodEnd: undefined },
    ]) {
      expect(
        hasCurrentTwynePlan({ subscriptions: [{ ...row, ...patch }] }, 1000),
      ).toBe(false);
    }
  });
  test("checkout redirects and malformed state do not grant subscription status", () => {
    for (const value of [
      undefined,
      null,
      {},
      { checkout: "success" },
      { subscriptions: {} },
      { subscriptions: [null] },
    ]) {
      expect(hasCurrentTwynePlan(value, 1000)).toBe(false);
    }
  });
});
