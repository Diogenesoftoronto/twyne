import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const entry = await ctx.db
      .query("lixBlobs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return entry ?? null;
  },
});

export const upsert = mutation({
  args: { userId: v.string(), blob: v.bytes() },
  handler: async (ctx, { userId, blob }) => {
    const existing = await ctx.db
      .query("lixBlobs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        blob,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("lixBlobs", {
      userId,
      blob,
      updatedAt: Date.now(),
    });
  },
});
