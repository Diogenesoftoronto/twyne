/**
 * Creem payments — checkout creation + subscription state.
 *
 * The secret `CREEM_API_KEY` only ever lives here (server-side); the client
 * calls `createCheckout` and is handed a hosted Creem `checkout_url`. Creem
 * later POSTs to `/creem/webhook` (see `http.ts`), which verifies the
 * signature and calls `upsertSubscription` to record entitlement.
 *
 * The buyer is correlated across the redirect by `request_id` = the user's
 * token identifier, which Creem echoes back in the webhook payload.
 */
import { action, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const CREEM_API_BASE = "https://api.creem.io/v1";

/** Create a Creem checkout session for the signed-in user, return its URL. */
export const createCheckout = action({
  args: { productId: v.string() },
  handler: async (ctx, { productId }): Promise<{ checkoutUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");

    const apiKey = process.env.CREEM_API_KEY;
    if (!apiKey) throw new Error("CREEM_API_KEY is not configured");

    const res = await fetch(`${CREEM_API_BASE}/checkouts`, {
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
    });

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

/**
 * Upsert a subscription from a verified Creem webhook. Called only by the
 * webhook httpAction (which has already checked the signature), so it is an
 * internal mutation — never exposed to clients.
 */
export const upsertSubscription = internalMutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    productId: v.string(),
    status: v.string(),
    creemCustomerId: v.optional(v.string()),
    creemSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const patch = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("subscriptions", patch);
    }
  },
});
