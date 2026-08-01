import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { applicationError } from "./lib/applicationErrors";

const phaseValidator = v.union(
  v.literal("reasoning"),
  v.literal("answer"),
);
const statusValidator = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
);

async function authenticatedUserId(ctx: {
  auth: {
    getUserIdentity: () => Promise<{
      tokenIdentifier: string;
      subject?: string;
    } | null>;
  };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw applicationError("authentication_required");
  return identity.subject || identity.tokenIdentifier;
}

export const get = query({
  args: { streamId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authenticatedUserId(ctx);
    return await ctx.db
      .query("dossierInterviewStreams")
      .withIndex("by_userId_streamId", (q) =>
        q.eq("userId", userId).eq("streamId", args.streamId),
      )
      .unique();
  },
});

export const write = internalMutation({
  args: {
    userId: v.string(),
    streamId: v.string(),
    text: v.string(),
    reasoning: v.string(),
    phase: phaseValidator,
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dossierInterviewStreams")
      .withIndex("by_userId_streamId", (q) =>
        q.eq("userId", args.userId).eq("streamId", args.streamId),
      )
      .unique();
    const value = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("dossierInterviewStreams", value);
  },
});

export const clear = mutation({
  args: { streamId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authenticatedUserId(ctx);
    const existing = await ctx.db
      .query("dossierInterviewStreams")
      .withIndex("by_userId_streamId", (q) =>
        q.eq("userId", userId).eq("streamId", args.streamId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
