/**
 * Internal storage metadata for shared Lix documents. The blob itself lives in
 * Convex file storage; these rows store the `storageId` that `ctx.storage.get`
 * / `ctx.storage.store` use.
 *
 * The `lixRelay.ts` action reads/writes blobs directly via `ctx.storage`, so
 * these functions only manage the metadata row (lookup by lixId, create,
 * update the storageId when the blob changes).
 */
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const get = internalQuery({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const row = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    return row ?? null;
  },
});

export const has = internalQuery({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const row = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    return row !== null;
  },
});

/** Create the metadata row with an initial storageId. */
export const set = internalMutation({
  args: {
    lixId: v.string(),
    ownerId: v.string(),
    folioId: v.string(),
    folioName: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("sharedLixBlobs", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update just the storageId (after a push/pull cycle writes a new blob). */
export const updateStorageId = internalMutation({
  args: { lixId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { lixId, storageId }) => {
    const existing = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { storageId, updatedAt: Date.now() });
      return existing.storageId;
    }
    return null;
  },
});

/** Delete the metadata row (caller deletes the file separately). */
export const remove = internalMutation({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const row = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    if (row) {
      await ctx.db.delete(row._id);
      return row.storageId;
    }
    return null;
  },
});

/* ── Push-serialization locks ──────────────────────────────────────
 * Prevents two concurrent /lsp/push-v1 requests from both reading the
 * same base blob and the later write clobbering the earlier one.
 * The lock is per-lixId; stale locks older than the TTL are reclaimed. */

const LIX_LOCK_TTL_MS = 30_000;

/** Try to acquire the push lock for a lixId. Returns true if acquired. */
export const acquireLock = internalMutation({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("lixLocks")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    if (existing && now - existing.lockedAt < LIX_LOCK_TTL_MS) {
      return false;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { lockedAt: now });
    } else {
      await ctx.db.insert("lixLocks", { lixId, lockedAt: now });
    }
    return true;
  },
});

/** Release the push lock for a lixId. */
export const releaseLock = internalMutation({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const existing = await ctx.db
      .query("lixLocks")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
