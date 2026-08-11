/// <reference types="vite/client" />

/**
 * The row-per-item collections, and the migration into them.
 *
 * These tests exist because the change they cover is the kind that loses a
 * writer's folios quietly: the storage moved, the contract did not, and the
 * only thing standing between the two is the translation below. Every case
 * here is one where a plausible implementation silently drops data — an item
 * that round-trips out of order, a legacy document read after it was migrated,
 * a backfill that overwrites newer rows with the copy it found.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("../**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

const userId = "test-issuer|collections-user";

function setup() {
  const t = convexTest(schema, modules);
  return { t, user: t.withIdentity({ tokenIdentifier: userId }) };
}

const folio = (id: string, name: string, updatedAt = 1) => ({
  id,
  name,
  type: "draft",
  createdAt: 1,
  updatedAt,
});

describeConvex("per-item collections", () => {
  test("an array round-trips through row storage unchanged, in order", async () => {
    const { user } = setup();
    const folios = [folio("f1", "First"), folio("f2", "Second"), folio("f3", "Third")];

    await user.mutation(api.sync.putFolios, { folios });
    const read = await user.query(api.sync.getFolios, {});

    expect(read.folios).toEqual(folios);
  });

  test("order survives a reordering, not just the first write", async () => {
    const { user } = setup();
    await user.mutation(api.sync.putFolios, {
      folios: [folio("f1", "First"), folio("f2", "Second")],
    });
    await user.mutation(api.sync.putFolios, {
      folios: [folio("f2", "Second"), folio("f1", "First")],
    });

    const read = await user.query(api.sync.getFolios, {});
    expect((read.folios as Array<{ id: string }>).map((f) => f.id)).toEqual(["f2", "f1"]);
  });

  test("an item dropped from the array is deleted, not resurrected", async () => {
    const { user } = setup();
    await user.mutation(api.sync.putFolios, {
      folios: [folio("f1", "First"), folio("f2", "Second")],
    });
    await user.mutation(api.sync.putFolios, { folios: [folio("f1", "First")] });

    const read = await user.query(api.sync.getFolios, {});
    // The delete channel the single-document arrangement had by accident.
    expect((read.folios as Array<{ id: string }>).map((f) => f.id)).toEqual(["f1"]);
  });

  test("editing one folio leaves the others' rows untouched", async () => {
    const { t, user } = setup();
    await user.mutation(api.sync.putFolios, {
      folios: [folio("f1", "First"), folio("f2", "Second"), folio("f3", "Third")],
    });
    const before = await t.run(async (ctx) =>
      ctx.db
        .query("folioEntries")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
    );

    await user.mutation(api.sync.putFolios, {
      folios: [folio("f1", "First"), folio("f2", "Second, revised", 2), folio("f3", "Third")],
    });
    const after = await t.run(async (ctx) =>
      ctx.db
        .query("folioEntries")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
    );

    // The whole reason the table exists: one edit, one row rewritten.
    const moved = after.filter((row) => {
      const was = before.find((b) => b.itemId === row.itemId);
      return !was || was.updatedAt !== row.updatedAt;
    });
    expect(moved.map((row) => row.itemId)).toEqual(["f2"]);
  });

  test("the three collections do not see each other's items", async () => {
    const { user } = setup();
    await user.mutation(api.sync.putFolios, { folios: [folio("f1", "Draft")] });
    await user.mutation(api.sync.putCustomPersonas, {
      personas: [{ id: "p1", name: "The Skeptic" }],
    });

    expect((await user.query(api.sync.getFolios, {})).folios).toHaveLength(1);
    expect(
      (await user.query(api.sync.getCustomPersonas, {})).personas,
    ).toEqual([{ id: "p1", name: "The Skeptic" }]);
  });

  test("one writer's collection is invisible to another", async () => {
    const { t } = setup();
    const a = t.withIdentity({ tokenIdentifier: "test-issuer|writer-a" });
    const b = t.withIdentity({ tokenIdentifier: "test-issuer|writer-b" });

    await a.mutation(api.sync.putFolios, { folios: [folio("f1", "A's draft")] });

    expect((await b.query(api.sync.getFolios, {})).folios).toEqual([]);
  });
});

describeConvex("migration off the single-document collections", () => {
  /** Seed the pre-migration shape directly, as a real account would hold it. */
  async function seedLegacyFolios(
    t: ReturnType<typeof convexTest>,
    folios: unknown[],
    updatedAt = 5_000,
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("folios", { userId, folios, updatedAt });
    });
  }

  test("a legacy document is readable before anything migrates it", async () => {
    const { t, user } = setup();
    await seedLegacyFolios(t, [folio("f1", "Written last year")]);

    const read = await user.query(api.sync.getFolios, {});
    expect(read.folios).toEqual([folio("f1", "Written last year")]);
    expect(read.updatedAt).toBe(5_000);
  });

  test("the backfill converts a legacy document and removes it", async () => {
    const { t, user } = setup();
    await seedLegacyFolios(t, [folio("f1", "One"), folio("f2", "Two")]);

    const result = await t.run(async (ctx) => {
      const { migrateCollection } = await import("./collections");
      return await migrateCollection(ctx, "folioEntries", userId);
    });

    expect(result).toEqual({ migrated: 2 });
    const rows = await t.run(async (ctx) => ctx.db.query("folioEntries").collect());
    expect(rows).toHaveLength(2);
    // No second copy left behind to disagree with the first.
    const legacy = await t.run(async (ctx) => ctx.db.query("folios").collect());
    expect(legacy).toHaveLength(0);
    expect((await user.query(api.sync.getFolios, {})).folios).toEqual([
      folio("f1", "One"),
      folio("f2", "Two"),
    ]);
  });

  test("migration preserves the collection's age, so newer-wins still works", async () => {
    const { t, user } = setup();
    await seedLegacyFolios(t, [folio("f1", "Old")], 1_234);

    await t.run(async (ctx) => {
      const { migrateCollection } = await import("./collections");
      await migrateCollection(ctx, "folioEntries", userId);
    });

    // A migrated collection must not look freshly edited, or the sign-in merge
    // would treat the server copy as newer than a device's real work.
    expect((await user.query(api.sync.getFolios, {})).updatedAt).toBe(1_234);
  });

  test("a write migrates the user and the legacy document stops being read", async () => {
    const { t, user } = setup();
    await seedLegacyFolios(t, [folio("f1", "Stale"), folio("f2", "Also stale")]);

    await user.mutation(api.sync.putFolios, { folios: [folio("f9", "Current")] });

    const legacy = await t.run(async (ctx) => ctx.db.query("folios").collect());
    expect(legacy).toHaveLength(0);
    expect((await user.query(api.sync.getFolios, {})).folios).toEqual([
      folio("f9", "Current"),
    ]);
  });

  test("the backfill never overwrites rows a write already migrated", async () => {
    const { t, user } = setup();
    // The dangerous interleaving: a user writes (migrating themselves), and the
    // cron then finds a legacy document that a concurrent insert left behind.
    await user.mutation(api.sync.putFolios, { folios: [folio("f9", "Current")] });
    await seedLegacyFolios(t, [folio("f1", "Ancient")], 1);

    const result = await t.run(async (ctx) => {
      const { migrateCollection } = await import("./collections");
      return await migrateCollection(ctx, "folioEntries", userId);
    });

    expect(result).toEqual({ migrated: 0 });
    expect((await user.query(api.sync.getFolios, {})).folios).toEqual([
      folio("f9", "Current"),
    ]);
  });

  test("migrating twice is a no-op rather than a duplication", async () => {
    const { t, user } = setup();
    await seedLegacyFolios(t, [folio("f1", "One")]);

    await t.run(async (ctx) => {
      const { migrateCollection } = await import("./collections");
      await migrateCollection(ctx, "folioEntries", userId);
      await migrateCollection(ctx, "folioEntries", userId);
    });

    expect((await user.query(api.sync.getFolios, {})).folios).toHaveLength(1);
  });
});

