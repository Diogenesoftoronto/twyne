import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  taskDocument,
  taskKind,
  sourceRef,
  taskResult,
  feedback,
  failureKind,
} from "./instrumentTaskValidators";
import {
  instrumentTextFingerprint,
  instrumentTaskCanCancel,
} from "../src/utils/instrument-tasks-model";
import { consumeRateLimit, RATE_LIMITS, RateLimitError } from "./lib/rateLimit";

export const INSTRUMENT_LEASE_MS = 180_000;
export const INSTRUMENT_MAX_CLAIMS = 3;
const runRef = makeFunctionReference<
  "action",
  { taskId: Id<"instrumentTasks"> },
  null
>("instrumentTasksRunner:run");
const expireRef = makeFunctionReference<
  "mutation",
  { taskId: Id<"instrumentTasks">; leaseToken: string },
  null
>("instrumentTasks:expireLease");
const publicTask = taskDocument.omit(
  "userId",
  "productSubject",
  "did",
  "sessionVersion",
  "leaseToken",
  "leaseExpiresAt",
  "scheduledId",
);
function view(row: Doc<"instrumentTasks">) {
  // Whitelist the public view so newly added private fields stay private.
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    requestId: row.requestId,
    folioId: row.folioId,
    kind: row.kind,
    instruction: row.instruction,
    selectedText: row.selectedText,
    fingerprint: row.fingerprint,
    sources: row.sources,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    result: row.result,
    error: row.error,
    failureKind: row.failureKind,
    feedback: row.feedback,
  };
}
async function identity(ctx: QueryCtx) {
  const value = await ctx.auth.getUserIdentity();
  if (!value)
    throw new ConvexError("Sign in with Not Organic to queue durable tasks.");
  return value;
}
async function folioExists(ctx: QueryCtx, userId: string, folioId: string) {
  const entry = await ctx.db
    .query("folioEntries")
    .withIndex("by_userId_itemId", (q) =>
      q.eq("userId", userId).eq("itemId", folioId),
    )
    .unique();
  return !!entry;
}
async function permitted(ctx: QueryCtx, task: Doc<"instrumentTasks">) {
  const deleting = await ctx.db
    .query("accountDeletionJobs")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", task.userId))
    .unique();
  if (deleting || !(await folioExists(ctx, task.userId, task.folioId)))
    return false;
  const link = await ctx.db
    .query("providerIdentities")
    .withIndex("by_productSubject", (q) =>
      q.eq("productSubject", task.productSubject),
    )
    .unique();
  return (
    link?.verificationMethod === "notorganic_pkce" &&
    link.did === task.did &&
    link.sessionVersion === task.sessionVersion
  );
}
async function owned(ctx: QueryCtx, taskId: Id<"instrumentTasks">) {
  const caller = await identity(ctx);
  const row = await ctx.db.get("instrumentTasks", taskId);
  if (!row || row.userId !== caller.tokenIdentifier)
    throw new ConvexError("Task not found.");
  return row;
}
function bound(value: string, min: number, max: number, label: string) {
  if (value.trim().length < min || value.length > max)
    throw new ConvexError(`${label} must contain ${min}–${max} characters.`);
}

