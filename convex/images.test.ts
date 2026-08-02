/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_IMAGE_SIZE_BYTES } from "./images";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
// Convex's harness requires Vite's module glob transform. The repository-wide
// Bun gate also discovers `*.test.ts`; skip there and run this suite under the
// dedicated Vitest edge-runtime configuration instead of crashing at import.
const describeConvex = supportsViteModules ? describe : describe.skip;

const ownerAIdentity = { tokenIdentifier: "test-issuer|owner-a" };
const ownerBIdentity = { tokenIdentifier: "test-issuer|owner-b" };

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    ownerA: t.withIdentity(ownerAIdentity),
    ownerB: t.withIdentity(ownerBIdentity),
  };
}

type TestHarness = ReturnType<typeof setup>["t"];

/**
 * `convex-test` stores a real Blob but currently omits its MIME type from the
 * mock `_storage` row. Patch that system field so production metadata checks
 * receive the same shape Convex provides after an HTTP upload.
 */
async function storeImage(
  t: TestHarness,
  contentType: string,
  size: number,
): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(size)], { type: contentType }),
    );
    const systemWriter = ctx.db as unknown as {
      patch: (
        table: "_storage",
        id: Id<"_storage">,
        value: { contentType: string },
      ) => Promise<void>;
    };
    await systemWriter.patch("_storage", storageId, { contentType });
    return storageId;
  });
}

describeConvex("image upload validation", () => {
  test("rejects unauthenticated upload URL requests", async () => {
    const { t } = setup();

    await expect(
      t.mutation(api.images.generateUploadUrl, {
        contentType: "image/png",
        size: 1024,
      }),
    ).rejects.toThrow("Not signed in");
  });

  test("rejects unsupported and oversized upload declarations", async () => {
    const { ownerA } = setup();

    await expect(
      ownerA.mutation(api.images.generateUploadUrl, {
        contentType: "image/svg+xml",
        size: 1024,
      }),
    ).rejects.toThrow("Unsupported image type");
    await expect(
      ownerA.mutation(api.images.generateUploadUrl, {
        contentType: "image/png",
        size: MAX_IMAGE_SIZE_BYTES + 1,
      }),
    ).rejects.toThrow("10 MB");
  });

  test("returns an upload URL for an authenticated supported image", async () => {
    const { ownerA } = setup();

    const result = await ownerA.mutation(api.images.generateUploadUrl, {
      contentType: "image/png",
      size: 1024,
    });

    expect(result.uploadUrl).toContain("/api/storage/upload?token=");
  });

  test("rejects unsupported and oversized authoritative storage metadata", async () => {
    const { t, ownerA } = setup();
    const svgStorageId = await storeImage(t, "image/svg+xml", 1024);
    const hugeStorageId = await storeImage(
      t,
      "image/png",
      MAX_IMAGE_SIZE_BYTES + 1,
    );

    await expect(
      ownerA.mutation(api.images.saveImage, {
        folioId: "folio-a",
        storageId: svgStorageId,
      }),
    ).rejects.toThrow("Unsupported image type");
    await expect(
      ownerA.mutation(api.images.saveImage, {
        folioId: "folio-a",
        storageId: hugeStorageId,
      }),
    ).rejects.toThrow("10 MB");

    const rows = await t.run((ctx) => ctx.db.query("images").take(10));
    expect(rows).toEqual([]);
  });
});

describeConvex("image ownership", () => {
  test("owner can save, resolve, and delete an image and its blob", async () => {
    const { t, ownerA } = setup();
    const storageId = await storeImage(t, "image/png", 1024);

    const saved = await ownerA.mutation(api.images.saveImage, {
      folioId: "folio-a",
      storageId,
    });
    expect(saved).toMatchObject({
      folioId: "folio-a",
      contentType: "image/png",
      size: 1024,
    });

    const storedRows = await t.run((ctx) =>
      ctx.db
        .query("images")
        .withIndex("by_ownerId", (q) =>
          q.eq("ownerId", ownerAIdentity.tokenIdentifier),
        )
        .take(10),
    );
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({
      ownerId: ownerAIdentity.tokenIdentifier,
      folioId: "folio-a",
      storageId,
    });

    const resolved = await ownerA.query(api.images.getImage, {
      imageId: saved.imageId,
    });
    expect(resolved).toMatchObject({
      imageId: saved.imageId,
      folioId: "folio-a",
      contentType: "image/png",
    });
    expect(resolved?.url).toMatch(
      /^https:\/\/some-deployment\.convex\.cloud\/api\/storage\/.+$/,
    );

    await expect(
      ownerA.mutation(api.images.deleteImage, { imageId: saved.imageId }),
    ).resolves.toBeNull();

    const deleted = await t.run(async (ctx) => ({
      row: await ctx.db.get("images", saved.imageId),
      metadata: await ctx.db.system.get("_storage", storageId),
      blob: await ctx.storage.get(storageId),
    }));
    expect(deleted).toEqual({ row: null, metadata: null, blob: null });
  });

  test("cross-owner claim, lookup, and deletion are denied", async () => {
    const { t, ownerA, ownerB } = setup();
    const storageId = await storeImage(t, "image/webp", 2048);
    const saved = await ownerA.mutation(api.images.saveImage, {
      folioId: "folio-a",
      storageId,
    });

    await expect(
      ownerB.mutation(api.images.saveImage, {
        folioId: "folio-b",
        storageId,
      }),
    ).rejects.toThrow("Image not found");
    await expect(
      ownerB.query(api.images.getImage, { imageId: saved.imageId }),
    ).resolves.toBeNull();
    await expect(
      ownerB.mutation(api.images.deleteImage, { imageId: saved.imageId }),
    ).rejects.toThrow("Image not found");

    const ownerResult = await ownerA.query(api.images.getImage, {
      imageId: saved.imageId,
    });
    expect(ownerResult?.imageId).toBe(saved.imageId);
    const metadata = await t.run((ctx) =>
      ctx.db.system.get("_storage", storageId),
    );
    expect(metadata).not.toBeNull();
  });
});
