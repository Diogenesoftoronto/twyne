/**
 * Durable storage records for images embedded in manuscripts.
 *
 * The upload is intentionally a two-step flow:
 *  1. `generateUploadUrl` authenticates the caller and preflights the file.
 *  2. The client uploads to Convex, then calls `saveImage` with the returned
 *     storage id. `saveImage` validates Convex's authoritative metadata before
 *     recording ownership.
 *
 * No public function accepts an owner id. Ownership always comes from the
 * authenticated Convex identity.
 */

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_IMAGE_CONTENT_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

type SupportedImageContentType = (typeof SUPPORTED_IMAGE_CONTENT_TYPES)[number];

const supportedContentTypes = new Set<string>(SUPPORTED_IMAGE_CONTENT_TYPES);
const imageContentTypeValidator = v.union(
  v.literal("image/gif"),
  v.literal("image/jpeg"),
  v.literal("image/png"),
  v.literal("image/webp"),
);

const imageResultValidator = v.object({
  imageId: v.id("images"),
  folioId: v.string(),
  url: v.string(),
  contentType: imageContentTypeValidator,
  size: v.number(),
  createdAt: v.number(),
});

async function requireOwnerId(ctx: Pick<QueryCtx, "auth">): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity.tokenIdentifier;
}

function normalizeContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function validateImageMetadata(
  contentType: string | undefined,
  size: number,
): SupportedImageContentType {
  const normalized = normalizeContentType(contentType ?? "");
  if (!supportedContentTypes.has(normalized)) {
    throw new Error("Unsupported image type");
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Image size must be a positive integer");
  }
  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image exceeds the 10 MB limit");
  }
  return normalized as SupportedImageContentType;
}

async function serializeImage(
  ctx: Pick<QueryCtx, "storage">,
  image: Doc<"images">,
) {
  const url = await ctx.storage.getUrl(image.storageId);
  if (!url) throw new Error("Image file not found");
  return {
    imageId: image._id,
    folioId: image.folioId,
    url,
    contentType: image.contentType,
    size: image.size,
    createdAt: image.createdAt,
  };
}

/** Mint a short-lived Convex upload URL after authenticating and preflighting. */
export const generateUploadUrl = mutation({
  args: {
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.object({ uploadUrl: v.string() }),
  handler: async (ctx, args) => {
    await requireOwnerId(ctx);
    validateImageMetadata(args.contentType, args.size);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

/**
 * Register an uploaded blob as an image owned by the authenticated caller.
 * The authoritative content type and size come from Convex's system table,
 * never from client arguments.
 */
export const saveImage = mutation({
  args: {
    folioId: v.string(),
    storageId: v.id("_storage"),
  },
  returns: imageResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded image not found");

    const contentType = validateImageMetadata(
      metadata.contentType,
      metadata.size,
    );

    const existing = await ctx.db
      .query("images")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) {
      if (existing.ownerId !== ownerId) {
        throw new Error("Image not found");
      }
      return await serializeImage(ctx, existing);
    }

    const createdAt = Date.now();
    const imageId = await ctx.db.insert("images", {
      ownerId,
      folioId: args.folioId,
      storageId: args.storageId,
      contentType,
      size: metadata.size,
      createdAt,
    });

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Uploaded image not found");
    return {
      imageId,
      folioId: args.folioId,
      url,
      contentType,
      size: metadata.size,
      createdAt,
    };
  },
});

/** Resolve an owned image to its current signed storage URL. */
export const getImage = query({
  args: { imageId: v.id("images") },
  returns: v.union(imageResultValidator, v.null()),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const image = await ctx.db.get("images", args.imageId);
    if (!image || image.ownerId !== ownerId) return null;
    return await serializeImage(ctx, image);
  },
});

/** Delete both the owned metadata row and its underlying Convex blob. */
export const deleteImage = mutation({
  args: { imageId: v.id("images") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const image = await ctx.db.get("images", args.imageId);
    if (!image || image.ownerId !== ownerId) {
      throw new Error("Image not found");
    }
    await ctx.storage.delete(image.storageId);
    await ctx.db.delete("images", image._id);
    return null;
  },
});
