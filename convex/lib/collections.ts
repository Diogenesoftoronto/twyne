/**
 * Per-user collections, stored a row at a time.
 *
 * Folios, custom personas and bibliography entries each used to be one array
 * inside one document. That arrangement had two problems that only show up at
 * scale: every edit rewrote the entire document, and the collection could never
 * grow past Convex's 1MB document cap — a writer with a long bibliography would
 * eventually stop being able to save at all.
 *
 * The storage is now a row per item. The *contract* is unchanged: callers still
 * hand over and receive whole arrays, because that is what the browser holds
 * and what `pushAll` has always carried. Everything below exists to make that
 * translation faithful — including the order the array came in, which the
 * caller is entitled to get back.
 *
 * Reads fall back to the legacy single-document row when a user has no per-item
 * rows yet, so nothing breaks before the backfill reaches them. Writes always
 * land in the new tables and drop the legacy row, so there is never a second,
 * staler copy of a collection to disagree with the first.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The three tables sharing the collection-entry shape. */
export const COLLECTION_TABLES = [
  "folioEntries",
  "personaEntries",
  "bibliographyEntries",
] as const;

export type CollectionTable = (typeof COLLECTION_TABLES)[number];

/**
 * All three tables are declared from one field set in the schema, so their
 * documents are structurally identical and one of them can stand for the rest.
 * This is what lets the functions below be written once instead of three times.
 */
type CollectionRow = Doc<"folioEntries">;

export interface CollectionSnapshot {
  items: unknown[];
  /** Newest `updatedAt` across the collection — what newer-wins compares. */
  updatedAt: number;
}

/** Where each collection lived before, for reading and for the backfill. */
const LEGACY = {
  folioEntries: { table: "folios", field: "folios" },
  personaEntries: { table: "customPersonas", field: "personas" },
  bibliographyEntries: { table: "bibliographies", field: "entries" },
} as const;

function rowsOf(
  ctx: QueryCtx | MutationCtx,
  table: CollectionTable,
  userId: string,
): Promise<CollectionRow[]> {
  return ctx.db
    .query(table)
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect() as Promise<CollectionRow[]>;
}

/**
 * The id this item is filed under.
 *
 * Everything the app puts in these collections carries a string `id`. An item
 * without one still has to round-trip rather than vanish, so it is filed by
 * position — stable enough, because the array is always written whole.
 */
function identify(item: unknown, index: number): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const id = (item as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return `__index_${index}`;
}

function serialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** The legacy single-document row, if this user still has one. */
async function readLegacy(
  ctx: QueryCtx | MutationCtx,
  table: CollectionTable,
  userId: string,
): Promise<CollectionSnapshot | null> {
  const legacy = LEGACY[table];
  const row = await ctx.db
    .query(legacy.table)
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!row) return null;
  const items = (row as unknown as Record<string, unknown>)[legacy.field];
  return {
    items: Array.isArray(items) ? items : [],
    updatedAt: (row as { updatedAt?: number }).updatedAt ?? 0,
  };
}

async function dropLegacy(
  ctx: MutationCtx,
  table: CollectionTable,
  userId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query(LEGACY[table].table)
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!row) return false;
  await ctx.db.delete(row._id);
  return true;
}

/**
 * The whole collection, in order.
 *
 * Falls back to the legacy row for a user the backfill has not reached. An
 * empty result is indistinguishable from "no rows", which is correct: both mean
 * the collection is empty.
 */
export async function readCollection(
  ctx: QueryCtx | MutationCtx,
  table: CollectionTable,
  userId: string,
): Promise<CollectionSnapshot> {
  const rows = await rowsOf(ctx, table, userId);
  if (rows.length === 0) {
    return (await readLegacy(ctx, table, userId)) ?? { items: [], updatedAt: 0 };
  }
  rows.sort((a, b) => a.order - b.order);
  return {
    items: rows.map((row) => row.item),
    updatedAt: rows.reduce((newest, row) => Math.max(newest, row.updatedAt), 0),
  };
}

/**
 * Replace the collection with `items`.
 *
 * The array is authoritative — it is the writer's whole collection, not a
 * patch — so an item missing from it has been deleted, and its row goes with
 * it. That is a delete channel the single-document arrangement had by accident
 * and the row-per-item one has to provide deliberately.
 *
 * Rows that did not move are left alone. This is the entire point of the
 * change: editing one folio must not rewrite the other nine.
 */
export async function writeCollection(
  ctx: MutationCtx,
  table: CollectionTable,
  userId: string,
  items: readonly unknown[],
): Promise<{ written: number; removed: number }> {
  const rows = await rowsOf(ctx, table, userId);
  const byItemId = new Map(rows.map((row) => [row.itemId, row]));
  const now = Date.now();
  const seen = new Set<string>();
  let written = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemId = identify(item, index);
    // A duplicate id in the incoming array would otherwise write the same row
    // twice in one transaction. First occurrence wins, as it does in an array.
    if (seen.has(itemId)) continue;
    seen.add(itemId);

    const existing = byItemId.get(itemId);
    if (!existing) {
      await ctx.db.insert(table, {
        userId,
        itemId,
        item,
        order: index,
        updatedAt: now,
      });
      written += 1;
      continue;
    }
    if (
      existing.order === index &&
      serialize(existing.item) === serialize(item)
    ) {
      continue;
    }
    await ctx.db.patch(existing._id as Id<CollectionTable>, {
      item,
      order: index,
      updatedAt: now,
    });
    written += 1;
  }

  let removed = 0;
  for (const row of rows) {
    if (seen.has(row.itemId)) continue;
    await ctx.db.delete(row._id as Id<CollectionTable>);
    removed += 1;
  }

  // The new rows are now the whole truth for this collection. Leaving the old
  // document behind would leave a stale copy for a reader to find.
  await dropLegacy(ctx, table, userId);

  return { written, removed };
}

/**
 * Move one user's collection out of its legacy document.
 *
 * Idempotent, and safe to run against a user who has already been migrated by
 * a write: per-item rows always win, and the legacy row is dropped either way.
 */
export async function migrateCollection(
  ctx: MutationCtx,
  table: CollectionTable,
  userId: string,
): Promise<{ migrated: number } | null> {
  const legacy = await readLegacy(ctx, table, userId);
  if (!legacy) return null;

  const existing = await rowsOf(ctx, table, userId);
  if (existing.length > 0) {
    // Already migrated by a write that arrived first. The document is stale by
    // definition; drop it rather than let it overwrite newer rows.
    await dropLegacy(ctx, table, userId);
    return { migrated: 0 };
  }

  const now = Date.now();
  const seen = new Set<string>();
  let migrated = 0;
  for (let index = 0; index < legacy.items.length; index += 1) {
    const item = legacy.items[index];
    const itemId = identify(item, index);
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    await ctx.db.insert(table, {
      userId,
      itemId,
      item,
      order: index,
      // Preserve the collection's age so newer-wins keeps its meaning across
      // the migration: a migrated collection must not look freshly edited.
      updatedAt: legacy.updatedAt || now,
    });
    migrated += 1;
  }
  await dropLegacy(ctx, table, userId);
  return { migrated };
}

/** Every user still holding a legacy document for this collection. */
export async function legacyHolders(
  ctx: QueryCtx | MutationCtx,
  table: CollectionTable,
  limit: number,
): Promise<string[]> {
  const rows = await ctx.db.query(LEGACY[table].table).take(limit);
  return rows.map((row) => (row as { userId: string }).userId);
}
