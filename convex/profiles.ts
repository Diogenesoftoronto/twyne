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

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";

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
  "api",
  "apparatus",
  "blog",
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
  "refining",
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

/* ── Authed mutations ───────────────────────────────────────────── */

/**
 * Claim or change the signed-in user's writer handle. Replaces any existing
 * handle: the old handle is freed immediately so another writer can take it.
 * The caller's existing published pieces are NOT retroactively re-slugged —
 * `ownerHandle` on each published row is rewritten in place on next publish,
 * and the reader route renders content at whatever URL it was requested at
 * (the `/p/[slug]` legacy path still works and 301-redirects to the new
 * handle-based URL when possible).
 *
 * Also re-denormalizes `ownerHandle` across the caller's existing published
 * pieces when the handle changes, so old share links resolve to the new URL.
 */
export const claimHandle = mutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const userId = await requireIdentity(ctx);

    // Rate limit: claim attempts are cheap but the uniqueness check is a
    // DB round-trip. 5 per minute is plenty for typing-then-claiming.
    await consumeRateLimit(ctx, {
      action: "profile:claimHandle",
      identifier: userId,
      ...RATE_LIMITS.handleClaim,
    });

    const error = validateHandle(handle);
    if (error) throw new Error(error);
    const normalized = normalizeHandle(handle);

    // Uniqueness on the by_handle index. The race window is tiny (the
    // caller's claim is one mutation) but the `unique()` query enforces
    // at most one row per handle.
    const conflicting = await findHandleRow(ctx, normalized);
    if (conflicting && conflicting.userId !== userId) {
      throw new Error(`"${normalized}" is already taken.`);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("handles")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .unique();

    if (existing) {
      if (existing.handle === normalized) {
        return { handle: normalized, changed: false as const };
      }
      await ctx.db.patch(existing._id, {
        handle: normalized,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("handles", {
        userId,
        handle: normalized,
        claimedAt: now,
        updatedAt: now,
      });
    }

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

/**
 * Update the optional display name and bio shown on the profile page. The
 * handle itself is changed via `claimHandle`, not here.
 */
export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("handles")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .unique();
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
    await ctx.db.patch(existing._id, patch);
    return { ok: true };
  },
});

/* ── Authed queries ─────────────────────────────────────────────── */

/** The signed-in user's handle row, or null if unclaimed. */
export const getMyHandle = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("handles")
      .withIndex("by_userId", (q: any) => q.eq("userId", identity.tokenIdentifier))
      .unique();
    return row ? serializeHandle(row) : null;
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
    return row ? serializeHandle(row) : null;
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

function serializeHandle(row: Doc<"handles">) {
  return {
    handle: row.handle,
    displayName: row.displayName ?? null,
    bio: row.bio ?? null,
    claimedAt: row.claimedAt,
    updatedAt: row.updatedAt,
  };
}
