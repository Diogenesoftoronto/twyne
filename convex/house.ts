import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const dossier = v.object({
  workingTitle: v.optional(v.string()),
  format: v.optional(v.string()),
  audience: v.optional(v.string()),
  goal: v.optional(v.string()),
  tone: v.optional(v.string()),
  constraints: v.optional(v.string()),
  successSignal: v.optional(v.string()),
});
const house = v.object({ name: v.string(), dossier, updatedAt: v.number() });
const collection = v.object({
  id: v.string(),
  name: v.string(),
  description: v.string(),
  dossier,
  folioIds: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
const charter = v.object({
  id: v.string(),
  scope: v.union(
    v.literal("house"),
    v.literal("collection"),
    v.literal("folio"),
  ),
  ownerRef: v.string(),
  text: v.string(),
  severity: v.union(v.literal("must"), v.literal("prefer")),
  kind: v.union(
    v.literal("length"),
    v.literal("citation"),
    v.literal("style"),
    v.literal("voice"),
    v.literal("other"),
  ),
  order: v.number(),
  updatedAt: v.number(),
});
const ledger = v.object({
  id: v.string(),
  at: v.number(),
  layer: v.union(
    v.literal("house"),
    v.literal("collection"),
    v.literal("folio"),
    v.literal("amendment"),
    v.literal("charter"),
  ),
  ownerRef: v.string(),
  field: v.optional(v.string()),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  source: v.union(
    v.literal("interview"),
    v.literal("refine"),
    v.literal("amendment"),
    v.literal("house"),
    v.literal("collection"),
    v.literal("charter"),
    v.literal("manual"),
    v.literal("sync"),
  ),
  reason: v.optional(v.string()),
});
const snapshot = v.object({
  house,
  collections: v.array(collection),
  charter: v.array(charter),
  ledger: v.array(ledger),
});
// Bound full snapshots so replacement stays within a single transaction.
const MAX_ROWS = 1000;
function validateBounds(value: unknown): void {
  if (typeof value === "string" && value.length > 16000)
    throw new Error("String exceeds 16000 characters");
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Expected a finite number");
  if (Array.isArray(value)) {
    if (value.length > MAX_ROWS) throw new Error("Too many rows");
    value.forEach(validateBounds);
  } else if (value && typeof value === "object")
    Object.values(value).forEach(validateBounds);
}
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate id");
}
async function owner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity.tokenIdentifier;
}
function ledgerEntry(row: Doc<"contextLedger">) {
  const { _id, _creationTime, userId, entryId, ...entry } = row;
  return { id: entryId, ...entry };
}

export const getHouse = query({
  args: {},
  returns: v.union(v.null(), snapshot),
  handler: async (ctx) => {
    const userId = await owner(ctx);
    const h = await ctx.db
      .query("houses")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!h) return null;
    const collections = await ctx.db
      .query("houseCollections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(MAX_ROWS);
    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(MAX_ROWS);
    const items = await ctx.db
      .query("charterItems")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(MAX_ROWS);
    const entries = await ctx.db
      .query("contextLedger")
      .withIndex("by_userId_and_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    return {
      house: { name: h.name, dossier: h.dossier, updatedAt: h.updatedAt },
      collections: collections.map(
        ({ _id, _creationTime, userId, collectionId, ...c }) => ({
          id: collectionId,
          ...c,
          folioIds: members
            .filter((m) => m.collectionId === collectionId)
            .map((m) => m.folioId),
        }),
      ),
      charter: items.map(({ _id, _creationTime, userId, itemId, ...item }) => ({
        id: itemId,
        ...item,
      })),
      ledger: entries.map(ledgerEntry),
    };
  },
});

export const putHouseSnapshot = mutation({
  args: snapshot.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    validateBounds(args);
    if (args.ledger.length > 200)
      throw new Error("Ledger is limited to 200 entries per call");
    const memberCount = args.collections.reduce(
      (n, c) => n + c.folioIds.length,
      0,
    );
    if (args.collections.length + args.charter.length + memberCount > MAX_ROWS)
      throw new Error("Too many snapshot rows");
    unique(args.collections.map((c) => c.id));
    unique(args.charter.map((c) => c.id));
    unique(args.ledger.map((e) => e.id));
    unique(args.collections.flatMap((c) => c.folioIds));
    const existing = await ctx.db
      .query("houses")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    // Stale clients may append missing history, but must never restore an
    // older collection or charter snapshot over a newer withdrawal.
    if (!existing || args.house.updatedAt >= existing.updatedAt) {
      if (existing)
        await ctx.db.replace("houses", existing._id, { userId, ...args.house });
      else await ctx.db.insert("houses", { userId, ...args.house });
      for (const table of [
        "houseCollections",
        "collectionMembers",
        "charterItems",
      ] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .take(MAX_ROWS + 1);
        if (rows.length > MAX_ROWS)
          throw new Error("Stored snapshot exceeds row limit");
        for (const row of rows) await ctx.db.delete(table, row._id);
      }
      for (const { id, folioIds, ...c } of args.collections) {
        await ctx.db.insert("houseCollections", {
          userId,
          collectionId: id,
          ...c,
        });
        for (const folioId of folioIds)
          await ctx.db.insert("collectionMembers", {
            userId,
            collectionId: id,
            folioId,
          });
      }
      for (const { id, ...item } of args.charter)
        await ctx.db.insert("charterItems", { userId, itemId: id, ...item });
    }
    for (const { id, ...entry } of args.ledger) {
      const prior = await ctx.db
        .query("contextLedger")
        .withIndex("by_userId_and_entryId", (q) =>
          q.eq("userId", userId).eq("entryId", id),
        )
        .unique();
      if (!prior)
        await ctx.db.insert("contextLedger", { userId, entryId: id, ...entry });
    }
    return null;
  },
});

export const listLedger = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(ledger),
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    validateBounds(args);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 200
    )
      throw new Error("Page size must be between 1 and 200");
    const result = await ctx.db
      .query("contextLedger")
      .withIndex("by_userId_and_at", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(ledgerEntry) };
  },
});
