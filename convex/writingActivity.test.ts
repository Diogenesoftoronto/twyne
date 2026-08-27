/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

const ownerAId = "test-issuer|activity-owner-a";

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    ownerA: t.withIdentity({ tokenIdentifier: ownerAId }),
  };
}

describeConvex("writing activity", () => {
  test("records day totals and content-free per-folio details together", async () => {
    const { t, ownerA } = setup();
    await ownerA.mutation(api.writingActivity.recordActivity, {
      folioId: "folio-a",
    });
    await ownerA.mutation(api.writingActivity.recordActivity, {
      folioId: "folio-a",
    });
    await ownerA.mutation(api.writingActivity.recordActivity, {
      folioId: "folio-b",
    });

    const totals = await t.run((ctx) =>
      ctx.db
        .query("writingActivity")
        .withIndex("by_userId", (q) => q.eq("userId", ownerAId))
        .take(10),
    );
    const details = await t.run((ctx) =>
      ctx.db
        .query("writingActivityDetails")
        .withIndex("by_userId_and_day", (q) => q.eq("userId", ownerAId))
        .take(10),
    );
    expect(totals).toHaveLength(1);
    expect(totals[0].count).toBe(3);
    expect(details.map(({ folioId, count }) => ({ folioId, count }))).toEqual([
      { folioId: "folio-a", count: 2 },
      { folioId: "folio-b", count: 1 },
    ]);
  });

  test("preserves legacy heatmaps without leaking newly private counts", async () => {
    const { t } = setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("handles", {
        userId: ownerAId,
        handle: "legacy-writer",
        claimedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("writingActivity", {
        userId: ownerAId,
        day: new Date(now).toISOString().slice(0, 10),
        count: 4,
        updatedAt: now,
      });
      await ctx.db.insert("folioEntries", {
        userId: ownerAId,
        itemId: "private-folio",
        item: { title: "Must not be public" },
        order: 0,
        updatedAt: now,
      });
    });

    await expect(
      t.query(api.writingActivity.getPublicActivity, {
        handle: "legacy-writer",
      }),
    ).resolves.toMatchObject({
      days: [{ count: 4 }],
      folioCount: null,
      folioCountTruncated: false,
    });
  });

  test("new profiles remain private until sharing is explicitly enabled", async () => {
    const { t, ownerA } = setup();
    await ownerA.mutation(api.profiles.claimHandle, { handle: "new-writer" });
    await ownerA.mutation(api.writingActivity.recordActivity, {
      folioId: "folio-private",
    });

    await expect(
      ownerA.query(api.writingActivity.getPublicActivity, {
        handle: "new-writer",
      }),
    ).resolves.toMatchObject({ days: [], folioCount: null });
    await expect(
      t.query(api.usage.getPublicStats, {
        handle: "new-writer",
        now: Date.now(),
      }),
    ).resolves.toEqual({});

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("folioEntries", {
        userId: ownerAId,
        itemId: "private-folio",
        item: { title: "Title is never projected" },
        order: 0,
        updatedAt: now,
      });
      await ctx.db.insert("published", {
        ownerId: ownerAId,
        ownerHandle: "new-writer",
        slug: "public-piece",
        folioId: "private-folio",
        kind: "post",
        title: "Public piece",
        content: "<p>Public.</p>",
        publishedAt: now,
        updatedAt: now,
      });
    });
    await ownerA.mutation(api.profiles.updatePublicStats, {
      writingHeatmap: true,
      daysWritten30: true,
      streak: "current",
      publicPieceCount: true,
      folioCount: true,
    });
    const projected = await t.query(api.usage.getPublicStats, {
      handle: "new-writer",
      now,
    });
    if (!projected) throw new Error("Expected an opted-in public projection");
    expect(projected).toMatchObject({
      daysWritten30: 1,
      streak: 1,
      streakKind: "current",
      publicPieceCount: 1,
      folioCount: 1,
    });
    expect(projected.writingHeatmap).toHaveLength(1);
    expect(JSON.stringify(projected)).not.toContain("Title is never projected");
  });

  test("rejects invalid folio ids and unbounded private ranges", async () => {
    const { ownerA } = setup();
    await expect(
      ownerA.mutation(api.writingActivity.recordActivity, { folioId: "" }),
    ).rejects.toThrow("folioId");
    await expect(
      ownerA.query(api.writingActivity.getMyActivity, {
        from: 0,
        to: 91 * 86_400_000,
      }),
    ).rejects.toThrow("at most 90 days");
  });
});
