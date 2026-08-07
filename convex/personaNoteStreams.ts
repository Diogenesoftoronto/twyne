/**
 * Live persona notes for the hosted path.
 *
 * The client-side path streams straight into the panel's store. The server
 * path had no equivalent: `runLlm` awaited a whole generation and returned it
 * in one jump, which on a model that thinks before answering leaves the card
 * blank for the entire time it is working.
 *
 * Same arrangement as {@link ./interviewStreams}: the action writes snapshots
 * as they arrive, the panel subscribes by `streamId`, and rows are cleared
 * once the real notes are filed. Keyed additionally by `personaId` so the five
 * editors of a convened room each fill their own card.
 */
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { applicationError } from "./lib/applicationErrors";

const phaseValidator = v.union(v.literal("reasoning"), v.literal("answer"));
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

/** Every persona's in-flight note for one convened room. */
export const list = query({
  args: { streamId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authenticatedUserId(ctx);
    return await ctx.db
      .query("personaNoteStreams")
      .withIndex("by_userId_streamId", (q) =>
        q.eq("userId", userId).eq("streamId", args.streamId),
      )
      .collect();
  },
});

export const write = internalMutation({
  args: {
    userId: v.string(),
    streamId: v.string(),
    personaId: v.string(),
    text: v.string(),
    reasoning: v.string(),
    phase: phaseValidator,
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("personaNoteStreams")
      .withIndex("by_userId_streamId_personaId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("streamId", args.streamId)
          .eq("personaId", args.personaId),
      )
      .unique();
    const value = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("personaNoteStreams", value);
  },
});

/** Drop the whole room's in-flight rows once the notes are filed. */
export const clear = mutation({
  args: { streamId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authenticatedUserId(ctx);
    const rows = await ctx.db
      .query("personaNoteStreams")
      .withIndex("by_userId_streamId", (q) =>
        q.eq("userId", userId).eq("streamId", args.streamId),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
