import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One item of a per-user collection.
 *
 * Three collections — folios, custom personas, bibliography entries — used to
 * live as an array inside a single document each. Every edit rewrote the whole
 * document, and the collection could never outgrow Convex's 1MB document cap.
 * These tables replace that arrangement with a row per item.
 *
 * The field and index names are deliberately identical across all three, so a
 * single accessor in `lib/collections.ts` can serve them and they cannot drift
 * apart. `item` stays `v.any()` for the same reason the arrays did: adding a
 * field to a folio should not need a migration.
 */
const collectionEntry = {
  userId: v.string(),
  /** The item's own id, as the client models it. Unique per user per table. */
  itemId: v.string(),
  item: v.any(),
  /** Position in the collection, so the array round-trips in its own order. */
  order: v.number(),
  updatedAt: v.number(),
};

const usageTokenFields = {
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
};

const usagePricingSnapshot = v.object({
  source: v.string(),
  version: v.string(),
  currency: v.literal("USD"),
  inputMicrousdPerMillion: v.number(),
  outputMicrousdPerMillion: v.number(),
  cacheReadMicrousdPerMillion: v.optional(v.number()),
  cacheWriteMicrousdPerMillion: v.optional(v.number()),
  reasoningMicrousdPerMillion: v.optional(v.number()),
  longContextThresholdTokens: v.optional(v.number()),
  longInputMicrousdPerMillion: v.optional(v.number()),
  longOutputMicrousdPerMillion: v.optional(v.number()),
});

