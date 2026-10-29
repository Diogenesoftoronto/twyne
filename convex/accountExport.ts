/**
 * "Export everything": one zip of every synced row and file the account owns.
 * The archive is built by `accountExportBuild:build` (Node), kept in storage
 * for a day, then removed. Rows are read here, a bounded page at a time.
 */
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
/** A writer can start a fresh export this often; sooner returns the last one. */
const EXPORT_COOLDOWN_MS = 5 * 60 * 1000;

const buildReference = makeFunctionReference<
  "action",
  { exportId: Id<"accountExports"> },
  null
>("accountExportBuild:build");
const expireReference = makeFunctionReference<
  "mutation",
  { exportId: Id<"accountExports"> },
  null
>("accountExport:expire");

/**
 * Every account-owned table, keyed the same way account deletion finds it.
 * Bookkeeping that only matters to a live session (presence, rate buckets,
 * sync heads) is left out.
 */
export const EXPORT_TABLES = {
  folios: { index: "by_userId", field: "userId", key: "owner" },
  folioContent: { index: "by_userId", field: "userId", key: "owner" },
  folioEntries: { index: "by_userId", field: "userId", key: "owner" },
  lixBlobs: { index: "by_userId", field: "userId", key: "owner" },
  briefs: { index: "by_userId", field: "userId", key: "owner" },
  bibliographies: { index: "by_userId", field: "userId", key: "owner" },
  bibliographyEntries: { index: "by_userId", field: "userId", key: "owner" },
  customPersonas: { index: "by_userId", field: "userId", key: "owner" },
  personaEntries: { index: "by_userId", field: "userId", key: "owner" },
  personaNotes: { index: "by_userId", field: "userId", key: "owner" },
  personaNoteStreams: { index: "by_userId", field: "userId", key: "owner" },
  personaReplies: { index: "by_userId", field: "userId", key: "owner" },
  dossierInterviewStreams: {
    index: "by_userId",
    field: "userId",
    key: "owner",
  },
  instrumentTasks: { index: "by_userId", field: "userId", key: "owner" },
  rubricResults: { index: "by_userId", field: "userId", key: "owner" },
  suggestions: { index: "by_userId", field: "userId", key: "owner" },
  aiFeedback: { index: "by_userId_createdAt", field: "userId", key: "owner" },
  writingActivity: { index: "by_userId", field: "userId", key: "owner" },
  writingActivityDetails: {
    index: "by_userId_and_day",
    field: "userId",
    key: "owner",
  },
  roomSettings: { index: "by_userId", field: "userId", key: "owner" },
  appearance: { index: "by_userId", field: "userId", key: "owner" },
  accountPreferences: {
    index: "by_userId_and_kind",
    field: "userId",
    key: "owner",
  },
  collaborators: { index: "by_userId", field: "userId", key: "owner" },
  integrationTokens: { index: "by_userId", field: "userId", key: "owner" },
  houses: { index: "by_userId", field: "userId", key: "owner" },
  houseCollections: { index: "by_userId", field: "userId", key: "owner" },
  collectionMembers: { index: "by_userId", field: "userId", key: "owner" },
  charterItems: { index: "by_userId", field: "userId", key: "owner" },
  contextLedger: { index: "by_userId_and_at", field: "userId", key: "owner" },
  handles: { index: "by_userId", field: "userId", key: "owner" },
  aliasRequests: { index: "by_userId", field: "userId", key: "owner" },
  published: { index: "by_ownerId", field: "ownerId", key: "owner" },
  images: { index: "by_ownerId", field: "ownerId", key: "owner" },
  sharedLixBlobs: { index: "by_ownerId", field: "ownerId", key: "owner" },
  userComments: { index: "by_ownerId", field: "ownerId", key: "owner" },
  userCommentReplies: { index: "by_ownerId", field: "ownerId", key: "owner" },
  aiUsageEvents: {
    index: "by_ownerId_and_occurredAt",
    field: "ownerId",
    key: "owner",
  },
  aiUsageDailyTotals: {
    index: "by_ownerId_and_day",
    field: "ownerId",
    key: "owner",
  },
  aiUsageDailyBreakdowns: {
    index: "by_ownerId_and_dimension_and_day",
    field: "ownerId",
    key: "owner",
  },
  aiUsageLifetimeTotals: {
    index: "by_ownerId",
    field: "ownerId",
    key: "owner",
  },
  aiUsageLifetimeBreakdowns: {
    index: "by_ownerId_and_dimension_and_key",
    field: "ownerId",
    key: "owner",
  },
  providerIdentities: {
    index: "by_productSubject",
    field: "productSubject",
    key: "subject",
  },
} as const;

