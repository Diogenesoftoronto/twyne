/**
 * Admin roster. The blog stream is fed by admin authors — when
 * a signed-in admin publishes a folio, the resulting row in
 * `published` carries `kind: "blog"` and shows up on `/blog`
 * alongside anything they re-publish.
 *
 * Bootstrapping: the very first call to `bootstrap` succeeds
 * only when the table is empty, so a single accidental click
 * can't hand the keys to a random passer-by. Subsequent
 * additions (`add`) require the caller to already be an
 * admin, so the roster can only grow from inside.
 *
 * Auth model: every mutation reads the caller from
 * `ctx.auth.getUserIdentity()` and stores their
 * `tokenIdentifier` as the row's `userId`. There is no
 * `userId` argument — the Convex auth guideline is
 * non-negotiable.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** True when the signed-in caller is in the admin roster. */
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const row = await ctx.db
      .query("admins")
      .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
      .first();
    return row !== null;
  },
});

/**
 * Bootstrap the admin roster. Succeeds only when no admins
 * exist yet — the first person to sign up and call this
 * becomes the inaugural admin. After that, new admins are
 * added via `add`, which requires an existing admin caller.
 */
export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const existing = await ctx.db.query("admins").take(1);
    if (existing.length > 0) {
      throw new Error("Admin roster already bootstrapped");
    }
    await ctx.db.insert("admins", {
      userId: identity.tokenIdentifier,
      addedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Add another admin. Caller must already be an admin. */
export const add = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const callerIsAdmin = await ctx.db
      .query("admins")
      .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
      .first();
    if (!callerIsAdmin) {
      throw new Error("Only admins can add other admins");
    }
    const existing = await ctx.db
      .query("admins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) return { ok: true, alreadyAdmin: true };
    await ctx.db.insert("admins", {
      userId: args.userId,
      addedBy: identity.tokenIdentifier,
      addedAt: Date.now(),
    });
    return { ok: true, alreadyAdmin: false };
  },
});

/** Remove an admin. Caller must already be an admin. */
export const remove = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    if (args.userId === identity.tokenIdentifier) {
      throw new Error("An admin cannot remove themselves");
    }
    const callerIsAdmin = await ctx.db
      .query("admins")
      .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
      .first();
    if (!callerIsAdmin) {
      throw new Error("Only admins can remove other admins");
    }
    const row = await ctx.db
      .query("admins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!row) return { ok: true, missing: true };
    await ctx.db.delete(row._id);
    return { ok: true, missing: false };
  },
});

/** Public-facing list — used by the /blog page footer (if needed). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("admins").collect();
  },
});
