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
  // discriminates. The reader route is /<handle>/<slug> for writers who
  // have claimed a handle, falling back to /p/[slug] for legacy links.
  // The blog stream at /blog only shows "blog" pieces authored by an
  // admin. The ownerId index is for the signed-in user's "my pieces"
  // list; (kind, publishedAt) is for the public blog feed.
  // `ownerHandle` is denormalized at publish time so the reader route
  // can resolve without an extra hop; it's null until the owner has
  // claimed a handle (legacy pieces backfill on next publish). ──
  published: defineTable({
    ownerId: v.string(),
    ownerHandle: v.optional(v.string()),
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
    .index("by_ownerHandle_slug", ["ownerHandle", "slug"])
    .index("by_ownerHandle_kind_publishedAt", [
      "ownerHandle",
      "kind",
      "publishedAt",
    ])
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

  // ── Writer handles — one per user, claimed on first publish or from
  // Settings. The handle is the public identity on share URLs
  // (/<handle>/<slug>) and profile pages (/<handle>). Lowercase,
  // slugified, validated in convex/profiles.ts. By-handle index is
  // unique. ──
  handles: defineTable({
    userId: v.string(),
    handle: v.string(),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    claimedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_handle", ["handle"]),

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
  // `status` mirrors Creem's subscription lifecycle; `active`/`trialing` plus a
  // product in the Pro allowlist and a current period grant the Pro tier (see
  // convex/lib/entitlement.ts). Keyed by userId, with a Creem-id index for
  // webhook upserts. `lastEventId`/`lastEventAt` guard against stale or
  // replayed webhook events.
  subscriptions: defineTable({
    userId: v.string(),
    email: v.optional(v.string()),
    productId: v.string(),
    status: v.string(), // active | trialing | canceled | expired | unpaid | incomplete
    creemCustomerId: v.optional(v.string()),
    creemSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    // Idempotency / ordering: the Creem event id and timestamp we last
    // applied. Older or duplicate events are ignored by applyCreemEvent.
    lastEventId: v.optional(v.string()),
    lastEventAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_creemSubscriptionId", ["creemSubscriptionId"]),

  // ── Webhook event audit log — one row per processed Creem event. ──
  // Used for idempotency: a replayed event (same id) is a no-op. Also an
  // audit trail of which event types we've seen.
  webhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    createdAt: v.number(),
  }).index("by_eventId", ["eventId"]),

  // Populated only when E2E_OTP_SECRET is configured on a test deployment.
  e2eOtps: defineTable({
    email: v.string(),
    otp: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  /* ── Multiplayer: shared Lix documents ──
   * When a Pro user shares a folio, its local Lix blob is promoted to a
   * server-hosted instance. Collaborators open it with Lix sync enabled and
   * `initSyncProcess` pushes/pulls change-sets through the /lsp/* relay. */

  sharedLixBlobs: defineTable({
    lixId: v.string(),
    ownerId: v.string(),
    folioId: v.string(),
    folioName: v.string(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lixId", ["lixId"])
    .index("by_ownerId", ["ownerId"]),

  // ── Push-serialization locks — one row per in-flight push. ──
  // Prevents two concurrent /lsp/push-v1 requests from both reading the
  // same base blob and the later write clobbering the earlier one.
  // Stale locks (older than LIX_LOCK_TTL_MS) are reclaimed automatically.
  lixLocks: defineTable({
    lixId: v.string(),
    lockedAt: v.number(),
  }).index("by_lixId", ["lixId"]),

  collaborators: defineTable({
    lixId: v.string(),
    userId: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("editor"),
      v.literal("commenter"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    invitedBy: v.optional(v.string()),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_lixId", ["lixId"])
    .index("by_userId", ["userId"])
    .index("by_lixId_userId", ["lixId", "userId"]),

  presence: defineTable({
    lixId: v.string(),
    userId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    color: v.string(),
    cursorPos: v.optional(v.number()),
    selectionAnchor: v.optional(v.number()),
    selectionHead: v.optional(v.number()),
    lastSeenAt: v.number(),
  })
    .index("by_lixId", ["lixId"])
    .index("by_lixId_userId", ["lixId", "userId"]),

  // ── Rate-limit buckets — one row per (action, identifier). ──
  // Identifier is usually the user's Convex tokenIdentifier; for
  // unauthed paths (OTP request) it's the email or IP. `count` is
  // reset when `windowStart` is older than the action's window.
  // See convex/lib/rateLimit.ts.
  rateBuckets: defineTable({
    action: v.string(),
    identifier: v.string(),
    count: v.number(),
    windowStart: v.number(),
  }).index("by_action_identifier", ["action", "identifier"]),
});