const usageMetricFields = {
  generations: v.number(),
  completedGenerations: v.number(),
  failedGenerations: v.number(),
  logicalActions: v.number(),
  completedActions: v.number(),
  failedActions: v.number(),
  actualCostMicrousd: v.number(),
  estimatedCostMicrousd: v.number(),
  localGenerations: v.number(),
  unknownCostGenerations: v.number(),
  creditMicrounits: v.number(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheReadTokens: v.number(),
  cacheWriteTokens: v.number(),
  reasoningTokens: v.number(),
  totalTokens: v.number(),
  inputTokensReported: v.number(),
  outputTokensReported: v.number(),
  cacheReadTokensReported: v.number(),
  cacheWriteTokensReported: v.number(),
  reasoningTokensReported: v.number(),
  totalTokensReported: v.number(),
  inputTokensMissing: v.number(),
  outputTokensMissing: v.number(),
  cacheReadTokensMissing: v.number(),
  cacheWriteTokensMissing: v.number(),
  reasoningTokensMissing: v.number(),
  totalTokensMissing: v.number(),
  reportedTotalDiscrepancies: v.number(),
};

export default defineSchema({
  // Optimistic concurrency head for the bulk browser snapshot. Every push
  // compares the revision it last pulled with this row before writing, so two
  // open devices cannot silently ratify stale state over one another.
  syncHeads: defineTable({
    userId: v.string(),
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  folioEntries: defineTable(collectionEntry)
    .index("by_userId", ["userId"])
    .index("by_userId_itemId", ["userId", "itemId"]),

  personaEntries: defineTable(collectionEntry)
    .index("by_userId", ["userId"])
    .index("by_userId_itemId", ["userId", "itemId"]),

  bibliographyEntries: defineTable(collectionEntry)
    .index("by_userId", ["userId"])
    .index("by_userId_itemId", ["userId", "itemId"]),

  // ── Per-user state, synced from the browser on sign-up and on every change. ──
  briefs: defineTable({
    userId: v.string(),
    folioId: v.optional(v.string()),
    brief: v.any(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_folioId", ["userId", "folioId"]),

  // Ephemeral per-turn output for the hosted dossier interview. Convex actions
  // write cumulative reasoning/text snapshots here while the browser watches
  // the authenticated query; the client removes the row when the turn settles.
  dossierInterviewStreams: defineTable({
    userId: v.string(),
    streamId: v.string(),
    text: v.string(),
    reasoning: v.string(),
    phase: v.union(v.literal("reasoning"), v.literal("answer")),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_streamId", ["userId", "streamId"])
    // The browser clears its own rows when a turn settles. This is for the
    // turns whose browser never came back — a closed tab, a lost connection —
    // so the sweep can find them by age instead of scanning the table.
    .index("by_updatedAt", ["updatedAt"]),

  // The same arrangement for hosted persona notes, keyed by persona so five
  // editors can fill their own cards at once. Without this the server path
  // delivered a note in one silent jump, which on a reasoning model means a
  // blank card for as long as the model thinks.
  personaNoteStreams: defineTable({
    userId: v.string(),
    streamId: v.string(),
    personaId: v.string(),
    text: v.string(),
    reasoning: v.string(),
    phase: v.union(v.literal("reasoning"), v.literal("answer")),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_streamId", ["userId", "streamId"])
    .index("by_userId_streamId_personaId", ["userId", "streamId", "personaId"])
    .index("by_updatedAt", ["updatedAt"]),

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

  // Personal tokens for the CLI and local MCP server. Only a SHA-256 digest
  // is persisted; the clear-text token is returned once when it is created.
  integrationTokens: defineTable({
    userId: v.string(),
    tokenHash: v.string(),
    prefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_tokenHash", ["tokenHash"]),

  // Uploaded manuscript images. The editor stores the resolved URL in its
  // document while this row preserves ownership and the underlying storage
  // id so files can be looked up and deleted safely.
  images: defineTable({
    ownerId: v.string(),
    folioId: v.string(),
    storageId: v.id("_storage"),
    contentType: v.union(
      v.literal("image/gif"),
      v.literal("image/jpeg"),
      v.literal("image/png"),
      v.literal("image/webp"),
    ),
    size: v.number(),
    createdAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_folioId", ["ownerId", "folioId"])
    .index("by_storageId", ["storageId"]),

  // ── Per-day writing activity, for the public "days writing" heatmap on
  // the author profile page. Append-only-ish: one row per (userId, day),
  // upserted as the user writes. ──
  writingActivity: defineTable({
    userId: v.string(),
    day: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_day", ["userId", "day"]),

  writingActivityDetails: defineTable({
    userId: v.string(),
    day: v.string(),
    folioId: v.string(),
    count: v.number(),
    firstOccurredAt: v.number(),
    lastOccurredAt: v.number(),
  })
    .index("by_userId_and_day", ["userId", "day"])
    .index("by_userId_and_day_and_folioId", ["userId", "day", "folioId"]),

  // Content-free, append-only provider-attempt ledger for My Desk. Raw rows
  // and every denormalized aggregate are updated in one mutation.
  aiUsageEvents: defineTable({
    ownerId: v.string(),
    eventKey: v.string(),
    occurredAt: v.number(),
    day: v.string(),
    source: v.union(v.literal("hosted"), v.literal("byok"), v.literal("local")),
    authority: v.union(
      v.literal("server"),
      v.literal("provider"),
      v.literal("client_reported"),
    ),
    feature: v.string(),
    provider: v.string(),
    model: v.string(),
    folioId: v.optional(v.string()),
    editorialActionId: v.optional(v.string()),
    traceId: v.string(),
    attempt: v.number(),
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    ...usageTokenFields,
    costMicrousd: v.optional(v.number()),
    costKind: v.union(
      v.literal("actual"),
      v.literal("estimated"),
      v.literal("local"),
      v.literal("unknown"),
    ),
    pricingVersion: v.optional(v.string()),
    pricing: v.optional(usagePricingSnapshot),
    creditMicrounits: v.optional(v.number()),
  })
    .index("by_ownerId_and_eventKey", ["ownerId", "eventKey"])
    .index("by_ownerId_and_occurredAt", ["ownerId", "occurredAt"])
    .index("by_ownerId_and_editorialActionId_and_outcome", [
      "ownerId",
      "editorialActionId",
      "outcome",
    ]),

  aiUsageDailyTotals: defineTable({
    ownerId: v.string(),
    day: v.string(),
    ...usageMetricFields,
  }).index("by_ownerId_and_day", ["ownerId", "day"]),

  aiUsageDailyBreakdowns: defineTable({
    ownerId: v.string(),
    day: v.string(),
    dimension: v.union(
      v.literal("feature"),
      v.literal("provider_model"),
      v.literal("folio"),
    ),
    key: v.string(),
    ...usageMetricFields,
  })
    .index("by_ownerId_and_dimension_and_day", ["ownerId", "dimension", "day"])
    .index("by_ownerId_and_day_and_dimension_and_key", [
      "ownerId",
      "day",
      "dimension",
      "key",
    ]),

  aiUsageLifetimeTotals: defineTable({
    ownerId: v.string(),
    ...usageMetricFields,
  }).index("by_ownerId", ["ownerId"]),

  aiUsageLifetimeBreakdowns: defineTable({
    ownerId: v.string(),
    dimension: v.union(
      v.literal("feature"),
      v.literal("provider_model"),
      v.literal("folio"),
    ),
    key: v.string(),
    ...usageMetricFields,
  }).index("by_ownerId_and_dimension_and_key", ["ownerId", "dimension", "key"]),

  // Tombstone and resumable cursor for writer-requested synchronized usage
  // deletion. Its presence is also the ingestion barrier for this owner.
  aiUsageDeletionJobs: defineTable({
    ownerId: v.string(),
    phase: v.number(),
    deletedCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerId", ["ownerId"]),

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
    folioId: v.optional(v.string()),
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
    traceId: v.optional(v.string()),
    anchor: v.optional(v.string()),
    briefTitle: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_folioId", ["userId", "folioId"])
    .index("by_userId_noteId", ["userId", "noteId"]),

  // Trace-linked feedback is the durable review queue. Negative feedback is
  // pending human review; positive feedback is retained for cohort analysis.
  aiFeedback: defineTable({
    userId: v.string(),
    traceId: v.string(),
    spanId: v.optional(v.string()),
    feature: v.string(),
    sentiment: v.union(v.literal("positive"), v.literal("negative")),
    reason: v.optional(
      v.union(
        v.literal("grounding"),
        v.literal("usefulness"),
        v.literal("tone"),
        v.literal("incorrect"),
        v.literal("too_long"),
        v.literal("other"),
      ),
    ),
    comment: v.optional(v.string()),
    folioId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    editorialActionId: v.optional(v.string()),
    reviewStatus: v.union(
      v.literal("not_required"),
      v.literal("pending"),
      v.literal("in_review"),
      v.literal("resolved"),
    ),
    createdAt: v.number(),
  })
    .index("by_traceId", ["traceId"])
    .index("by_reviewStatus_createdAt", ["reviewStatus", "createdAt"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  // ── Threaded replies to persona notes, optionally re-prompting the agent. ──
  personaReplies: defineTable({
    userId: v.string(),
    folioId: v.optional(v.string()),
    noteId: v.string(),
    replyId: v.string(),
    author: v.string(),
    authorKind: v.union(v.literal("user"), v.literal("persona")),
    personaId: v.optional(v.string()),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_folioId", ["userId", "folioId"])
    .index("by_userId_noteId", ["userId", "noteId"]),

  // ── Rubric results — one per folio; legacy rows may omit folioId. ──
  rubricResults: defineTable({
    userId: v.string(),
    folioId: v.optional(v.string()),
    result: v.any(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_folioId", ["userId", "folioId"]),

  // ── Editorial change proposals (editors propose edits to the manuscript). ──
  suggestions: defineTable({
    userId: v.string(),
    folioId: v.optional(v.string()),
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
    .index("by_userId_folioId", ["userId", "folioId"])
    .index("by_userId_suggestionId", ["userId", "suggestionId"]),

  // ── Room settings (tunable assistance) — one per user, latest wins. ──
  roomSettings: defineTable({
    userId: v.string(),
    settings: v.any(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Appearance (theme) — one per user, latest wins.
  // Its own table rather than a key inside `roomSettings`: that record is
  // written whole by the personas panel, which knows nothing about themes
  // and would drop the key on every assistance change. `updatedAt` is what
  // decides a local-vs-remote conflict when a second device signs in. ──
  appearance: defineTable({
    userId: v.string(),
    preset: v.string(),
    // Token id -> `#rrggbb`. Validated client-side before it is written into
    // a CSS custom property; stored loosely so adding a themeable token
    // later needs no migration.
    custom: v.optional(v.record(v.string(), v.string())),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Lix snapshots (existing). ──
  lixBlobs: defineTable({
    userId: v.string(),
    blob: v.bytes(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ── Writer bibliographies — saved sources synced with folio state. ──
  bibliographies: defineTable({
    userId: v.string(),
    entries: v.array(v.any()),
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
    /** Convex storage id for the writer's profile picture, if set. */
    avatarStorageId: v.optional(v.id("_storage")),
    publicStats: v.optional(
      v.object({
        writingHeatmap: v.boolean(),
        daysWritten30: v.boolean(),
        streak: v.union(
          v.literal("off"),
          v.literal("current"),
          v.literal("longest"),
        ),
        publicPieceCount: v.boolean(),
        folioCount: v.boolean(),
      }),
    ),
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

  // One-to-one identity bridge between a Better Auth product subject and the
  // DID restored by Twyne's ATProto OAuth client. The mutation enforces both
  // indexes as unique inside one Convex transaction.
  providerIdentities: defineTable({
    productSubject: v.string(),
    did: v.string(),
    verificationMethod: v.literal("legacy_atproto_browser_oauth"),
    sessionVersion: v.number(),
    verifiedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_productSubject", ["productSubject"])
    .index("by_did", ["did"]),

  accountDeletionJobs: defineTable({
    ownerId: v.string(),
    productSubject: v.string(),
    email: v.optional(v.string()),
    phase: v.number(),
    deletedCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerId", ["ownerId"]),

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
    .index("by_userId", ["userId"])
    .index("by_lixId_userId", ["lixId", "userId"]),

  // ── Mobile app waitlist — public, unauthenticated signups. ──
  // One row per (email, platform); dedupe is enforced in convex/waitlist.ts
  // via the index below rather than a unique constraint (Convex has none).
  waitlist: defineTable({
    email: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    createdAt: v.number(),
  }).index("by_email_platform", ["email", "platform"]),

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
  })
    .index("by_action_identifier", ["action", "identifier"])
    .index("by_identifier", ["identifier"]),
});