describeConvex("pushAll and pullAll over the new storage", () => {
  test("rejects a stale bulk push without overwriting the current revision", async () => {
    const { user } = setup();
    const first = await user.mutation(api.sync.pushAll, {
      expectedRevision: 0,
      folios: [folio("f1", "Draft")],
    });
    expect(first.revision).toBe(1);

    await expect(
      user.mutation(api.sync.pushAll, {
        expectedRevision: 0,
        folios: [folio("f1", "Stale draft", 2)],
      }),
    ).rejects.toThrow("SYNC_CONFLICT");

    const unchanged = await user.query(api.sync.pullAll, {});
    expect(unchanged.syncRevision).toBe(1);
    expect(unchanged.folios).toEqual([folio("f1", "Draft")]);

    const second = await user.mutation(api.sync.pushAll, {
      expectedRevision: 1,
      folios: [folio("f1", "Reconciled draft", 3)],
    });
    expect(second.revision).toBe(2);
  });

  test("a full snapshot round-trips every collection", async () => {
    const { user } = setup();
    await user.mutation(api.sync.pushAll, {
      folios: [folio("f1", "Draft")],
      customPersonas: [{ id: "p1", name: "The Skeptic" }],
      bibliography: [{ id: "b1", title: "A Source", accessedAt: 1, createdAt: 1 }],
    });

    const remote = await user.query(api.sync.pullAll, {});
    expect(remote.folios).toEqual([folio("f1", "Draft")]);
    expect(remote.customPersonas).toEqual([{ id: "p1", name: "The Skeptic" }]);
    expect(remote.bibliography).toHaveLength(1);
  });

  test("an untouched collection is left alone by a partial push", async () => {
    const { user } = setup();
    await user.mutation(api.sync.pushAll, {
      folios: [folio("f1", "Draft")],
      bibliography: [{ id: "b1", title: "A Source", accessedAt: 1, createdAt: 1 }],
    });

    // The diffing client omits sections that did not change. Omission must mean
    // "leave it", never "empty it".
    await user.mutation(api.sync.pushAll, {
      folios: [folio("f1", "Draft, revised", 2)],
    });

    const remote = await user.query(api.sync.pullAll, {});
    expect(remote.bibliography).toHaveLength(1);
    expect(remote.folios).toEqual([folio("f1", "Draft, revised", 2)]);
  });

  test("no persona record reads as null, not as an empty board", async () => {
    const { user } = setup();
    await user.mutation(api.sync.pushAll, { folios: [folio("f1", "Draft")] });

    // The browser's merge distinguishes "this account has no personas" from
    // "this account has an empty persona list".
    expect((await user.query(api.sync.pullAll, {})).customPersonas).toBeNull();
  });
});
