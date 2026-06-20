/**
 * Multiplayer collaboration API.
 *
 * When a Pro user clicks "Share", their local Lix blob is promoted to a
 * server-hosted instance (convex/sharedLix.ts). The owner and any invited
 * collaborators then open it with Lix sync enabled and `initSyncProcess`
 * pushes/pulls change-sets through the /lsp/* relay (convex/http.ts).
 *
 * Roles:
 *   owner     — full control (invite, remove, change roles, delete)
 *   editor    — read + write the document (Lix push/pull)
 *   commenter — read-only document access + presence (no push allowed)
 *
 * Every function reads the caller from `ctx.auth.getUserIdentity()`. There is
 * no userId argument — the Convex auth guideline is non-negotiable.
 *
 * Pro gating: only Pro subscribers can share a folio. Collaborators who are
 * invited don't need Pro — the owner's subscription covers the shared doc.
 * (This matches the product copy: "Multiuser is a feature of Pro.")
 */
import {
  mutation,
  query,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { userIsPro } from "./lib/entitlement";

const PRESENCE_COLORS = [
  "#c1272d",
  "#e8a92c",
  "#3b7dd8",
  "#2d8659",
  "#8b4cc7",
  "#d8652c",
  "#5c8cb8",
  "#a02c6d",
];

function pickColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

/* ── Identity + RBAC helpers ─────────────────────────────────────── */

async function requireIdentity(ctx: {
  auth: {
    getUserIdentity: () => Promise<{
      tokenIdentifier: string;
      email?: string;
    } | null>;
  };
}): Promise<{ tokenIdentifier: string; email?: string }> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id;
}

async function getCollaborator(
  ctx: { db: any },
  lixId: string,
  userId: string,
) {
  return await ctx.db
    .query("collaborators")
    .withIndex("by_lixId_userId", (q: any) =>
      q.eq("lixId", lixId).eq("userId", userId),
    )
    .first();
}

async function requireRole(
  ctx: { db: any },
  lixId: string,
  userId: string,
  roles: string[],
) {
  const collab = await getCollaborator(ctx, lixId, userId);
  if (!collab || collab.status !== "accepted") {
    throw new Error("Not a collaborator on this document");
  }
  if (!roles.includes(collab.role)) {
    throw new Error(`Requires ${roles.join(" or ")} role`);
  }
  return collab;
}

/* ── Sharing: promote local → shared ────────────────────────────── */

/**
 * Internal mutation that creates both the sharedLixBlobs metadata row and
 * the owner collaborator row. Called by the `shareFolio` action after the
 * blob has been stored via `ctx.storage.store()`.
 */
export const createShareRecord = internalMutation({
  args: {
    lixId: v.string(),
    ownerId: v.string(),
    folioId: v.string(),
    folioName: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.sharedLix.set, args);
    const now = Date.now();
    await ctx.db.insert("collaborators", {
      lixId: args.lixId,
      userId: args.ownerId,
      role: "owner",
      status: "accepted",
      invitedAt: now,
      acceptedAt: now,
    });
  },
});

export const shareFolio = action({
  args: {
    folioId: v.string(),
    folioName: v.string(),
    lixId: v.string(),
    blob: v.bytes(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ lixId: string; alreadyShared: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const userId = identity.tokenIdentifier;

    // Pro gate — only subscribers can promote a local doc to shared.
    const isPro = await userIsPro(ctx, userId);
    if (!isPro) {
      throw new Error("Sharing documents is a Pro feature.");
    }

    // Don't create a duplicate if this folio is already shared.
    const existing = await ctx.runQuery(internal.sharedLix.get, {
      lixId: args.lixId,
    });
    if (existing) {
      return { lixId: existing.lixId, alreadyShared: true };
    }

    // Store the blob in Convex file storage (action-only API), then create
    // the metadata + owner collaborator row via an internal mutation.
    const storageId = await ctx.storage.store(new Blob([args.blob]));
    await ctx.runMutation(internal.collaboration.createShareRecord, {
      lixId: args.lixId,
      ownerId: userId,
      folioId: args.folioId,
      folioName: args.folioName,
      storageId,
    });

    return { lixId: args.lixId, alreadyShared: false };
  },
});

/* ── Invitations ────────────────────────────────────────────────── */

export const inviteCollaborator = mutation({
  args: {
    lixId: v.string(),
    email: v.string(),
    role: v.union(v.literal("editor"), v.literal("commenter")),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    await requireRole(ctx, args.lixId, identity.tokenIdentifier, ["owner"]);

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required.");
    }

    // Look up the invitee by email via the better-auth component.
    const adapter = (await import("./_generated/api")).components.betterAuth
      .adapter as any;
    const invitee = await ctx.runQuery(adapter.findOne, {
      model: "user",
      where: [{ field: "email", operator: "eq", value: email }],
    });
    const inviteeUserId: string | null = invitee?._id ?? null;

    // If we found them, check for an existing collaborator row.
    if (inviteeUserId) {
      const existing = await ctx.db
        .query("collaborators")
        .withIndex("by_lixId_userId", (q) =>
          q.eq("lixId", args.lixId).eq("userId", inviteeUserId),
        )
        .first();
      if (existing) {
        return { alreadyInvited: true, role: existing.role };
      }
    }

    await ctx.db.insert("collaborators", {
      lixId: args.lixId,
      userId: inviteeUserId ?? email,
      role: args.role,
      status: "pending",
      invitedBy: identity.tokenIdentifier,
      invitedAt: Date.now(),
    });

    return { alreadyInvited: false };
  },
});

