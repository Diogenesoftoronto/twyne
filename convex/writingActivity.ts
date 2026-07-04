/**
 * Per-day writing activity, for the public "days writing" heatmap on the
 * author profile page. `recordActivity` is called (throttled, client-side)
 * whenever the editor autosaves; `getPublicActivity` reads it back by handle
 * for anyone viewing that writer's profile — same "no userId argument"
 * auth contract as `convex/sync.ts`, since recording is always about the
 * calling user's own activity.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { normalizeHandle } from "./profiles";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id.tokenIdentifier;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const recordActivity = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    await consumeRateLimit(ctx, {
      action: "writingActivity:record",
      identifier: userId,
      ...RATE_LIMITS.writingActivity,
    });

    const day = todayUtc();
    const now = Date.now();
    const existing = await ctx.db
      .query("writingActivity")
      .withIndex("by_userId_day", (q) =>
        q.eq("userId", userId).eq("day", day),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("writingActivity", {
      userId,
      day,
      count: 1,
      updatedAt: now,
    });
  },
});

export const getPublicActivity = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const normalized = normalizeHandle(handle);
    const handleRow = await ctx.db
      .query("handles")
      .withIndex("by_handle", (q) => q.eq("handle", normalized))
      .unique();
    if (!handleRow) return null;

    const userId = handleRow.userId;
    const days = await ctx.db
      .query("writingActivity")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const folioRow = await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const folioCount = Array.isArray(folioRow?.folios)
      ? folioRow.folios.length
      : 0;

    return {
      days: days.map((d) => ({ day: d.day, count: d.count })),
      folioCount,
    };
  },
});
