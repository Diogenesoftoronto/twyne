/**
 * Draining the three single-document collections into their row-per-item
 * tables.
 *
 * Writes migrate a user on their own: `writeCollection` replaces the rows and
 * drops the legacy document. That covers everyone who is actively writing. This
 * job is for everyone else — a dormant account whose folios would otherwise sit
 * in the old shape indefinitely, still readable but never converted.
 *
 * Safe to run repeatedly and safe to run forever: once a table has no legacy
 * documents left, every pass is one empty read. It can be removed from the cron
 * when `pending` has reported zero for a while.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  COLLECTION_TABLES,
  legacyHolders,
  migrateCollection,
} from "./lib/collections";

/**
 * Users migrated per pass, per collection.
 *
 * A migration is bounded by one user's collection, and these are small — the
 * limit is only here so one transaction cannot grow unbounded on a table with
 * a long backlog. The next pass takes the next slice.
 */
const USERS_PER_PASS = 25;

export const backfillCollections = internalMutation({
  args: {},
  returns: v.object({
    migrated: v.number(),
    users: v.number(),
  }),
  handler: async (ctx) => {
    let migrated = 0;
    let users = 0;

    for (const table of COLLECTION_TABLES) {
      const holders = await legacyHolders(ctx, table, USERS_PER_PASS);
      for (const userId of holders) {
        const result = await migrateCollection(ctx, table, userId);
        if (!result) continue;
        migrated += result.migrated;
        users += 1;
      }
    }

    return { migrated, users };
  },
});

/** How much is left, for deciding when the cron can be retired. */
export const backfillRemaining = internalQuery({
  args: {},
  returns: v.object({
    folios: v.number(),
    customPersonas: v.number(),
    bibliographies: v.number(),
  }),
  handler: async (ctx) => {
    // Counting is deliberately capped: this reports whether a backlog exists,
    // not its exact size, and must never become the expensive query.
    const cap = 1000;
    const [folios, customPersonas, bibliographies] = await Promise.all([
      ctx.db.query("folios").take(cap),
      ctx.db.query("customPersonas").take(cap),
      ctx.db.query("bibliographies").take(cap),
    ]);
    return {
      folios: folios.length,
      customPersonas: customPersonas.length,
      bibliographies: bibliographies.length,
    };
  },
});