export const acceptInvitation = mutation({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    const userId = identity.tokenIdentifier;

    // Find pending invitations — either by userId or by email.
    const pending = await ctx.db
      .query("collaborators")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .collect();
    const invite = pending.find(
      (c) =>
        (c.userId === userId || c.userId === identity.email?.toLowerCase()) &&
        c.status === "pending",
    );
    if (!invite) throw new Error("No pending invitation found.");

    await ctx.db.patch(invite._id, {
      userId,
      status: "accepted",
      acceptedAt: Date.now(),
    });

    return { role: invite.role };
  },
});

export const rejectInvitation = mutation({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    const userId = identity.tokenIdentifier;

    const rows = await ctx.db
      .query("collaborators")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .collect();
    const invite = rows.find(
      (c) =>
        (c.userId === userId || c.userId === identity.email?.toLowerCase()) &&
        c.status === "pending",
    );
    if (invite) {
      await ctx.db.patch(invite._id, { status: "rejected" });
    }
    return { ok: true };
  },
});

/* ── Collaborator management ─────────────────────────────────────── */

export const getCollaborators = query({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    const me = await getCollaborator(ctx, lixId, identity.tokenIdentifier);
    if (!me || me.status !== "accepted") return [];

    const rows = await ctx.db
      .query("collaborators")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .collect();
    return rows
      .filter((r) => r.status !== "rejected")
      .map((r) => ({
        userId: r.userId,
        role: r.role,
        status: r.status,
        invitedAt: r.invitedAt,
        acceptedAt: r.acceptedAt,
      }));
  },
});

export const removeCollaborator = mutation({
  args: { lixId: v.string(), userId: v.string() },
  handler: async (ctx, { lixId, userId }) => {
    const identity = await requireIdentity(ctx);
    await requireRole(ctx, lixId, identity.tokenIdentifier, ["owner"]);

    const row = await getCollaborator(ctx, lixId, userId);
    if (!row) return { ok: true, missing: true };
    if (row.role === "owner") {
      throw new Error("Cannot remove the owner.");
    }
    await ctx.db.delete(row._id);
    return { ok: true, missing: false };
  },
});

export const updateRole = mutation({
  args: {
    lixId: v.string(),
    userId: v.string(),
    role: v.union(v.literal("editor"), v.literal("commenter")),
  },
  handler: async (ctx, { lixId, userId, role }) => {
    const identity = await requireIdentity(ctx);
    await requireRole(ctx, lixId, identity.tokenIdentifier, ["owner"]);

    const row = await getCollaborator(ctx, lixId, userId);
    if (!row) throw new Error("Collaborator not found.");
    if (row.role === "owner") {
      throw new Error("Cannot change the owner's role.");
    }
    await ctx.db.patch(row._id, { role });
    return { ok: true };
  },
});

/* ── Role lookup (client-side gating) ───────────────────────────── */

export const getMyRole = query({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    const row = await getCollaborator(ctx, lixId, identity.tokenIdentifier);
    if (!row || row.status !== "accepted") return null;
    return { role: row.role as "owner" | "editor" | "commenter" };
  },
});

/* ── Document lists ─────────────────────────────────────────────── */

export const listMyShares = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const rows = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .collect();
    return rows.map((r) => ({
      lixId: r.lixId,
      folioId: r.folioId,
      folioName: r.folioName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
});

export const listSharedWithMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const collabs = await ctx.db
      .query("collaborators")
      .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

    const results = [];
    for (const c of collabs) {
      if (c.role === "owner") continue;
      const doc = await ctx.db
        .query("sharedLixBlobs")
        .withIndex("by_lixId", (q) => q.eq("lixId", c.lixId))
        .first();
      if (doc) {
        results.push({
          lixId: doc.lixId,
          folioId: doc.folioId,
          folioName: doc.folioName,
          role: c.role,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        });
      }
    }
    return results;
  },
});

