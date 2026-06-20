import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const storeOtp = internalMutation({
  args: { email: v.string(), otp: v.string() },
  handler: async (ctx, { email, otp }) => {
    const existing = await ctx.db
      .query("e2eOtps")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    await Promise.all(existing.map((row) => ctx.db.delete(row._id)));
    await ctx.db.insert("e2eOtps", { email, otp, createdAt: Date.now() });
  },
});

export const getOtp = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const row = await ctx.db
      .query("e2eOtps")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .first();
    if (!row || Date.now() - row.createdAt > 5 * 60_000) return null;
    return { otp: row.otp, createdAt: row.createdAt };
  },
});
