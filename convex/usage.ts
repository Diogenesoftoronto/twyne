import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import {
  parseUsageEvent,
  utcDayStart,
  utcDayFromTimestamp,
  type UsageEvent,
} from "../src/utils/usage-domain";
import { effectivePublicStats, normalizeHandle } from "./profiles";

const CLIENT_BATCH_LIMIT = 20;
const READ_LIMIT = 100;
const MAX_RANGE_DAYS = 90;
const FUTURE_SKEW_MS = 5 * 60 * 1_000;
const DELETE_BATCH_SIZE = 25;
const LAST_DELETE_PHASE = 4;

const continueUsageDeletionReference = makeFunctionReference<
  "mutation",
  { jobId: Id<"aiUsageDeletionJobs"> },
  null
>("usage:continueUsageHistoryDeletion");

type Dimension = "feature" | "provider_model" | "folio";

interface Metrics {
  generations: number;
  completedGenerations: number;
  failedGenerations: number;
  logicalActions: number;
  completedActions: number;
  failedActions: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
  localGenerations: number;
  unknownCostGenerations: number;
  creditMicrounits: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  inputTokensReported: number;
  outputTokensReported: number;
  cacheReadTokensReported: number;
  cacheWriteTokensReported: number;
  reasoningTokensReported: number;
  totalTokensReported: number;
  inputTokensMissing: number;
  outputTokensMissing: number;
  cacheReadTokensMissing: number;
  cacheWriteTokensMissing: number;
  reasoningTokensMissing: number;
  totalTokensMissing: number;
  reportedTotalDiscrepancies: number;
}

const ZERO_METRICS: Metrics = {
  generations: 0,
  completedGenerations: 0,
  failedGenerations: 0,
  logicalActions: 0,
  completedActions: 0,
  failedActions: 0,
  actualCostMicrousd: 0,
  estimatedCostMicrousd: 0,
  localGenerations: 0,
  unknownCostGenerations: 0,
  creditMicrounits: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  inputTokensReported: 0,
  outputTokensReported: 0,
  cacheReadTokensReported: 0,
  cacheWriteTokensReported: 0,
  reasoningTokensReported: 0,
  totalTokensReported: 0,
  inputTokensMissing: 0,
  outputTokensMissing: 0,
  cacheReadTokensMissing: 0,
  cacheWriteTokensMissing: 0,
  reasoningTokensMissing: 0,
  totalTokensMissing: 0,
  reportedTotalDiscrepancies: 0,
};

const METRIC_KEYS = Object.keys(ZERO_METRICS) as (keyof Metrics)[];

function omitOwnerId<T extends { ownerId: string }>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "ownerId"),
  );
}

async function requireOwner(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  // Usage ownership is deliberately stable across provider-specific subjects.
  return identity.tokenIdentifier;
}

