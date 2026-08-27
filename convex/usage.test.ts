/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  utcDayFromTimestamp,
  type UsageEvent,
} from "../src/utils/usage-domain";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

const ownerAId = "test-issuer|usage-owner-a";
const ownerBId = "test-issuer|usage-owner-b";

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    ownerA: t.withIdentity({ tokenIdentifier: ownerAId }),
    ownerB: t.withIdentity({ tokenIdentifier: ownerBId }),
  };
}

function event(
  overrides: Partial<UsageEvent> & Pick<UsageEvent, "eventKey">,
): UsageEvent {
  const occurredAt = overrides.occurredAt ?? Date.now() - 1_000;
  return {
    occurredAt,
    day: utcDayFromTimestamp(occurredAt),
    source: "byok",
    authority: "client_reported",
    feature: "persona-feedback",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    traceId: `trace:${overrides.eventKey}`,
    attempt: 1,
    outcome: "completed",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    costKind: "unknown",
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describeConvex("usage ledger", () => {
  test("requires auth and strictly validates client authority and feature", async () => {
    const { t, ownerA } = setup();
    await expect(
      t.mutation(api.usage.syncClientEvents, {
        events: [event({ eventKey: "anonymous" })],
      }),
    ).rejects.toThrow("Not signed in");
    await expect(
      ownerA.mutation(api.usage.syncClientEvents, {
        events: [
          event({
            eventKey: "hosted-forgery",
            source: "hosted",
            authority: "server",
          }),
        ],
      }),
    ).rejects.toThrow("Client synchronization cannot report hosted usage");
    await expect(
      ownerA.mutation(api.usage.syncClientEvents, {
        events: [
          { ...event({ eventKey: "bad-feature" }), feature: "attacker-key" },
        ],
      }),
    ).rejects.toThrow("supported usage feature");
  });

  test("is idempotent and keeps owners isolated", async () => {
    const { t, ownerA, ownerB } = setup();
    const usageEvent = event({ eventKey: "same-device-event" });
    await expect(
      ownerA.mutation(api.usage.syncClientEvents, { events: [usageEvent] }),
    ).resolves.toEqual({ accepted: 1, duplicates: 0 });
    await expect(
      ownerA.mutation(api.usage.syncClientEvents, { events: [usageEvent] }),
    ).resolves.toEqual({ accepted: 0, duplicates: 1 });
    await expect(
      ownerB.mutation(api.usage.syncClientEvents, { events: [usageEvent] }),
    ).resolves.toEqual({ accepted: 1, duplicates: 0 });

    expect((await ownerA.query(api.usage.getMyCoverage, {})).generations).toBe(
      1,
    );
    expect((await ownerB.query(api.usage.getMyCoverage, {})).generations).toBe(
      1,
    );
    const rows = await t.run((ctx) => ctx.db.query("aiUsageEvents").take(10));
    expect(rows.map((row) => row.ownerId).sort()).toEqual(
      [ownerAId, ownerBId].sort(),
    );
  });

  test("records every hosted attempt but counts one retrying logical action", async () => {
    const { t } = setup();
    const occurredAt = Date.now() - 2_000;
    const base = {
      occurredAt,
      day: utcDayFromTimestamp(occurredAt),
      source: "hosted" as const,
      authority: "server" as const,
      feature: "dossier-check" as const,
      provider: "openai",
      model: "gpt-5.5",
      editorialActionId: "dossier-action-1",
      traceId: "dossier-trace-1",
      costKind: "unknown" as const,
    };
    await t.mutation(internal.usage.recordTrustedEvent, {
      ownerId: ownerAId,
      event: {
        ...base,
        eventKey: "dossier-attempt-1",
        attempt: 1,
        outcome: "failed",
      },
    });
    await t.mutation(internal.usage.recordTrustedEvent, {
      ownerId: ownerAId,
      event: {
        ...base,
        eventKey: "dossier-attempt-2",
        attempt: 2,
        outcome: "completed",
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    });

    const lifetime = await t.run((ctx) =>
      ctx.db
        .query("aiUsageLifetimeTotals")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerAId))
        .unique(),
    );
    expect(lifetime).toMatchObject({
      generations: 2,
      completedGenerations: 1,
      failedGenerations: 1,
      logicalActions: 1,
      completedActions: 1,
      failedActions: 0,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
    expect(
      await t.run((ctx) => ctx.db.query("aiUsageEvents").take(10)),
    ).toHaveLength(2);
  });

  test("bounds client batches and range reads", async () => {
    const { ownerA } = setup();
    await expect(
      ownerA.mutation(api.usage.syncClientEvents, {
        events: Array.from({ length: 21 }, (_, index) =>
          event({ eventKey: `batch-${index}` }),
        ),
      }),
    ).rejects.toThrow("1-20");
    await expect(
      ownerA.query(api.usage.getMySummary, {
        from: 0,
        to: 91 * 86_400_000,
        now: 91 * 86_400_000,
      }),
    ).rejects.toThrow("at most 90 days");
  });

  test("deletes synchronized usage in batches while preserving isolation and writing activity", async () => {
    vi.useFakeTimers();
    const { t, ownerA, ownerB } = setup();
    await expect(
      t.mutation(api.usage.deleteMyUsageHistory, {}),
    ).rejects.toThrow("Not signed in");

    for (let offset = 0; offset < 55; offset += 20) {
      const events = Array.from(
        { length: Math.min(20, 55 - offset) },
        (_, index) => event({ eventKey: `delete-${offset + index}` }),
      );
      await ownerA.mutation(api.usage.syncClientEvents, { events });
    }
    await ownerB.mutation(api.usage.syncClientEvents, {
      events: [event({ eventKey: "other-owner-kept" })],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("writingActivity", {
        userId: ownerAId,
        day: utcDayFromTimestamp(Date.now()),
        count: 7,
        updatedAt: Date.now(),
      });
    });

    await expect(
      ownerA.mutation(api.usage.deleteMyUsageHistory, {}),
    ).resolves.toEqual({ deletionScheduled: true });
    await expect(
      ownerA.mutation(api.usage.deleteMyUsageHistory, {}),
    ).resolves.toEqual({ deletionScheduled: true });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("aiUsageDeletionJobs")
          .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerAId))
          .take(10),
      ),
    ).toHaveLength(1);

    await expect(
      ownerA.mutation(api.usage.syncClientEvents, {
        events: [event({ eventKey: "blocked-client" })],
      }),
    ).rejects.toThrow("deletion is in progress");
    await expect(
      t.mutation(internal.usage.recordTrustedEvent, {
        ownerId: ownerAId,
        event: event({
          eventKey: "blocked-hosted",
          source: "hosted",
          authority: "server",
        }),
      }),
    ).rejects.toThrow("deletion is in progress");

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const after = await t.run(async (ctx) => ({
      events: await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_ownerId_and_occurredAt", (q) =>
          q.eq("ownerId", ownerAId),
        )
        .take(100),
      dailyTotals: await ctx.db
        .query("aiUsageDailyTotals")
        .withIndex("by_ownerId_and_day", (q) => q.eq("ownerId", ownerAId))
        .take(100),
      dailyBreakdowns: await ctx.db
        .query("aiUsageDailyBreakdowns")
        .withIndex("by_ownerId_and_dimension_and_day", (q) =>
          q.eq("ownerId", ownerAId),
        )
        .take(100),
      lifetimeTotals: await ctx.db
        .query("aiUsageLifetimeTotals")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerAId))
        .take(100),
      lifetimeBreakdowns: await ctx.db
        .query("aiUsageLifetimeBreakdowns")
        .withIndex("by_ownerId_and_dimension_and_key", (q) =>
          q.eq("ownerId", ownerAId),
        )
        .take(100),
      deletionJob: await ctx.db
        .query("aiUsageDeletionJobs")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerAId))
        .unique(),
      writingActivity: await ctx.db
        .query("writingActivity")
        .withIndex("by_userId", (q) => q.eq("userId", ownerAId))
        .take(10),
      otherOwnerEvents: await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_ownerId_and_occurredAt", (q) =>
          q.eq("ownerId", ownerBId),
        )
        .take(10),
    }));
    expect(after.events).toEqual([]);
    expect(after.dailyTotals).toEqual([]);
    expect(after.dailyBreakdowns).toEqual([]);
    expect(after.lifetimeTotals).toEqual([]);
    expect(after.lifetimeBreakdowns).toEqual([]);
    expect(after.deletionJob).toBeNull();
    expect(after.writingActivity).toHaveLength(1);
    expect(after.otherOwnerEvents).toHaveLength(1);

    await expect(
      ownerA.mutation(api.usage.syncClientEvents, {
        events: [event({ eventKey: "after-delete" })],
      }),
    ).resolves.toEqual({ accepted: 1, duplicates: 0 });
  });
});