export const queue = mutation({
  args: {
    requestId: v.string(),
    folioId: v.string(),
    kind: taskKind,
    instruction: v.string(),
    selectedText: v.string(),
    sources: v.array(sourceRef),
  },
  returns: v.id("instrumentTasks"),
  handler: async (ctx, args) => {
    const caller = await identity(ctx);
    bound(args.requestId, 1, 128, "Request id");
    bound(args.folioId, 1, 256, "Folio id");
    bound(args.instruction, 1, 2000, "Task instruction");
    bound(args.selectedText, 1, 20_000, "Selected text");
    if (
      args.sources.length > 3 ||
      (args.kind === "source-research" && !args.sources.length)
    )
      throw new ConvexError(
        "Choose one to three account resources for source research.",
      );
    const seen = new Set<string>();
    for (const ref of args.sources) {
      bound(ref.sourceId, 1, 256, "Source id");
      bound(ref.uri, 1, 4096, "Resource URI");
      bound(ref.label, 1, 200, "Resource label");
      const key = JSON.stringify([ref.sourceId, ref.uri]);
      if (seen.has(key)) throw new ConvexError("Choose each resource once.");
      seen.add(key);
    }
    const previous = await ctx.db
      .query("instrumentTasks")
      .withIndex("by_userId_and_requestId", (q) =>
        q.eq("userId", caller.tokenIdentifier).eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (
        previous.folioId !== args.folioId ||
        previous.kind !== args.kind ||
        previous.instruction !== args.instruction ||
        previous.selectedText !== args.selectedText ||
        JSON.stringify(previous.sources) !== JSON.stringify(args.sources)
      )
        throw new ConvexError("This request id belongs to a different task.");
      return previous._id;
    }
    if (!(await folioExists(ctx, caller.tokenIdentifier, args.folioId)))
      throw new ConvexError(
        "Sync this folio to your account before queueing a task.",
      );
    if (
      await ctx.db
        .query("accountDeletionJobs")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", caller.tokenIdentifier))
        .unique()
    )
      throw new ConvexError("Account deletion is in progress.");
    const productSubject = caller.subject || caller.tokenIdentifier;
    const link = await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", productSubject),
      )
      .unique();
    if (link?.verificationMethod !== "notorganic_pkce")
      throw new ConvexError(
        "Reconnect your Not Organic account before queueing durable tasks.",
      );
    try {
      await consumeRateLimit(ctx, {
        action: "instrumentTasks:queue",
        identifier: caller.tokenIdentifier,
        ...RATE_LIMITS.agentRoom,
      });
    } catch (error) {
      if (error instanceof RateLimitError)
        throw new ConvexError(
          "Too many tasks queued. Wait a minute before queueing another.",
        );
      throw error;
    }
    const now = Date.now();
    const taskId = await ctx.db.insert("instrumentTasks", {
      ...args,
      userId: caller.tokenIdentifier,
      productSubject,
      did: link.did,
      sessionVersion: link.sessionVersion,
      fingerprint: instrumentTextFingerprint(args.selectedText),
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    const scheduledId = await ctx.scheduler.runAfter(0, runRef, { taskId });
    await ctx.db.patch("instrumentTasks", taskId, { scheduledId });
    return taskId;
  },
});
export const list = query({
  args: { folioId: v.string() },
  returns: v.array(publicTask),
  handler: async (ctx, { folioId }) => {
    const caller = await identity(ctx);
    const rows = await ctx.db
      .query("instrumentTasks")
      .withIndex("by_userId_and_folioId", (q) =>
        q.eq("userId", caller.tokenIdentifier).eq("folioId", folioId),
      )
      .order("desc")
      .take(50);
    return rows.map(view);
  },
});
export const cancel = mutation({
  args: { taskId: v.id("instrumentTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const task = await owned(ctx, taskId);
    if (instrumentTaskCanCancel(task.status)) {
      if (task.status === "queued" && task.scheduledId)
        await ctx.scheduler.cancel(task.scheduledId);
      await ctx.db.patch("instrumentTasks", taskId, {
        status: "cancelled",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
export const saveFeedback = mutation({
  args: {
    taskId: v.id("instrumentTasks"),
    verdict: feedback.fields.verdict,
    comment: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    if (task.status !== "complete")
      throw new ConvexError("Feedback needs a completed result.");
    if (args.comment.length > 2000)
      throw new ConvexError("Feedback is limited to 2000 characters.");
    await ctx.db.patch("instrumentTasks", task._id, {
      feedback: {
        verdict: args.verdict,
        comment: args.comment,
        updatedAt: Date.now(),
      },
    });
    return null;
  },
});
export const claim = internalMutation({
  args: { taskId: v.id("instrumentTasks"), leaseToken: v.string() },
  returns: v.union(v.null(), taskDocument),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("instrumentTasks", args.taskId);
    if (!task || task.status !== "queued") return null;
    if (!(await permitted(ctx, task))) {
      await ctx.db.patch("instrumentTasks", task._id, {
        status: "failed",
        failureKind: "needs-input",
        error:
          "This folio or account connection changed. Reconnect and queue a new task.",
        updatedAt: Date.now(),
      });
      return null;
    }
    const leaseExpiresAt = Date.now() + INSTRUMENT_LEASE_MS;
    await ctx.db.patch("instrumentTasks", task._id, {
      status: "claimed",
      attempts: task.attempts + 1,
      leaseToken: args.leaseToken,
      leaseExpiresAt,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(INSTRUMENT_LEASE_MS + 1, expireRef, args);
    return await ctx.db.get("instrumentTasks", task._id);
  },
});
export const start = internalMutation({
  args: { taskId: v.id("instrumentTasks"), leaseToken: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("instrumentTasks", args.taskId);
    if (
      !task ||
      task.status !== "claimed" ||
      task.leaseToken !== args.leaseToken ||
      (task.leaseExpiresAt ?? 0) <= Date.now()
    )
      return false;
    if (!(await permitted(ctx, task))) {
      await ctx.db.patch("instrumentTasks", task._id, {
        status: "failed",
        failureKind: "needs-input",
        error: "This folio or account connection changed before work started.",
        updatedAt: Date.now(),
      });
      return false;
    }
    await ctx.db.patch("instrumentTasks", task._id, {
      status: "running",
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const isCurrent = internalQuery({
  args: {
    taskId: v.id("instrumentTasks"),
    leaseToken: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("instrumentTasks", args.taskId);
    return (
      !!task &&
      task.status === "running" &&
      task.leaseToken === args.leaseToken &&
      (task.leaseExpiresAt ?? 0) > args.now &&
      (await permitted(ctx, task))
    );
  },
});
export const finish = internalMutation({
  args: {
    taskId: v.id("instrumentTasks"),
    leaseToken: v.string(),
    result: v.optional(taskResult),
    error: v.optional(v.string()),
    failureKind: v.optional(failureKind),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("instrumentTasks", args.taskId);
    if (
      !task ||
      task.status !== "running" ||
      task.leaseToken !== args.leaseToken ||
      (task.leaseExpiresAt ?? 0) <= Date.now()
    )
      return false;
    if (!(await permitted(ctx, task))) {
      await ctx.db.patch("instrumentTasks", task._id, {
        status: "failed",
        error:
          "The account connection or folio changed. The result was discarded.",
        failureKind: "needs-input",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
      return false;
    }
    if (
      args.result &&
      (!args.result.text.trim() ||
        args.result.text.length > 30_000 ||
        args.result.citations.length !== task.sources.length ||
        args.result.citations.some(
          (ref, index) =>
            ref.excerpt.length > 8000 ||
            !ref.excerpt.trim() ||
            ref.fingerprint !== instrumentTextFingerprint(ref.excerpt) ||
            task.sources[index]?.sourceId !== ref.sourceId ||
            task.sources[index]?.uri !== ref.uri ||
            task.sources[index]?.label !== ref.label,
        ))
    )
      throw new Error("Invalid instrument result.");
    await ctx.db.patch("instrumentTasks", task._id, {
      status: args.result ? "complete" : "failed",
      result: args.result,
      error: args.result
        ? undefined
        : (args.error ?? "The provider did not return a result.").slice(0, 500),
      failureKind: args.result
        ? undefined
        : (args.failureKind ?? "provider-unavailable"),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});
const usageRef = makeFunctionReference<
  "mutation",
  { ownerId: string; event: unknown },
  { inserted: boolean }
>("usage:recordTrustedEvent");
/** Attribute actual provider attempts even when the writer cancels the result. */
export const recordUsage = internalMutation({
  args: { taskId: v.id("instrumentTasks"), event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("instrumentTasks", args.taskId);
    if (task && (await permitted(ctx, task)))
      await ctx.runMutation(usageRef, {
        ownerId: task.userId,
        event: args.event,
      });
    return null;
  },
});
export const expireLease = internalMutation({
  args: { taskId: v.id("instrumentTasks"), leaseToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("instrumentTasks", args.taskId);
    if (
      !task ||
      task.leaseToken !== args.leaseToken ||
      (task.leaseExpiresAt ?? Infinity) > Date.now() ||
      (task.status !== "claimed" && task.status !== "running")
    )
      return null;
    // Only a claim with no external dispatch is safe to retry. A running job
    // may have spent provider credit, so an unknown outcome is never replayed.
    if (task.status === "claimed" && task.attempts < INSTRUMENT_MAX_CLAIMS) {
      const scheduledId = await ctx.scheduler.runAfter(0, runRef, {
        taskId: task._id,
      });
      await ctx.db.patch("instrumentTasks", task._id, {
        status: "queued",
        scheduledId,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch("instrumentTasks", task._id, {
        status: "failed",
        error:
          task.status === "running"
            ? "The provider outcome is unknown. No automatic retry was sent; queue a new task if needed."
            : "The worker could not start after three claims. Queue a new task to try again.",
        failureKind:
          task.status === "running"
            ? "outcome-unknown"
            : "provider-unavailable",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
