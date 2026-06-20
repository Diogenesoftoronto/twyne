import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isProSubscription, proProductIds } from "../convex/lib/entitlement";

const DAY = 24 * 60 * 60 * 1000;
const GRACE = 7 * DAY;

describe("proProductIds allowlist", () => {
  afterEach(() => {
    delete process.env.CREEM_PRO_PRODUCT_IDS;
    delete process.env.PUBLIC_CREEM_PRODUCT_PRO;
  });

  test("parses a comma-separated Pro product list", () => {
    process.env.CREEM_PRO_PRODUCT_IDS = " prod_pro , prod_pro_yearly ,";
    expect(proProductIds()).toEqual(["prod_pro", "prod_pro_yearly"]);
  });

  test("falls back to the public product id in dev/test", () => {
    process.env.PUBLIC_CREEM_PRODUCT_PRO = "pub_pro";
    expect(proProductIds()).toEqual(["pub_pro"]);
  });

  test("returns an empty list when nothing is configured", () => {
    expect(proProductIds()).toEqual([]);
  });
});

describe("isProSubscription", () => {
  beforeEach(() => {
    process.env.CREEM_PRO_PRODUCT_IDS = "prod_pro,prod_pro_yearly";
  });
  afterEach(() => {
    delete process.env.CREEM_PRO_PRODUCT_IDS;
  });

  test("active + Pro product + current period is Pro", () => {
    expect(
      isProSubscription({
        status: "active",
        productId: "prod_pro",
        currentPeriodEnd: Date.now() + 10 * DAY,
      }),
    ).toBe(true);
  });

  test("trialing is Pro", () => {
    expect(
      isProSubscription({
        status: "trialing",
        productId: "prod_pro_yearly",
        currentPeriodEnd: Date.now() + 3 * DAY,
      }),
    ).toBe(true);
  });

  test("canceled is not Pro regardless of product/period", () => {
    expect(
      isProSubscription({
        status: "canceled",
        productId: "prod_pro",
        currentPeriodEnd: Date.now() + 10 * DAY,
      }),
    ).toBe(false);
  });

  test("active but a non-allowlisted product is not Pro", () => {
    expect(
      isProSubscription({
        status: "active",
        productId: "prod_basic",
        currentPeriodEnd: Date.now() + 10 * DAY,
      }),
    ).toBe(false);
  });

  test("active but the period lapsed past the grace window is not Pro", () => {
    expect(
      isProSubscription({
        status: "active",
        productId: "prod_pro",
        currentPeriodEnd: Date.now() - (GRACE + 1 * DAY),
      }),
    ).toBe(false);
  });

  test("active within the grace window still counts (renewal wobble)", () => {
    expect(
      isProSubscription({
        status: "active",
        productId: "prod_pro",
        currentPeriodEnd: Date.now() - 1 * DAY,
      }),
    ).toBe(true);
  });

  test("null / missing row is not Pro", () => {
    expect(isProSubscription(null)).toBe(false);
    expect(isProSubscription(undefined)).toBe(false);
  });

  test("without a configured allowlist, status alone decides", () => {
    delete process.env.CREEM_PRO_PRODUCT_IDS;
    delete process.env.PUBLIC_CREEM_PRODUCT_PRO;
    expect(
      isProSubscription({
        status: "active",
        productId: "anything",
        currentPeriodEnd: Date.now() + DAY,
      }),
    ).toBe(true);
  });
});
