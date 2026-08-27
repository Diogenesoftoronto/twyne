/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { utcDayFromTimestamp } from "../src/utils/usage-domain";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;
const ownerId = "test-issuer|deletion-owner";
const otherOwnerId = "test-issuer|deletion-other";

afterEach(() => vi.useRealTimers());

describeConvex("account deletion", () => {
  test("removes usage and profile data in resumable bounded batches", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ tokenIdentifier: ownerId });
    const occurredAt = Date.now() - 1_000;
    for (let index = 0; index < 30; index += 1) {
      await t.mutation(internal.usage.recordTrustedEvent, {
        ownerId,
        event: {
          eventKey: `delete-event-${index}`,
          occurredAt,
          day: utcDayFromTimestamp(occurredAt),
          source: "hosted",
          authority: "server",
          feature: "persona-feedback",
          provider: "openai",
          model: "gpt-5.5",
          traceId: `delete-trace-${index}`,
          attempt: 1,
          outcome: "completed",
          costKind: "unknown",
        },
      });
    }
    await t.mutation(internal.usage.recordTrustedEvent, {
      ownerId: otherOwnerId,
      event: {
        eventKey: "keep-event",
        occurredAt,
        day: utcDayFromTimestamp(occurredAt),
        source: "hosted",
        authority: "server",
        feature: "persona-feedback",
        provider: "openai",
        model: "gpt-5.5",
        traceId: "keep-trace",
        attempt: 1,
        outcome: "completed",
        costKind: "unknown",
      },
    });
    await owner.mutation(api.profiles.claimHandle, { handle: "delete-me" });

    await expect(
      owner.mutation(api.account.deleteAccount, {}),
    ).resolves.toMatchObject({
      deletionScheduled: true,
      identityPurged: false,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const state = await t.run(async (ctx) => ({
      ownerEvents: await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_ownerId_and_occurredAt", (q) => q.eq("ownerId", ownerId))
        .take(100),
      otherEvents: await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_ownerId_and_occurredAt", (q) =>
          q.eq("ownerId", otherOwnerId),
        )
        .take(100),
      handle: await ctx.db
        .query("handles")
        .withIndex("by_userId", (q) => q.eq("userId", ownerId))
        .unique(),
      jobs: await ctx.db.query("accountDeletionJobs").take(10),
    }));
    expect(state.ownerEvents).toEqual([]);
    expect(state.otherEvents).toHaveLength(1);
    expect(state.handle).toBeNull();
    expect(state.jobs).toEqual([]);
  });
});
