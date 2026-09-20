import { expect, test } from "bun:test";
import { providerCheckoutSelection } from "../convex/lib/providerCheckout";
import { availableCreditPacks } from "../src/utils/subscription-plan";

test("free credit purchase is independent of Pro configuration", () => {
  for (const amount of [10, 25, 50]) {
    const packId = `twyne_credit_${amount}`;
    expect(
      providerCheckoutSelection({ packId }, { NOTORGANIC_ENABLED: "true" }),
    ).toEqual({ pack_id: packId });
  }
});
test("checkout rejects disabled, unknown and ambiguous purchases", () => {
  expect(() =>
    providerCheckoutSelection({ packId: "twyne_credit_10" }, {}),
  ).toThrow();
  for (const input of [
    { packId: "twyne_credit_1" },
    { packId: "twyne_credit_10", planId: "twyne_pro_v2" },
    { planId: "twyne_pro_v2" },
  ]) {
    expect(() =>
      providerCheckoutSelection(input, {
        NOTORGANIC_ENABLED: "true",
      }),
    ).toThrow();
  }
});
test("only provider-confirmed Twyne packs are displayed as available", () => {
  expect(
    availableCreditPacks({
      checkout: {
        available: true,
        packIds: ["twyne_credit_10", "other_credit_25", "twyne_credit_1", null],
      },
    }),
  ).toEqual(["twyne_credit_10"]);
  expect(availableCreditPacks({ checkout: "success" })).toEqual([]);
  expect(availableCreditPacks(null)).toEqual([]);
});
