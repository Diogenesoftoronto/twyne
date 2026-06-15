import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Per-user state, synced from the browser on sign-up and on every change. ──
  briefs: defineTable({
    userId: v.string(),
    brief: v.any(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  folios: defineTable({
    userId: v.string(),
    folios: v.array(v.any()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  folioContent: defineTable({
    userId: v.string(),
    folioId: v.string(),
    html: v.string(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_folioId", ["userId", "folioId"]),

  customPersonas: defineTable({
    userId: v.string(),
    personas: v.array(v.any()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Persona feedback notes — the room's marginalia, persisted per user. ──
  // Stored server-side so a signed-in user can re-read their notes across
  // devices. Brief is denormalized so the panel can render summaries cheaply.
  personaNotes: defineTable({
    userId: v.string(),
    noteId: v.string(),
    personaId: v.string(),
    personaName: v.string(),
    personaColor: v.string(),
    type: v.union(
      v.literal("encouragement"),
      v.literal("suggestion"),
      v.literal("critique"),
      v.literal("perspective"),
    ),
    feedback: v.string(),
    anchor: v.optional(v.string()),
    briefTitle: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_noteId", ["userId", "noteId"]),

  // ── Threaded replies to persona notes, optionally re-prompting the agent. ──
  personaReplies: defineTable({
    userId: v.string(),
    noteId: v.string(),
    replyId: v.string(),
    author: v.string(),
    authorKind: v.union(v.literal("user"), v.literal("persona")),
    personaId: v.optional(v.string()),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_noteId", ["userId", "noteId"]),

  // ── Rubric results — one per user, latest wins. ──
  rubricResults: defineTable({
    userId: v.string(),
    result: v.any(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Editorial change proposals (editors propose edits to the manuscript). ──
  suggestions: defineTable({
    userId: v.string(),
    suggestionId: v.string(),
    versionId: v.string(),
    personaId: v.string(),
    personaName: v.string(),
    color: v.string(),
    blockId: v.string(),
    original: v.string(),
    replacement: v.string(),
    rationale: v.string(),
    kind: v.union(v.literal("sentence"), v.literal("paragraph")),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_suggestionId", ["userId", "suggestionId"]),

  // ── Room settings (tunable assistance) — one per user, latest wins. ──
  roomSettings: defineTable({
    userId: v.string(),
    settings: v.any(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Lix snapshots (existing). ──
  lixBlobs: defineTable({
    userId: v.string(),
    blob: v.bytes(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Published pieces — public read-by-slug, owner-only writes. ──
  // Each row is a snapshot of a folio at publish time. The slug is the
  // ── Published pieces (post + blog). Same table — kind
  // discriminates. The internal share view is at /p/[slug] for
  // both kinds; the blog stream at /blog only shows "blog"
  // pieces authored by an admin. The ownerId index is for the
  // signed-in user's "my pieces" list; (kind, publishedAt) is
  // for the public blog feed. ──
  published: defineTable({
    ownerId: v.string(),
    slug: v.string(),
    folioId: v.string(),
    kind: v.union(v.literal("post"), v.literal("blog")),
    title: v.string(),
    authorName: v.optional(v.string()),
    briefSummary: v.optional(v.string()),
    content: v.string(), // sanitized HTML
    publishedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_ownerId", ["ownerId"])
    .index("by_kind_publishedAt", ["kind", "publishedAt"]),

  // ── Admin roster. One row per user who can publish to the
  // public blog. The first admin bootstraps via
  // `admins.bootstrap`; subsequent additions are gated on
  // the caller already being an admin. ──
  admins: defineTable({
    userId: v.string(),
    addedBy: v.optional(v.string()),
    addedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Writer-authored inline comments (margin notes, with threads). ──
  // The CommentMark in the manuscript holds the id; the body, replies,
  // and resolve state live here. Owner-only.
  userComments: defineTable({
    ownerId: v.string(),
    commentId: v.string(),
    folioId: v.string(),
    text: v.string(),
    author: v.string(),
    anchor: v.optional(v.string()),
    resolved: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_commentId", ["ownerId", "commentId"]),

  userCommentReplies: defineTable({
    ownerId: v.string(),
    replyId: v.string(),
    commentId: v.string(),
    author: v.string(),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_commentId", ["ownerId", "commentId"]),

  // ── Creem subscriptions — one row per user, updated by the Creem webhook. ──
  // `status` mirrors Creem's subscription lifecycle; `active`/`trialing` grant
  // the Pro tier. Keyed by userId, with a Creem-id index for webhook upserts.
  subscriptions: defineTable({
    userId: v.string(),
    email: v.optional(v.string()),
    productId: v.string(),
    status: v.string(), // active | trialing | canceled | expired | unpaid | incomplete
    creemCustomerId: v.optional(v.string()),
    creemSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_creemSubscriptionId", ["creemSubscriptionId"]),
});
