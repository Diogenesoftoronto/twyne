/** Bounded, resumable account and synced-data deletion. */
import { makeFunctionReference } from "convex/server";
import { v, type GenericId } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

const DELETE_BATCH_SIZE = 25;
const continueDeletionReference = makeFunctionReference<
  "mutation",
  { jobId: GenericId<"accountDeletionJobs"> },
  null
>("account:continueDeletion");

type Row = { _id: GenericId<keyof DataModel & string> };
type IndexedQuery = (ctx: MutationCtx, value: string) => Promise<Row[]>;

const userQueries = {
  syncHeads: (ctx, id) =>
    ctx.db
      .query("syncHeads")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  folioEntries: (ctx, id) =>
    ctx.db
      .query("folioEntries")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  personaEntries: (ctx, id) =>
    ctx.db
      .query("personaEntries")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  bibliographyEntries: (ctx, id) =>
    ctx.db
      .query("bibliographyEntries")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  briefs: (ctx, id) =>
    ctx.db
      .query("briefs")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  dossierInterviewStreams: (ctx, id) =>
    ctx.db
      .query("dossierInterviewStreams")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  personaNoteStreams: (ctx, id) =>
    ctx.db
      .query("personaNoteStreams")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  folios: (ctx, id) =>
    ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  folioContent: (ctx, id) =>
    ctx.db
      .query("folioContent")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  integrationTokens: (ctx, id) =>
    ctx.db
      .query("integrationTokens")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  writingActivity: (ctx, id) =>
    ctx.db
      .query("writingActivity")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  writingActivityDetails: (ctx, id) =>
    ctx.db
      .query("writingActivityDetails")
      .withIndex("by_userId_and_day", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  customPersonas: (ctx, id) =>
    ctx.db
      .query("customPersonas")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  personaNotes: (ctx, id) =>
    ctx.db
      .query("personaNotes")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  aiFeedback: (ctx, id) =>
    ctx.db
      .query("aiFeedback")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  personaReplies: (ctx, id) =>
    ctx.db
      .query("personaReplies")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  rubricResults: (ctx, id) =>
    ctx.db
      .query("rubricResults")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  suggestions: (ctx, id) =>
    ctx.db
      .query("suggestions")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  roomSettings: (ctx, id) =>
    ctx.db
      .query("roomSettings")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  appearance: (ctx, id) =>
    ctx.db
      .query("appearance")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  lixBlobs: (ctx, id) =>
    ctx.db
      .query("lixBlobs")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  bibliographies: (ctx, id) =>
    ctx.db
      .query("bibliographies")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  admins: (ctx, id) =>
    ctx.db
      .query("admins")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  subscriptions: (ctx, id) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  collaborators: (ctx, id) =>
    ctx.db
      .query("collaborators")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
  presence: (ctx, id) =>
    ctx.db
      .query("presence")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .take(DELETE_BATCH_SIZE),
} satisfies Record<string, IndexedQuery>;

const ownerQueries = {
  aiUsageEvents: (ctx, id) =>
    ctx.db
      .query("aiUsageEvents")
      .withIndex("by_ownerId_and_occurredAt", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  aiUsageDailyTotals: (ctx, id) =>
    ctx.db
      .query("aiUsageDailyTotals")
      .withIndex("by_ownerId_and_day", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  aiUsageDailyBreakdowns: (ctx, id) =>
    ctx.db
      .query("aiUsageDailyBreakdowns")
      .withIndex("by_ownerId_and_dimension_and_day", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  aiUsageLifetimeTotals: (ctx, id) =>
    ctx.db
      .query("aiUsageLifetimeTotals")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  aiUsageLifetimeBreakdowns: (ctx, id) =>
    ctx.db
      .query("aiUsageLifetimeBreakdowns")
      .withIndex("by_ownerId_and_dimension_and_key", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  published: (ctx, id) =>
    ctx.db
      .query("published")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  userComments: (ctx, id) =>
    ctx.db
      .query("userComments")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
  userCommentReplies: (ctx, id) =>
    ctx.db
      .query("userCommentReplies")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", id))
      .take(DELETE_BATCH_SIZE),
} satisfies Record<string, IndexedQuery>;

type Phase =
  | { kind: "user"; table: keyof typeof userQueries }
  | { kind: "owner"; table: keyof typeof ownerQueries }
  | {
      kind:
        | "images"
        | "sharedLix"
        | "handles"
        | "providerIdentity"
        | "emailOtp"
        | "rateBuckets";
    };

const PHASES: readonly Phase[] = [
  ...Object.keys(userQueries).map((table) => ({
    kind: "user" as const,
    table: table as keyof typeof userQueries,
  })),
  ...Object.keys(ownerQueries).map((table) => ({
    kind: "owner" as const,
    table: table as keyof typeof ownerQueries,
  })),
  { kind: "images" },
  { kind: "sharedLix" },
  { kind: "handles" },
  { kind: "providerIdentity" },
  { kind: "emailOtp" },
  { kind: "rateBuckets" },
];

async function deleteRows(ctx: MutationCtx, rows: Row[]) {
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

async function deletePhase(
  ctx: MutationCtx,
  phase: Phase,
  job: { ownerId: string; productSubject: string; email?: string },
): Promise<number> {
  if (phase.kind === "user")
    return await deleteRows(
      ctx,
      await userQueries[phase.table](ctx, job.ownerId),
    );
  if (phase.kind === "owner")
    return await deleteRows(
      ctx,
      await ownerQueries[phase.table](ctx, job.ownerId),
    );
  if (phase.kind === "images") {
    const rows = await ctx.db
      .query("images")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", job.ownerId))
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) {
      await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
    }
    return rows.length;
  }
  if (phase.kind === "sharedLix") {
    const rows = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", job.ownerId))
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) {
      const [collaborators, presence, locks] = await Promise.all([
        ctx.db
          .query("collaborators")
          .withIndex("by_lixId", (q) => q.eq("lixId", row.lixId))
          .take(100),
        ctx.db
          .query("presence")
          .withIndex("by_lixId", (q) => q.eq("lixId", row.lixId))
          .take(100),
        ctx.db
          .query("lixLocks")
          .withIndex("by_lixId", (q) => q.eq("lixId", row.lixId))
          .take(100),
      ]);
      await deleteRows(ctx, [...collaborators, ...presence, ...locks]);
      await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
    }
    return rows.length;
  }
  if (phase.kind === "handles") {
    const rows = await ctx.db
      .query("handles")
      .withIndex("by_userId", (q) => q.eq("userId", job.ownerId))
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) {
      if (row.avatarStorageId)
        await ctx.storage.delete(row.avatarStorageId).catch(() => undefined);
      await ctx.db.delete(row._id);
    }
    return rows.length;
  }
  if (phase.kind === "providerIdentity") {
    return await deleteRows(
      ctx,
      await ctx.db
        .query("providerIdentities")
        .withIndex("by_productSubject", (q) =>
          q.eq("productSubject", job.productSubject),
        )
        .take(DELETE_BATCH_SIZE),
    );
  }
  if (phase.kind === "emailOtp") {
    if (!job.email) return 0;
    return await deleteRows(
      ctx,
      await ctx.db
        .query("e2eOtps")
        .withIndex("by_email", (q) => q.eq("email", job.email!))
        .take(DELETE_BATCH_SIZE),
    );
  }
  return await deleteRows(
    ctx,
    await ctx.db
      .query("rateBuckets")
      .withIndex("by_identifier", (q) => q.eq("identifier", job.ownerId))
      .take(DELETE_BATCH_SIZE),
  );
}

export const deleteAccount = mutation({
  args: {},
  returns: v.object({
    deleted: v.record(v.string(), v.number()),
    identityPurged: v.boolean(),
    emailProvided: v.boolean(),
    deletionScheduled: v.boolean(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const productSubject = identity.subject || identity.tokenIdentifier;
    const email = identity.email?.trim().toLowerCase();
    const existing = await ctx.db
      .query("accountDeletionJobs")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    const now = Date.now();
    const jobId =
      existing?._id ??
      (await ctx.db.insert("accountDeletionJobs", {
        ownerId,
        productSubject,
        email,
        phase: 0,
        deletedCount: 0,
        createdAt: now,
        updatedAt: now,
      }));
    let identityPurged = false;
    if (email) {
      try {
        identityPurged = await purgeBetterAuthIdentity(ctx, email);
      } catch (error) {
        console.error("[twyne:account] auth identity purge failed:", error);
      }
    }
    await ctx.scheduler.runAfter(0, continueDeletionReference, { jobId });
    return {
      deleted: {},
      identityPurged,
      emailProvided: !!email,
      deletionScheduled: true,
    };
  },
});

export const continueDeletion = internalMutation({
  args: { jobId: v.id("accountDeletionJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("accountDeletionJobs", jobId);
    if (!job) return null;
    const phase = PHASES[job.phase];
    if (!phase) {
      await ctx.db.delete(job._id);
      return null;
    }
    const count = await deletePhase(ctx, phase, job);
    await ctx.db.patch(job._id, {
      phase: count < DELETE_BATCH_SIZE ? job.phase + 1 : job.phase,
      deletedCount: job.deletedCount + count,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, continueDeletionReference, { jobId });
    return null;
  },
});

async function purgeBetterAuthIdentity(ctx: MutationCtx, email: string) {
  const adapter = (
    components.betterAuth as unknown as {
      adapter: { findOne: unknown; deleteMany: unknown };
    }
  ).adapter;
  const user = (await ctx.runQuery(
    adapter.findOne as never,
    {
      model: "user",
      where: [{ field: "email", operator: "eq", value: email }],
    } as never,
  )) as { _id?: string } | null;
  if (!user?._id) return false;
  for (const model of ["session", "account"]) {
    await ctx.runMutation(
      adapter.deleteMany as never,
      {
        input: {
          model,
          where: [{ field: "userId", operator: "eq", value: user._id }],
        },
        paginationOpts: { cursor: null, numItems: 1000 },
      } as never,
    );
  }
  await ctx.runMutation(
    adapter.deleteMany as never,
    {
      input: {
        model: "user",
        where: [{ field: "_id", operator: "eq", value: user._id }],
      },
      paginationOpts: { cursor: null, numItems: 1000 },
    } as never,
  );
  return true;
}
