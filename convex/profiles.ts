/**
 * Writer handles — first-class public identity.
 *
 * A handle is a writer's addressable name on Twyne: it appears in share URLs
 * (`/<handle>/<slug>`), profile pages (`/<handle>`), and is the only
 * user-facing identifier surfaced publicly. Claimed once a user signs in,
 * the handle is denormalized onto `published.ownerHandle` at publish time so
 * the reader route never needs a second hop.
 *
 * Rules:
 *   • 3–30 chars, lowercase letters/digits/hyphens, can't start or end with
 *     a hyphen, can't have two hyphens in a row.
 *   • Not all-numeric (avoids slug collisions and `_id` confusion).
 *   • Reserved words (existing top-level routes: `blog`, `editor`, etc.)
 *     are rejected so a handle can never shadow a Twyne route.
 *   • Uniqueness is enforced at write time via the `by_handle` index.
 *
 * Auth follows the Convex guideline: every mutation reads identity from
 * `ctx.auth.getUserIdentity()`. There is no `userId` argument.
 */

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { EXTRA_ALIAS_PRICE_MICROUSD } from "../src/utils/alias-policy";

/* ── Validation ─────────────────────────────────────────────────── */

const HANDLE_MIN = 3;
const HANDLE_MAX = 30;
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,28}[a-z0-9]$/;

/**
 * Top-level route segments reserved by the app. A writer can't claim any of
 * these — they would shadow a real Twyne route. Keep synced with
 * `src/routes/`.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "analysis",
  "api",
  "apparatus",
  "at",
  "blog",
  "dossier",
  "desk",
  "docs",
  "download",
  "downloads",
  "editor",
  "faq",
  "library",
  "oauth-client-metadata.json",
  "onboarding",
  "personas",
  "p",
  "pricing",
  "privacy",
  "rubric",
  "settings",
  "signin",
  "signout",
  "terms",
  "twyne",
  "www",
  "post",
  "posts",
  "feed",
  "read",
  "share",
  "new",
  "me",
  "profile",
  "about",
  "help",
  "house",
  "og",
  "privacy-ledger",
  "revisions",
  "writing-tools",
  "support",
  "contact",
  "account",
  "auth",
  "lsp",
  "creem",
  "e2e",
]);

export function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateHandle(input: string): string | null {
  const handle = normalizeHandle(input);
  if (handle.length < HANDLE_MIN) {
    return `Handle must be at least ${HANDLE_MIN} characters.`;
  }
  if (handle.length > HANDLE_MAX) {
    return `Handle must be ${HANDLE_MAX} characters or fewer.`;
  }
  if (!HANDLE_RE.test(handle)) {
    return "Letters, numbers, and hyphens only. Must start and end with a letter or number.";
  }
  if (/^\d+$/.test(handle)) {
    return "Handle can't be all numbers.";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return `"${handle}" is reserved. Try another handle.`;
  }
  return null;
}

export interface PublicStatsPreferences {
  writingHeatmap: boolean;
  daysWritten30: boolean;
  streak: "off" | "current" | "longest";
  publicPieceCount: boolean;
  folioCount: boolean;
}

/** Existing profiles keep only the heatmap that was already public. */
export const LEGACY_PUBLIC_STATS: PublicStatsPreferences = {
  writingHeatmap: true,
  daysWritten30: false,
  streak: "off",
  publicPieceCount: false,
  folioCount: false,
};

/** New profiles must make an explicit choice before sharing any statistic. */
export const PRIVATE_PUBLIC_STATS: PublicStatsPreferences = {
  writingHeatmap: false,
  daysWritten30: false,
  streak: "off",
  publicPieceCount: false,
  folioCount: false,
};

export function effectivePublicStats(
  row: Pick<Doc<"handles">, "publicStats">,
): PublicStatsPreferences {
  return row.publicStats ?? LEGACY_PUBLIC_STATS;
}

/* ── Internal helpers ──────────────────────────────────────────── */

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity.tokenIdentifier;
}

async function findHandleRow(
  ctx: { db: any },
  handle: string,
): Promise<Doc<"handles"> | null> {
  return await ctx.db
    .query("handles")
    .withIndex("by_handle", (q: any) => q.eq("handle", handle))
    .unique();
}

