import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id.tokenIdentifier;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    const entry = await ctx.db
      .query("lixBlobs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return entry ?? null;
  },
});

export const upsert = mutation({
  args: { blob: v.bytes() },
  handler: async (ctx, { blob }) => {
    const userId = await requireIdentity(ctx);
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