export const getSharedLixMeta = query({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    const row = await getCollaborator(ctx, lixId, identity.tokenIdentifier);
    if (!row || row.status !== "accepted") return null;
    const doc = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    if (!doc) return null;
    return {
      lixId: doc.lixId,
      folioId: doc.folioId,
      folioName: doc.folioName,
      ownerId: doc.ownerId,
      role: row.role as "owner" | "editor" | "commenter",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});

/* ── Presence ───────────────────────────────────────────────────── */

export const heartbeat = mutation({
  args: {
    lixId: v.string(),
    cursorPos: v.optional(v.number()),
    selectionAnchor: v.optional(v.number()),
    selectionHead: v.optional(v.number()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const userId = identity.tokenIdentifier;

    // Must be an accepted collaborator.
    await requireRole(ctx, args.lixId, userId, [
      "owner",
      "editor",
      "commenter",
    ]);

    const now = Date.now();
    const color = pickColor(userId);
    const name = args.displayName ?? identity.email ?? userId.slice(0, 8);

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_lixId_userId", (q) =>
        q.eq("lixId", args.lixId).eq("userId", userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        cursorPos: args.cursorPos,
        selectionAnchor: args.selectionAnchor,
        selectionHead: args.selectionHead,
        displayName: name,
        lastSeenAt: now,
      });
    } else {
      await ctx.db.insert("presence", {
        lixId: args.lixId,
        userId,
        displayName: name,
        email: identity.email,
        color,
        cursorPos: args.cursorPos,
        selectionAnchor: args.selectionAnchor,
        selectionHead: args.selectionHead,
        lastSeenAt: now,
      });
    }
    return { ok: true };
  },
});

/**
 * Active presence for a document. Stale entries (last seen > 30s ago) are
 * filtered out so the list only shows who's actually online.
 */
export const getPresence = query({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    const me = await getCollaborator(ctx, lixId, identity.tokenIdentifier);
    if (!me || me.status !== "accepted") return [];

    const STALE_MS = 30_000;
    const cutoff = Date.now() - STALE_MS;
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .filter((q) => q.gte(q.field("lastSeenAt"), cutoff))
      .collect();
    return rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      color: r.color,
      cursorPos: r.cursorPos,
      selectionAnchor: r.selectionAnchor,
      selectionHead: r.selectionHead,
      lastSeenAt: r.lastSeenAt,
    }));
  },
});

/* ── Unshare (owner deletes the shared doc) ──────────────────────── */

export const unshareFolio = mutation({
  args: { lixId: v.string() },
  handler: async (ctx, { lixId }) => {
    const identity = await requireIdentity(ctx);
    await requireRole(ctx, lixId, identity.tokenIdentifier, ["owner"]);

    // Delete the blob row and its file from storage.
    const doc = await ctx.db
      .query("sharedLixBlobs")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .first();
    if (doc) {
      if (doc.storageId) {
        try {
          await ctx.storage.delete(doc.storageId);
        } catch {
          // File may already be gone; the metadata cleanup is the
          // important part.
        }
      }
      await ctx.db.delete(doc._id);
    }

    // Delete all collaborator + presence rows.
    const collabs = await ctx.db
      .query("collaborators")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .collect();
    for (const c of collabs) await ctx.db.delete(c._id);

    const presence = await ctx.db
      .query("presence")
      .withIndex("by_lixId", (q) => q.eq("lixId", lixId))
      .collect();
    for (const p of presence) await ctx.db.delete(p._id);

    return { ok: true };
  },
});

/* ── Internal: consume a shared lixId for the LSP relay ─────────── */
// The relay in http.ts needs to verify the caller is a collaborator before
// allowing push/pull. This query is called from the httpAction's LspEnvironment.

export const isCollaborator = internalQuery({
  args: { lixId: v.string(), userId: v.string() },
  handler: async (ctx, { lixId, userId }) => {
    const row = await getCollaborator(ctx, lixId, userId);
    return row !== null && row.status === "accepted";
  },
});

export const getCollaboratorRole = internalQuery({
  args: { lixId: v.string(), userId: v.string() },
  handler: async (ctx, { lixId, userId }) => {
    const row = await getCollaborator(ctx, lixId, userId);
    if (!row || row.status !== "accepted") return null;
    return row.role as "owner" | "editor" | "commenter";
  },
});