export type ExportTable = keyof typeof EXPORT_TABLES;

/** Columns that are secrets or server bookkeeping, never written to the zip. */
export const EXPORT_OMITTED_FIELDS: Partial<Record<ExportTable, string[]>> = {
  integrationTokens: ["tokenHash"],
};

const exportView = v.object({
  id: v.id("accountExports"),
  status: v.union(
    v.literal("running"),
    v.literal("ready"),
    v.literal("failed"),
  ),
  createdAt: v.number(),
  completedAt: v.union(v.number(), v.null()),
  expiresAt: v.number(),
  bytes: v.union(v.number(), v.null()),
  rowCount: v.union(v.number(), v.null()),
  error: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
});

export const requestExport = mutation({
  args: {},
  returns: v.id("accountExports"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const latest = await ctx.db
      .query("accountExports")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .first();
    const now = Date.now();
    if (
      latest &&
      (latest.status === "running" ||
        (latest.status === "ready" &&
          now - latest.createdAt < EXPORT_COOLDOWN_MS))
    )
      return latest._id;
    const exportId = await ctx.db.insert("accountExports", {
      ownerId,
      productSubject: identity.subject || ownerId,
      status: "running",
      createdAt: now,
      expiresAt: now + EXPORT_TTL_MS,
    });
    await ctx.scheduler.runAfter(0, buildReference, { exportId });
    await ctx.scheduler.runAt(now + EXPORT_TTL_MS, expireReference, {
      exportId,
    });
    return exportId;
  },
});

export const getMyLatestExport = query({
  args: {},
  returns: v.union(exportView, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("accountExports")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .order("desc")
      .first();
    if (!row) return null;
    return {
      id: row._id,
      status: row.status,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? null,
      expiresAt: row.expiresAt,
      bytes: row.bytes ?? null,
      rowCount: row.rowCount ?? null,
      error: row.error ?? null,
      url:
        row.status === "ready" && row.storageId
          ? await ctx.storage.getUrl(row.storageId)
          : null,
    };
  },
});

export const getJob = internalQuery({
  args: { exportId: v.id("accountExports") },
  returns: v.union(
    v.object({
      ownerId: v.string(),
      productSubject: v.string(),
      status: v.string(),
      link: v.union(
        v.object({ did: v.string(), sessionVersion: v.number() }),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { exportId }) => {
    const row = await ctx.db.get("accountExports", exportId);
    if (!row) return null;
    const link = await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", row.productSubject),
      )
      .unique();
    return {
      ownerId: row.ownerId,
      productSubject: row.productSubject,
      status: row.status,
      link:
        link?.verificationMethod === "notorganic_pkce"
          ? { did: link.did, sessionVersion: link.sessionVersion }
          : null,
    };
  },
});

export const exportPage = internalQuery({
  args: {
    table: v.string(),
    value: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.any()),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { table, value, paginationOpts }) => {
    const spec = EXPORT_TABLES[table as ExportTable];
    if (!spec) throw new Error(`Unknown export table ${table}`);
    // The table list is static and every entry names a real index on it.
    const result = await (ctx.db.query(table as ExportTable) as any)
      .withIndex(spec.index, (q: any) => q.eq(spec.field, value))
      .paginate(paginationOpts);
    return {
      page: result.page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const finish = internalMutation({
  args: {
    exportId: v.id("accountExports"),
    storageId: v.id("_storage"),
    bytes: v.number(),
    rowCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { exportId, storageId, bytes, rowCount }) => {
    const row = await ctx.db.get("accountExports", exportId);
    // The account was deleted, or the export expired, while it was building.
    if (!row || row.status !== "running") {
      await ctx.storage.delete(storageId);
      return null;
    }
    await ctx.db.patch("accountExports", exportId, {
      status: "ready",
      storageId,
      bytes,
      rowCount,
      completedAt: Date.now(),
    });
    return null;
  },
});

export const fail = internalMutation({
  args: { exportId: v.id("accountExports"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { exportId, error }) => {
    const row = await ctx.db.get("accountExports", exportId);
    if (row?.status === "running")
      await ctx.db.patch("accountExports", exportId, {
        status: "failed",
        error: error.slice(0, 500),
        completedAt: Date.now(),
      });
    return null;
  },
});

export const expire = internalMutation({
  args: { exportId: v.id("accountExports") },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const row = await ctx.db.get("accountExports", exportId);
    if (!row) return null;
    if (row.storageId)
      await ctx.storage.delete(row.storageId).catch(() => undefined);
    await ctx.db.delete("accountExports", exportId);
    return null;
  },
});
