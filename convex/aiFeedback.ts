import { internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";

const reasonValidator = v.optional(
  v.union(
    v.literal("grounding"),
    v.literal("usefulness"),
    v.literal("tone"),
    v.literal("incorrect"),
    v.literal("too_long"),
    v.literal("other"),
  ),
);

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity.tokenIdentifier;
}

export const submit = mutation({
  args: {
    traceId: v.string(),
    spanId: v.optional(v.string()),
    feature: v.string(),
    sentiment: v.union(v.literal("positive"), v.literal("negative")),
    reason: reasonValidator,
    comment: v.optional(v.string()),
    folioId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    editorialActionId: v.optional(v.string()),
  },
  returns: v.id("aiFeedback"),
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const comment = args.comment?.trim();
    if (comment && comment.length > 1000) {
      throw new Error("Feedback comment is too long");
    }

    return await ctx.db.insert("aiFeedback", {
      userId,
      traceId: args.traceId,
      spanId: args.spanId,
      feature: args.feature,
      sentiment: args.sentiment,
      reason: args.reason,
      comment: comment || undefined,
      folioId: args.folioId,
      sessionId: args.sessionId,
      editorialActionId: args.editorialActionId,
      reviewStatus: args.sentiment === "negative" ? "pending" : "not_required",
      createdAt: Date.now(),
    });
  },
});

/** Internal-only feed for a future authenticated reviewer surface. */
export const listPending = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    return await ctx.db
      .query("aiFeedback")
      .withIndex("by_reviewStatus_createdAt", (q) =>
        q.eq("reviewStatus", "pending"),
      )
      .order("asc")
      .take(limit);
  },
});
