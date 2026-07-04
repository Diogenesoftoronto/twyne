import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { consumeRateLimit, RateLimitError } from "./lib/rateLimit";

/**
 * Signups for the not-yet-shipped iOS/Android apps. Public and
 * unauthenticated — this runs from the downloads page for signed-out
 * visitors, so identity/authorization checks don't apply here.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const join = mutation({
  args: {
    email: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return { ok: false as const, error: "Enter a valid email address." };
    }

    try {
      await consumeRateLimit(ctx, {
        action: "waitlist:join",
        identifier: email,
        limit: 5,
        windowMs: 60_000,
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return { ok: false as const, error: err.message };
      }
      throw err;
    }

    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email_platform", (q) =>
        q.eq("email", email).eq("platform", args.platform),
      )
      .unique();

    if (existing) {
      return { ok: true as const, alreadyJoined: true };
    }

    await ctx.db.insert("waitlist", {
      email,
      platform: args.platform,
      createdAt: Date.now(),
    });
    return { ok: true as const, alreadyJoined: false };
  },
});