function checkedEvent(value: unknown): UsageEvent {
  const result = parseUsageEvent(value);
  if (!result.ok) {
    throw new Error(
      `Invalid usage event: ${result.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.value;
}

function metricDelta(
  event: UsageEvent,
  actions: Pick<
    Metrics,
    "logicalActions" | "completedActions" | "failedActions"
  >,
): Metrics {
  const delta = { ...ZERO_METRICS, ...actions };
  delta.generations = 1;
  delta.completedGenerations = event.outcome === "completed" ? 1 : 0;
  delta.failedGenerations = event.outcome === "failed" ? 1 : 0;
  delta.actualCostMicrousd =
    event.costKind === "actual" ? (event.costMicrousd ?? 0) : 0;
  delta.estimatedCostMicrousd =
    event.costKind === "estimated" ? (event.costMicrousd ?? 0) : 0;
  delta.localGenerations = event.source === "local" ? 1 : 0;
  delta.unknownCostGenerations = event.costKind === "unknown" ? 1 : 0;
  delta.creditMicrounits = event.creditMicrounits ?? 0;

  const tokens = [
    ["inputTokens", event.inputTokens],
    ["outputTokens", event.outputTokens],
    ["cacheReadTokens", event.cacheReadTokens],
    ["cacheWriteTokens", event.cacheWriteTokens],
    ["reasoningTokens", event.reasoningTokens],
    ["totalTokens", event.totalTokens],
  ] as const;
  for (const [key, value] of tokens) {
    delta[key] = value ?? 0;
    delta[`${key}Reported` as keyof Metrics] = value === undefined ? 0 : 1;
    delta[`${key}Missing` as keyof Metrics] = value === undefined ? 1 : 0;
  }
  if (
    event.totalTokens !== undefined &&
    event.inputTokens !== undefined &&
    event.outputTokens !== undefined &&
    event.totalTokens !== event.inputTokens + event.outputTokens
  ) {
    delta.reportedTotalDiscrepancies = 1;
  }
  return delta;
}

function addMetrics(current: Metrics, delta: Metrics): Metrics {
  const result = { ...current };
  for (const key of METRIC_KEYS) result[key] += delta[key];
  return result;
}

function metricsFrom(row: Metrics): Metrics {
  const result = { ...ZERO_METRICS };
  for (const key of METRIC_KEYS) result[key] = row[key];
  return result;
}

async function actionDelta(
  ctx: MutationCtx,
  ownerId: string,
  event: UsageEvent,
): Promise<
  Pick<Metrics, "logicalActions" | "completedActions" | "failedActions">
> {
  if (!event.editorialActionId) {
    return {
      logicalActions: 1,
      completedActions: event.outcome === "completed" ? 1 : 0,
      failedActions: event.outcome === "failed" ? 1 : 0,
    };
  }
  const completed = await ctx.db
    .query("aiUsageEvents")
    .withIndex("by_ownerId_and_editorialActionId_and_outcome", (q) =>
      q
        .eq("ownerId", ownerId)
        .eq("editorialActionId", event.editorialActionId)
        .eq("outcome", "completed"),
    )
    .first();
  const failed = await ctx.db
    .query("aiUsageEvents")
    .withIndex("by_ownerId_and_editorialActionId_and_outcome", (q) =>
      q
        .eq("ownerId", ownerId)
        .eq("editorialActionId", event.editorialActionId)
        .eq("outcome", "failed"),
    )
    .first();
  if (!completed && !failed) {
    return {
      logicalActions: 1,
      completedActions: event.outcome === "completed" ? 1 : 0,
      failedActions: event.outcome === "failed" ? 1 : 0,
    };
  }
  if (!completed && failed && event.outcome === "completed") {
    return { logicalActions: 0, completedActions: 1, failedActions: -1 };
  }
  return { logicalActions: 0, completedActions: 0, failedActions: 0 };
}

async function upsertDailyTotal(
  ctx: MutationCtx,
  ownerId: string,
  day: string,
  delta: Metrics,
) {
  const existing = await ctx.db
    .query("aiUsageDailyTotals")
    .withIndex("by_ownerId_and_day", (q) =>
      q.eq("ownerId", ownerId).eq("day", day),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, addMetrics(metricsFrom(existing), delta));
  } else {
    await ctx.db.insert("aiUsageDailyTotals", { ownerId, day, ...delta });
  }
}

async function upsertLifetimeTotal(
  ctx: MutationCtx,
  ownerId: string,
  delta: Metrics,
) {
  const existing = await ctx.db
    .query("aiUsageLifetimeTotals")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, addMetrics(metricsFrom(existing), delta));
  } else {
    await ctx.db.insert("aiUsageLifetimeTotals", { ownerId, ...delta });
  }
}

async function upsertBreakdown(
  ctx: MutationCtx,
  ownerId: string,
  event: UsageEvent,
  dimension: Dimension,
  key: string,
  delta: Metrics,
) {
  const daily = await ctx.db
    .query("aiUsageDailyBreakdowns")
    .withIndex("by_ownerId_and_day_and_dimension_and_key", (q) =>
      q
        .eq("ownerId", ownerId)
        .eq("day", event.day)
        .eq("dimension", dimension)
        .eq("key", key),
    )
    .unique();
  if (daily) {
    await ctx.db.patch(daily._id, addMetrics(metricsFrom(daily), delta));
  } else {
    await ctx.db.insert("aiUsageDailyBreakdowns", {
      ownerId,
      day: event.day,
      dimension,
      key,
      ...delta,
    });
  }

  const lifetime = await ctx.db
    .query("aiUsageLifetimeBreakdowns")
    .withIndex("by_ownerId_and_dimension_and_key", (q) =>
      q.eq("ownerId", ownerId).eq("dimension", dimension).eq("key", key),
    )
    .unique();
  if (lifetime) {
    await ctx.db.patch(lifetime._id, addMetrics(metricsFrom(lifetime), delta));
  } else {
    await ctx.db.insert("aiUsageLifetimeBreakdowns", {
      ownerId,
      dimension,
      key,
      ...delta,
    });
  }
}

async function applyEvent(
  ctx: MutationCtx,
  ownerId: string,
  event: UsageEvent,
): Promise<boolean> {
  const duplicate = await ctx.db
    .query("aiUsageEvents")
    .withIndex("by_ownerId_and_eventKey", (q) =>
      q.eq("ownerId", ownerId).eq("eventKey", event.eventKey),
    )
    .unique();
  if (duplicate) return false;

  const actions = await actionDelta(ctx, ownerId, event);
  const delta = metricDelta(event, actions);
  await ctx.db.insert("aiUsageEvents", { ownerId, ...event });
  await upsertDailyTotal(ctx, ownerId, event.day, delta);
  await upsertLifetimeTotal(ctx, ownerId, delta);
  await Promise.all([
    upsertBreakdown(ctx, ownerId, event, "feature", event.feature, delta),
    upsertBreakdown(
      ctx,
      ownerId,
      event,
      "provider_model",
      `${event.provider}:${event.model}`,
      delta,
    ),
    upsertBreakdown(
      ctx,
      ownerId,
      event,
      "folio",
      event.folioId ?? "__none__",
      delta,
    ),
  ]);
  return true;
}

async function assertUsageIngestionAllowed(
  ctx: MutationCtx,
  ownerId: string,
): Promise<void> {
  const deletion = await ctx.db
    .query("aiUsageDeletionJobs")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
  if (deletion) {
    throw new Error("Usage history deletion is in progress");
  }
}

/** Server/provider-authoritative ingestion used only by hosted capture code. */
export const recordTrustedEvent = internalMutation({
  args: { ownerId: v.string(), event: v.any() },
  returns: v.object({ inserted: v.boolean() }),
  handler: async (ctx, args) => {
    await assertUsageIngestionAllowed(ctx, args.ownerId);
    const event = checkedEvent(args.event);
    if (event.source !== "hosted") {
      throw new Error("Trusted ingestion only accepts hosted events");
    }
    if (event.authority === "client_reported") {
      throw new Error("Trusted ingestion requires server/provider authority");
    }
    return { inserted: await applyEvent(ctx, args.ownerId, event) };
  },
});

/** Idempotently synchronizes a small batch from the authenticated browser. */
export const syncClientEvents = mutation({
  args: { events: v.array(v.any()) },
  returns: v.object({ accepted: v.number(), duplicates: v.number() }),
  handler: async (ctx, { events }) => {
    const ownerId = await requireOwner(ctx);
    await assertUsageIngestionAllowed(ctx, ownerId);
    if (events.length === 0 || events.length > CLIENT_BATCH_LIMIT) {
      throw new Error(`events must contain 1-${CLIENT_BATCH_LIMIT} items`);
    }
    const now = Date.now();
    const parsed = events.map(checkedEvent);
    for (const event of parsed) {
      if (event.source === "hosted") {
        throw new Error("Client synchronization cannot report hosted usage");
      }
      if (event.authority !== "client_reported") {
        throw new Error(
          "Client synchronization requires client_reported authority",
        );
      }
      if (event.occurredAt > now + FUTURE_SKEW_MS) {
        throw new Error("Usage event is too far in the future");
      }
    }
    let accepted = 0;
    for (const event of parsed) {
      if (await applyEvent(ctx, ownerId, event)) accepted += 1;
    }
    return { accepted, duplicates: parsed.length - accepted };
  },
});

/** Schedule deletion of synchronized AI usage without touching writing data. */
export const deleteMyUsageHistory = mutation({
  args: {},
  returns: v.object({ deletionScheduled: v.literal(true) }),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const existing = await ctx.db
      .query("aiUsageDeletionJobs")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (existing) return { deletionScheduled: true as const };

    const now = Date.now();
    const jobId = await ctx.db.insert("aiUsageDeletionJobs", {
      ownerId,
      phase: 0,
      deletedCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueUsageDeletionReference, { jobId });
    return { deletionScheduled: true as const };
  },
});

async function deleteUsagePhase(
  ctx: MutationCtx,
  ownerId: string,
  phase: number,
): Promise<number> {
  if (phase === 0) {
    const rows = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_ownerId_and_occurredAt", (q) => q.eq("ownerId", ownerId))
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  }
  if (phase === 1) {
    const rows = await ctx.db
      .query("aiUsageDailyTotals")
      .withIndex("by_ownerId_and_day", (q) => q.eq("ownerId", ownerId))
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  }
  if (phase === 2) {
    const rows = await ctx.db
      .query("aiUsageDailyBreakdowns")
      .withIndex("by_ownerId_and_dimension_and_day", (q) =>
        q.eq("ownerId", ownerId),
      )
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  }
  if (phase === 3) {
    const rows = await ctx.db
      .query("aiUsageLifetimeTotals")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(DELETE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  }
  const rows = await ctx.db
    .query("aiUsageLifetimeBreakdowns")
    .withIndex("by_ownerId_and_dimension_and_key", (q) =>
      q.eq("ownerId", ownerId),
    )
    .take(DELETE_BATCH_SIZE);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const continueUsageHistoryDeletion = internalMutation({
  args: { jobId: v.id("aiUsageDeletionJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("aiUsageDeletionJobs", jobId);
    if (!job) return null;
    if (job.phase > LAST_DELETE_PHASE) {
      await ctx.db.delete(job._id);
      return null;
    }

    const deleted = await deleteUsagePhase(ctx, job.ownerId, job.phase);
    if (deleted < DELETE_BATCH_SIZE && job.phase === LAST_DELETE_PHASE) {
      await ctx.db.delete(job._id);
      return null;
    }
    await ctx.db.patch(job._id, {
      phase: deleted < DELETE_BATCH_SIZE ? job.phase + 1 : job.phase,
      deletedCount: job.deletedCount + deleted,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, continueUsageDeletionReference, { jobId });
    return null;
  },
});

function validateRange(from: number, to: number) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from >= to ||
    to - from > MAX_RANGE_DAYS * 86_400_000
  ) {
    throw new Error("Usage range must cover at most 90 days");
  }
}

function validateAsOf(to: number, now: number) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(to) ||
    to < 1 ||
    to > now + 86_400_000
  ) {
    throw new Error("Invalid usage time boundary");
  }
}

export const getMySummary = query({
  args: {
    from: v.union(v.number(), v.null()),
    to: v.number(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { from, to, now }) => {
    const ownerId = await requireOwner(ctx);
    validateAsOf(to, now);
    if (from === null) {
      const lifetime = await ctx.db
        .query("aiUsageLifetimeTotals")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .unique();
      return lifetime ? metricsFrom(lifetime) : { ...ZERO_METRICS };
    }
    validateRange(from, to);
    const fromDay = utcDayFromTimestamp(from);
    const toDay = utcDayFromTimestamp(to - 1);
    const rows = await ctx.db
      .query("aiUsageDailyTotals")
      .withIndex("by_ownerId_and_day", (q) =>
        q.eq("ownerId", ownerId).gte("day", fromDay).lte("day", toDay),
      )
      .take(MAX_RANGE_DAYS + 1);
    return rows.reduce(
      (summary, row) => addMetrics(summary, metricsFrom(row)),
      { ...ZERO_METRICS },
    );
  },
});

export const getMyDaily = query({
  args: { from: v.number(), to: v.number() },
  returns: v.any(),
  handler: async (ctx, { from, to }) => {
    const ownerId = await requireOwner(ctx);
    validateRange(from, to);
    const fromDay = utcDayFromTimestamp(from);
    const toDay = utcDayFromTimestamp(to - 1);
    return await ctx.db
      .query("aiUsageDailyTotals")
      .withIndex("by_ownerId_and_day", (q) =>
        q.eq("ownerId", ownerId).gte("day", fromDay).lte("day", toDay),
      )
      .take(MAX_RANGE_DAYS + 1);
  },
});

export const getMyBreakdown = query({
  args: {
    from: v.union(v.number(), v.null()),
    to: v.number(),
    now: v.number(),
    dimension: v.union(
      v.literal("feature"),
      v.literal("provider_model"),
      v.literal("folio"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, { from, to, now, dimension, paginationOpts }) => {
    const ownerId = await requireOwner(ctx);
    validateAsOf(to, now);
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > READ_LIMIT) {
      throw new Error(`numItems must be between 1 and ${READ_LIMIT}`);
    }
    if (from === null) {
      const page = await ctx.db
        .query("aiUsageLifetimeBreakdowns")
        .withIndex("by_ownerId_and_dimension_and_key", (q) =>
          q.eq("ownerId", ownerId).eq("dimension", dimension),
        )
        .paginate(paginationOpts);
      return {
        ...page,
        page: page.page.map(omitOwnerId),
      };
    }
    validateRange(from, to);
    const fromDay = utcDayFromTimestamp(from);
    const toDay = utcDayFromTimestamp(to - 1);
    const page = await ctx.db
      .query("aiUsageDailyBreakdowns")
      .withIndex("by_ownerId_and_dimension_and_day", (q) =>
        q
          .eq("ownerId", ownerId)
          .eq("dimension", dimension)
          .gte("day", fromDay)
          .lte("day", toDay),
      )
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map(omitOwnerId),
    };
  },
});

export const listMyRecent = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, { paginationOpts }) => {
    const ownerId = await requireOwner(ctx);
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > READ_LIMIT) {
      throw new Error(`numItems must be between 1 and ${READ_LIMIT}`);
    }
    const result = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_ownerId_and_occurredAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map(omitOwnerId),
    };
  },
});

export const getMyCoverage = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const base = ctx.db
      .query("aiUsageEvents")
      .withIndex("by_ownerId_and_occurredAt", (q) => q.eq("ownerId", ownerId));
    const [first, last, lifetime] = await Promise.all([
      base.first(),
      ctx.db
        .query("aiUsageEvents")
        .withIndex("by_ownerId_and_occurredAt", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .first(),
      ctx.db
        .query("aiUsageLifetimeTotals")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .unique(),
    ]);
    return {
      firstOccurredAt: first?.occurredAt ?? null,
      lastOccurredAt: last?.occurredAt ?? null,
      generations: lifetime?.generations ?? 0,
      unknownCostGenerations: lifetime?.unknownCostGenerations ?? 0,
    };
  },
});

function streaks(days: string[], now: number) {
  const unique = [...new Set(days)].sort();
  let longest = 0;
  let run = 0;
  let previous = -1;
  for (const day of unique) {
    const timestamp = utcDayStart(day);
    run = previous >= 0 && timestamp - previous === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = timestamp;
  }
  const today = utcDayStart(utcDayFromTimestamp(now));
  const latest =
    unique.length > 0 ? utcDayStart(unique[unique.length - 1]) : -1;
  const current = latest === today || latest === today - 86_400_000 ? run : 0;
  return { current, longest };
}

/** Public projection containing only statistics the handle owner enabled. */
export const getPublicStats = query({
  args: { handle: v.string(), now: v.number() },
  returns: v.any(),
  handler: async (ctx, { handle, now }) => {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid now");
    const row = await ctx.db
      .query("handles")
      .withIndex("by_handle", (q) => q.eq("handle", normalizeHandle(handle)))
      .unique();
    if (!row) return null;
    const preferences = effectivePublicStats(row);
    const needsActivity =
      preferences.writingHeatmap ||
      preferences.daysWritten30 ||
      preferences.streak !== "off";
    const activity = needsActivity
      ? await ctx.db
          .query("writingActivity")
          .withIndex("by_userId", (q) => q.eq("userId", row.userId))
          .order("desc")
          .take(371)
      : [];
    const activityDays = activity.map((day) => day.day);
    const result: Record<string, unknown> = {};
    if (preferences.writingHeatmap) {
      result.writingHeatmap = activity
        .map(({ day, count }) => ({ day, count }))
        .reverse();
      result.writingHeatmapTruncated = activity.length === 371;
    }
    if (preferences.daysWritten30) {
      const today = utcDayStart(utcDayFromTimestamp(now));
      const fromDay = utcDayFromTimestamp(Math.max(0, today - 29 * 86_400_000));
      result.daysWritten30 = new Set(
        activityDays.filter((day) => day >= fromDay),
      ).size;
    }
    if (preferences.streak !== "off") {
      result.streak = streaks(activityDays, now)[preferences.streak];
      result.streakKind = preferences.streak;
      result.streakTruncated = activity.length === 371;
    }
    if (preferences.publicPieceCount) {
      const pieces = await ctx.db
        .query("published")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", row.userId))
        .take(1_001);
      result.publicPieceCount = Math.min(pieces.length, 1_000);
      result.publicPieceCountTruncated = pieces.length > 1_000;
    }
    if (preferences.folioCount) {
      const folios = await ctx.db
        .query("folioEntries")
        .withIndex("by_userId", (q) => q.eq("userId", row.userId))
        .take(1_001);
      result.folioCount = Math.min(folios.length, 1_000);
      result.folioCountTruncated = folios.length > 1_000;
    }
    return result;
  },
});

export type UsageEventDoc = Doc<"aiUsageEvents">;
