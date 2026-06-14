/**
 * Writer-authored inline comments. The CommentMark in the manuscript
 * holds the id; the body, replies, and resolve state live in these
 * tables. Mirrors `personaNotes`/`personaReplies` but for human
 * comments — kept as a separate table so the data model is clean
 * (user comments are not editorial feedback, even when the UI looks
 * the same).
 *
 * All mutations are auth-gated to the calling user. No userId
 * arguments — the Convex auth guideline is non-negotiable.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/* ── Comments ──────────────────────────────────────────────────── */

export const addComment = mutation({
  args: {
    commentId: v.string(),
    folioId: v.string(),
    text: v.string(),
    author: v.string(),
    anchor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;

    const now = Date.now();
    return await ctx.db.insert("userComments", {
      ownerId,
      commentId: args.commentId,
      folioId: args.folioId,
      text: args.text,
      author: args.author,
      anchor: args.anchor,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCommentText = mutation({
  args: {
    commentId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { commentId, text }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const row = await ctx.db
      .query("userComments")
      .withIndex("by_ownerId_commentId", (q) =>
        q.eq("ownerId", ownerId).eq("commentId", commentId),
      )
      .first();
    if (!row) throw new Error("Comment not found");
    await ctx.db.patch(row._id, { text, updatedAt: Date.now() });
  },
});

export const resolveComment = mutation({
  args: { commentId: v.string() },
  handler: async (ctx, { commentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const row = await ctx.db
      .query("userComments")
      .withIndex("by_ownerId_commentId", (q) =>
        q.eq("ownerId", ownerId).eq("commentId", commentId),
      )
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      resolved: !row.resolved,
      updatedAt: Date.now(),
    });
  },
});

export const deleteComment = mutation({
  args: { commentId: v.string() },
  handler: async (ctx, { commentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const row = await ctx.db
      .query("userComments")
      .withIndex("by_ownerId_commentId", (q) =>
        q.eq("ownerId", ownerId).eq("commentId", commentId),
      )
      .first();
    if (!row) return;
    await ctx.db.delete(row._id);
    // Cascade: remove replies too.
    const replies = await ctx.db
      .query("userCommentReplies")
      .withIndex("by_ownerId_commentId", (q) =>
        q.eq("ownerId", ownerId).eq("commentId", commentId),
      )
      .collect();
    for (const r of replies) {
      await ctx.db.delete(r._id);
    }
  },
});

export const listComments = query({
  args: { folioId: v.optional(v.string()) },
  handler: async (ctx, { folioId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = identity.tokenIdentifier;
    const all = await ctx.db
      .query("userComments")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    return all
      .filter((c) => !folioId || c.folioId === folioId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({
        commentId: c.commentId,
        folioId: c.folioId,
        text: c.text,
        author: c.author,
        anchor: c.anchor,
        resolved: c.resolved,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
  },
});

/* ── Replies ──────────────────────────────────────────────────── */

export const addReply = mutation({
  args: {
    replyId: v.string(),
    commentId: v.string(),
    author: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    return await ctx.db.insert("userCommentReplies", {
      ownerId,
      replyId: args.replyId,
      commentId: args.commentId,
      author: args.author,
      text: args.text,
      createdAt: Date.now(),
    });
  },
});

export const listReplies = query({
  args: { commentId: v.optional(v.string()) },
  handler: async (ctx, { commentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = identity.tokenIdentifier;
    if (commentId) {
      const rows = await ctx.db
        .query("userCommentReplies")
        .withIndex("by_ownerId_commentId", (q) =>
          q.eq("ownerId", ownerId).eq("commentId", commentId),
        )
        .collect();
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    }
    const rows = await ctx.db
      .query("userCommentReplies")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const deleteReply = mutation({
  args: { replyId: v.string() },
  handler: async (ctx, { replyId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const rows = await ctx.db
      .query("userCommentReplies")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    const target = rows.find((r) => r.replyId === replyId);
    if (target) {
      await ctx.db.delete(target._id);
    }
  },
});
