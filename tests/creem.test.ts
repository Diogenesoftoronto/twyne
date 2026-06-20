import { describe, expect, test } from "bun:test";
import {
  ACCEPTED_EVENT_TYPES,
  creemApiBase,
  parseCreemEvent,
  parseCreemSubscriptionUpdate,
} from "../convex/lib/creem";

describe("Creem environment selection", () => {
  test("routes test keys to the isolated test API", () => {
    expect(creemApiBase("creem_test_example")).toBe(
      "https://test-api.creem.io/v1",
    );
  });

  test("routes live keys to production and permits an explicit override", () => {
    expect(creemApiBase("creem_live_example")).toBe("https://api.creem.io/v1");
    expect(creemApiBase("creem_test_example", "http://mock.test/v1/")).toBe(
      "http://mock.test/v1",
    );
  });
});

describe("Creem webhook normalization", () => {
  test("normalizes a subscription.active event", () => {
    expect(
      parseCreemSubscriptionUpdate({
        eventType: "subscription.active",
        object: {
          id: "sub_test",
          status: "active",
          request_id: "user_test",
          product: { id: "prod_test" },
          customer: { id: "cust_test", email: "writer@example.com" },
          current_period_end_date: "2026-07-19T00:00:00.000Z",
        },
      }),
    ).toEqual({
      userId: "user_test",
      email: "writer@example.com",
      productId: "prod_test",
      status: "active",
      creemCustomerId: "cust_test",
      creemSubscriptionId: "sub_test",
      currentPeriodEnd: Date.parse("2026-07-19T00:00:00.000Z"),
    });
  });

  test("uses checkout metadata for correlation", () => {
    expect(
      parseCreemSubscriptionUpdate({
        eventType: "checkout.completed",
        object: {
          request_id: "user_checkout",
          status: "completed",
          order: { product: "prod_checkout" },
          metadata: { email: "checkout@example.com" },
        },
      }),
    ).toMatchObject({
      userId: "user_checkout",
      email: "checkout@example.com",
      productId: "prod_checkout",
      status: "completed",
    });
  });

  test("ignores uncorrelated events", () => {
    expect(parseCreemSubscriptionUpdate({ object: { status: "active" } })).toBe(
      null,
    );
  });
});

describe("Creem event allowlist + idempotency (parseCreemEvent)", () => {
  test("accepts a known event and surfaces its id + timestamp", () => {
    const parsed = parseCreemEvent({
      eventType: "subscription.active",
      id: "evt_1",
      created_at: "2026-07-19T00:00:00.000Z",
      object: {
        id: "sub_test",
        status: "active",
        request_id: "user_test",
        product: { id: "prod_pro" },
        customer: { id: "cust_test", email: "w@example.com" },
        current_period_end_date: "2026-07-19T00:00:00.000Z",
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.eventType).toBe("subscription.active");
    expect(parsed!.eventId).toBe("evt_1");
    expect(parsed!.eventCreatedAt).toBe(Date.parse("2026-07-19T00:00:00.000Z"));
    expect(parsed!.update.userId).toBe("user_test");
    expect(parsed!.update.productId).toBe("prod_pro");
  });

  test("rejects an event type outside the allowlist", () => {
    expect(
      parseCreemEvent({
        eventType: "refund.created",
        id: "evt_x",
        object: { request_id: "u", status: "active", product: { id: "p" } },
      }),
    ).toBeNull();
    // The allowlist is deliberately narrow and stable.
    expect(ACCEPTED_EVENT_TYPES.has("subscription.active")).toBe(true);
    expect(ACCEPTED_EVENT_TYPES.has("refund.created")).toBe(false);
  });

  test("ignores an accepted type that can't be correlated to a user", () => {
    expect(
      parseCreemEvent({
        eventType: "subscription.active",
        id: "evt_y",
        object: { status: "active", product: { id: "p" } },
      }),
    ).toBeNull();
  });

  test("tolerates missing id and timestamp", () => {
    const parsed = parseCreemEvent({
      eventType: "subscription.canceled",
      object: {
        status: "canceled",
        request_id: "user_z",
        product: { id: "prod_pro" },
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.eventId).toBeNull();
    expect(parsed!.eventCreatedAt).toBeNull();
    expect(parsed!.update.userId).toBe("user_z");
  });
});
