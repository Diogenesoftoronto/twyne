/**
 * Per-day writing activity, for the public "days writing" heatmap on the
 * author profile page. `recordActivity` is called (throttled, client-side)
 * whenever the editor autosaves; `getPublicActivity` reads it back by handle
 * for anyone viewing that writer's profile — same "no userId argument"
 * auth contract as `convex/sync.ts`, since recording is always about the
 * calling user's own activity.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { effectivePublicStats, normalizeHandle } from "./profiles";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { USAGE_LIMITS, utcDayFromTimestamp } from "../src/utils/usage-domain";

const MAX_ACTIVITY_DAYS = 90;
const MAX_ACTIVITY_DETAILS = 500;

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id.tokenIdentifier;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const recordActivity = mutation({
  args: { folioId: v.optional(v.string()) },
  returns: v.object({ day: v.string(), count: v.number() }),
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    if (
      folioId !== undefined &&
      (folioId.length < 1 || folioId.length > USAGE_LIMITS.opaqueId)
    ) {
      throw new Error(
        `folioId must contain 1-${USAGE_LIMITS.opaqueId} characters`,
      );
    }
    await consumeRateLimit(ctx, {
      action: "writingActivity:record",
      identifier: userId,
      ...RATE_LIMITS.writingActivity,
    });

    const day = todayUtc();
    const now = Date.now();
    const existing = await ctx.db
      .query("writingActivity")
      .withIndex("by_userId_day", (q) => q.eq("userId", userId).eq("day", day))
      .unique();

    const nextCount = (existing?.count ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: nextCount,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("writingActivity", {
        userId,
        day,
        count: 1,
        updatedAt: now,
      });
    }

    if (folioId) {
      const detail = await ctx.db
        .query("writingActivityDetails")
        .withIndex("by_userId_and_day_and_folioId", (q) =>
          q.eq("userId", userId).eq("day", day).eq("folioId", folioId),
        )
        .unique();
      if (detail) {
        await ctx.db.patch(detail._id, {
          count: detail.count + 1,
          lastOccurredAt: now,
        });
      } else {
        await ctx.db.insert("writingActivityDetails", {
          userId,
          day,
          folioId,
          count: 1,
          firstOccurredAt: now,
          lastOccurredAt: now,
        });
      }
    }
    return { day, count: nextCount };
  },
});

export const getPublicActivity = query({
  args: { handle: v.string() },
  returns: v.any(),
  handler: async (ctx, { handle }) => {
    const normalized = normalizeHandle(handle);
    const handleRow = await ctx.db
      .query("handles")
      .withIndex("by_handle", (q) => q.eq("handle", normalized))
      .unique();
    if (!handleRow) return null;

    const userId = handleRow.userId;
    const preferences = effectivePublicStats(handleRow);
    const days = preferences.writingHeatmap
      ? await ctx.db
          .query("writingActivity")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .order("desc")
          .take(371)
      : [];
    const folios = preferences.folioCount
      ? await ctx.db
          .query("folioEntries")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .take(1_001)
      : [];

    return {
      days: days.map((d) => ({ day: d.day, count: d.count })).reverse(),
      folioCount: preferences.folioCount
        ? Math.min(folios.length, 1_000)
        : null,
      folioCountTruncated: preferences.folioCount && folios.length > 1_000,
    };
  },
});

/** Private, bounded day and per-folio activity for the My Desk client. */
export const getMyActivity = query({
  args: { from: v.number(), to: v.number() },
  returns: v.any(),
  handler: async (ctx, { from, to }) => {
    const userId = await requireIdentity(ctx);
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      from >= to ||
      to - from > MAX_ACTIVITY_DAYS * 86_400_000
    ) {
      throw new Error("Activity range must cover at most 90 days");
    }
    const fromDay = utcDayFromTimestamp(from);
    const toDay = utcDayFromTimestamp(to - 1);
    const [days, detailRows] = await Promise.all([
      ctx.db
        .query("writingActivity")
        .withIndex("by_userId_day", (q) =>
          q.eq("userId", userId).gte("day", fromDay).lte("day", toDay),
        )
        .take(MAX_ACTIVITY_DAYS + 1),
      ctx.db
        .query("writingActivityDetails")
        .withIndex("by_userId_and_day", (q) =>
          q.eq("userId", userId).gte("day", fromDay).lte("day", toDay),
        )
        .take(MAX_ACTIVITY_DETAILS + 1),
    ]);
    return {
      days: days.map(({ day, count }) => ({ day, count })),
      details: detailRows.slice(0, MAX_ACTIVITY_DETAILS).map((row) => ({
        day: row.day,
        folioId: row.folioId,
        count: row.count,
        firstOccurredAt: row.firstOccurredAt,
        lastOccurredAt: row.lastOccurredAt,
      })),
      detailsTruncated: detailRows.length > MAX_ACTIVITY_DETAILS,
      legacyDayTotalsPresent: days.length > 0 && detailRows.length === 0,
    };
  },
});
