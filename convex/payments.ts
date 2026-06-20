/**
 * Creem payments — checkout creation + subscription state.
 *
 * The secret `CREEM_API_KEY` only ever lives here (server-side); the client
 * calls `createCheckout` and is handed a hosted Creem `checkout_url`. Creem
 * later POSTs to `/creem/webhook` (see `http.ts`), which verifies the
 * signature and calls `applyCreemEvent` to record entitlement.
 *
 * The buyer is correlated across the redirect by `request_id` = the user's
 * token identifier, which Creem echoes back in the webhook payload.
 */
import {
  action,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { creemApiBase } from "./lib/creem";
import { proProductIds } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";

/** Create a Creem checkout session for the signed-in user, return its URL. */
export const createCheckout = action({
  args: { productId: v.string() },
  handler: async (ctx, { productId }): Promise<{ checkoutUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");

    // Rate limit: a user can spin up at most 10 checkouts per minute. Each
    // one is a network call to Creem and a row in the audit trail; beyond
    // this is almost certainly a stuck retry loop or abuse.
    await consumeRateLimit(ctx, {
      action: "checkout:create",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.checkoutCreate,
    });

    // Server-side product allowlist: the client may only check out a product we
    // recognise as Pro. This stops a cheaper or unrelated product id from being
    // used to obtain a "Pro" subscription for less than the Pro price.
    const allowlist = proProductIds();
    if (allowlist.length === 0) {
      throw new Error("Checkout is not configured (no Pro product ids).");
    }
    if (!allowlist.includes(productId)) {
      throw new Error("Unknown product.");
    }

    const apiKey = process.env.CREEM_API_KEY;
    if (!apiKey) throw new Error("CREEM_API_KEY is not configured");

    const res = await fetch(
      `${creemApiBase(apiKey, process.env.CREEM_API_BASE)}/checkouts`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          product_id: productId,
          request_id: identity.tokenIdentifier,
          success_url: process.env.CREEM_SUCCESS_URL,
          metadata: {
            userId: identity.tokenIdentifier,
            referenceId: identity.tokenIdentifier,
            email: identity.email ?? "",
          },
          ...(identity.email ? { customer: { email: identity.email } } : {}),
        }),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Creem checkout failed (${res.status}): ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as { checkout_url?: string };
    if (!data.checkout_url) {
      throw new Error("Creem did not return a checkout_url");
    }
    return { checkoutUrl: data.checkout_url };
  },
});

/** The signed-in user's subscription, or null. */
export const getMySubscription = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
      .unique();
    return row;
  },
});

export const getSubscriptionByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

/**
 * Apply a verified Creem webhook event to a user's subscription. Called only
 * by the webhook httpAction (which has already checked the signature and
 * parsed the event via `parseCreemEvent`), so it is an internal mutation —
 * never exposed to clients.
 *
 * Hardening over the old `upsertSubscription`:
 *   • Idempotency — a replayed event (same `eventId`) is a no-op.
 *   • Ordering — an event older than the latest applied is ignored, so an
 *     out-of-order or stale delivery can't downgrade a renewed subscription.
 *   • Product allowlist is enforced at entitlement time (`isProSubscription`),
 *     so a non-Pro product recorded here never grants Pro.
 */
export const applyCreemEvent = internalMutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    productId: v.string(),
    status: v.string(),
    creemCustomerId: v.optional(v.string()),
    creemSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    eventId: v.optional(v.string()),
    eventCreatedAt: v.optional(v.number()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotency: if we've already recorded this event id, stop — the
    // subscription already reflects it.
    if (args.eventId) {
      const seen = await ctx.db
        .query("webhookEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId!))
        .first();
      if (seen) return { skipped: "duplicate" };
      await ctx.db.insert("webhookEvents", {
        eventId: args.eventId,
        eventType: args.eventType ?? "",
        createdAt: Date.now(),
      });
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    // Ordering guard: ignore events older than the latest we've applied.
    // Protects against a delayed/redelivered event reverting a newer state.
    if (
      existing &&
      typeof existing.lastEventAt === "number" &&
      typeof args.eventCreatedAt === "number" &&
      args.eventCreatedAt < existing.lastEventAt
    ) {
      return { skipped: "stale" };
    }

    const now = Date.now();
    const { eventId, eventCreatedAt, eventType, ...subscriptionFields } = args;
    const patch = {
      ...subscriptionFields,
      lastEventId: eventId ?? undefined,
      lastEventAt: eventCreatedAt ?? undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("subscriptions", patch);
    }
    return { ok: true };
  },
});