export async function ownedHandles(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<"handles">[]> {
  const rows: Doc<"handles">[] = await ctx.db
    .query("handles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  // Legacy multi-alias owners keep every row; oldest claim is the primary view.
  return rows.sort(
    (a, b) =>
      a.claimedAt - b.claimedAt ||
      a._creationTime - b._creationTime ||
      a._id.localeCompare(b._id),
  );
}

/* ── Authed mutations ───────────────────────────────────────────── */

/**
 * Claim the included standard alias once, within one serializable mutation.
 * Read both owner and alias index ranges before inserting so competing claims
 * conflict and are retried by Convex. Existing aliases are never released.
 */
export const claimHandle = mutation({
  args: { handle: v.string() },
  returns: v.object({ handle: v.string(), changed: v.boolean() }),
  handler: async (ctx, { handle }) => {
    const userId = await requireIdentity(ctx);

    const normalized = normalizeHandle(handle);
    const owned = await ownedHandles(ctx, userId);
    if (owned.some((row) => row.handle === normalized)) {
      return { handle: owned[0]!.handle, changed: false as const };
    }
    const error = validateHandle(handle);
    if (error) throw new Error(error);
    if (owned.length) {
      throw new ConvexError({
        code: "STANDARD_ALIAS_ALREADY_CLAIMED",
        message: `Your included alias is /${owned[0]!.handle}. Additional aliases require a request and US$250 in credits.`,
      });
    }

    // Rate limit: claim attempts are cheap but the uniqueness check is a
    // DB round-trip. 5 per minute is plenty for typing-then-claiming.
    await consumeRateLimit(ctx, {
      action: "profile:claimHandle",
      identifier: userId,
      ...RATE_LIMITS.handleClaim,
    });

    // The indexed read and insertion share a Convex transaction.
    const conflicting = await findHandleRow(ctx, normalized);
    if (conflicting && conflicting.userId !== userId) {
      throw new Error(`"${normalized}" is already taken.`);
    }

    const now = Date.now();
    await ctx.db.insert("handles", {
      userId,
      handle: normalized,
      publicStats: PRIVATE_PUBLIC_STATS,
      claimedAt: now,
      updatedAt: now,
    });

    // Re-denormalize `ownerHandle` across the caller's published pieces so
    // existing share links resolve to the new handle-based URL.
    const mine = await ctx.db
      .query("published")
      .withIndex("by_ownerId", (q: any) => q.eq("ownerId", userId))
      .collect();
    for (const row of mine) {
      if (row.ownerHandle !== normalized) {
        await ctx.db.patch(row._id, { ownerHandle: normalized });
      }
    }

    return { handle: normalized, changed: true as const };
  },
});

/** Request only: review and any separately authorized payment happen later. */
export const requestAdditionalAlias = mutation({
  args: { handle: v.string() },
  returns: v.object({
    requestId: v.id("aliasRequests"),
    handle: v.string(),
    status: v.literal("pending"),
    priceMicrousd: v.number(),
    currency: v.literal("USD"),
  }),
  handler: async (ctx, { handle }) => {
    const userId = await requireIdentity(ctx);
    const error = validateHandle(handle);
    if (error) throw new Error(error);
    const normalized = normalizeHandle(handle);
    const owned = await ownedHandles(ctx, userId);
    if (!owned.length) throw new Error("Claim your included alias first.");
    if (owned.some((row) => row.handle === normalized))
      throw new Error("You already own this alias.");
    const existing = await ctx.db
      .query("aliasRequests")
      .withIndex("by_userId_and_handle", (q) =>
        q.eq("userId", userId).eq("handle", normalized),
      )
      .unique();
    if (existing)
      return {
        requestId: existing._id,
        handle: existing.handle,
        status: existing.status,
        priceMicrousd: existing.priceMicrousd,
        currency: existing.currency,
      };
    await consumeRateLimit(ctx, {
      action: "profile:requestAdditionalAlias",
      identifier: userId,
      ...RATE_LIMITS.handleClaim,
    });
    if (await findHandleRow(ctx, normalized))
      throw new Error("This alias is already taken.");
    const requestId = await ctx.db.insert("aliasRequests", {
      userId,
      handle: normalized,
      status: "pending",
      priceMicrousd: EXTRA_ALIAS_PRICE_MICROUSD,
      currency: "USD",
      requestedAt: Date.now(),
    });
    return {
      requestId,
      handle: normalized,
      status: "pending" as const,
      priceMicrousd: EXTRA_ALIAS_PRICE_MICROUSD,
      currency: "USD" as const,
    };
  },
});

/** Replace the authenticated writer's explicit public-stat sharing choices. */
export const updatePublicStats = mutation({
  args: {
    writingHeatmap: v.boolean(),
    daysWritten30: v.boolean(),
    streak: v.union(
      v.literal("off"),
      v.literal("current"),
      v.literal("longest"),
    ),
    publicPieceCount: v.boolean(),
    folioCount: v.boolean(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, publicStats) => {
    const userId = await requireIdentity(ctx);
    const existing = (await ownedHandles(ctx, userId))[0];
    if (!existing) {
      throw new Error("Claim a handle before changing public statistics.");
    }
    await ctx.db.patch(existing._id, {
      publicStats,
      ...(existing.deskPublication?.enabled
        ? {
            deskPublication: {
              ...existing.deskPublication,
              revision: existing.deskPublication.revision + 1,
              payload: undefined,
            },
          }
        : {}),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Update the optional display name and bio shown on the profile page. The
 * alias itself is preserved after its initial claim.
 */
export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    /**
     * Profile picture. Pass a freshly uploaded `_storage` id to set it, or
     * `null` to clear the existing avatar. Omit to leave it unchanged.
     */
    avatarStorageId: v.optional(v.union(v.id("_storage"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const existing = (await ownedHandles(ctx, userId))[0];
    if (!existing) {
      throw new Error("Claim a handle before setting a profile.");
    }
    const patch: Partial<Doc<"handles">> = { updatedAt: Date.now() };
    if (args.displayName !== undefined) {
      const trimmed = args.displayName.trim().slice(0, 60);
      patch.displayName = trimmed || undefined;
    }
    if (args.bio !== undefined) {
      const trimmed = args.bio.trim().slice(0, 280);
      patch.bio = trimmed || undefined;
    }
    if (args.avatarStorageId !== undefined) {
      // Clearing or replacing the avatar: delete the previous blob so we don't
      // leak orphaned storage objects.
      if (
        existing.avatarStorageId &&
        existing.avatarStorageId !== args.avatarStorageId
      ) {
        await ctx.storage.delete(existing.avatarStorageId);
      }
      patch.avatarStorageId = args.avatarStorageId ?? undefined;
    }
    if (existing.deskPublication?.enabled)
      patch.deskPublication = {
        ...existing.deskPublication,
        revision: existing.deskPublication.revision + 1,
        payload: undefined,
      };
    await ctx.db.patch(existing._id, patch);
    return { ok: true };
  },
});

/**
 * Mint a short-lived upload URL for a profile picture. The client POSTs the
 * image bytes to the returned URL, gets back a `_storage` id, then calls
 * `updateProfile({ avatarStorageId })` to attach it. A handle must be claimed
 * first, mirroring the other profile metadata.
 */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    await consumeRateLimit(ctx, {
      action: "profile:avatarUpload",
      identifier: userId,
      ...RATE_LIMITS.avatarUpload,
    });
    const existing = (await ownedHandles(ctx, userId))[0];
    if (!existing) {
      throw new Error("Claim a handle before adding a profile picture.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/* ── Authed queries ─────────────────────────────────────────────── */

/** The signed-in user's handle row, or null if unclaimed. */
export const getMyHandle = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const owned = await ownedHandles(ctx, identity.tokenIdentifier);
    if (!owned.length) return null;
    const requests = await ctx.db
      .query("aliasRequests")
      .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
      .order("desc")
      .take(50);
    return {
      ...(await serializeHandle(ctx, owned[0]!)),
      ownedAliases: owned.map((row) => row.handle),
      additionalAliasRequests: requests.map((row) => ({
        handle: row.handle,
        status: row.status,
        priceMicrousd: row.priceMicrousd,
        currency: row.currency,
      })),
    };
  },
});

/* ── Public queries (no auth) ───────────────────────────────────── */

/** Public profile lookup by handle. Returns null when the handle is unknown. */
export const getProfile = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const normalized = normalizeHandle(handle);
    const row = await ctx.db
      .query("handles")
      .withIndex("by_handle", (q: any) => q.eq("handle", normalized))
      .unique();
    return row ? await serializeHandle(ctx, row) : null;
  },
});

/**
 * Check whether a candidate handle is available. Used by the Settings UI to
 * give live feedback as the user types.
 */
export const checkHandleAvailable = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const error = validateHandle(handle);
    if (error) {
      return { available: false as const, reason: error };
    }
    const normalized = normalizeHandle(handle);
    const row = await ctx.db
      .query("handles")
      .withIndex("by_handle", (q: any) => q.eq("handle", normalized))
      .unique();
    if (row) {
      return {
        available: false as const,
        reason: `"${normalized}" is already taken.`,
      };
    }
    return { available: true as const, handle: normalized };
  },
});

/* ── Serialization ──────────────────────────────────────────────── */

async function serializeHandle(ctx: { storage: any }, row: Doc<"handles">) {
  const avatarUrl = row.avatarStorageId
    ? await ctx.storage.getUrl(row.avatarStorageId)
    : null;
  return {
    handle: row.handle,
    displayName: row.displayName ?? null,
    bio: row.bio ?? null,
    avatarUrl,
    claimedAt: row.claimedAt,
    updatedAt: row.updatedAt,
    publicStats: effectivePublicStats(row),
  };
}
