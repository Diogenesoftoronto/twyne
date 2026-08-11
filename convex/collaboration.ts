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
import type { Id } from "./_generated/dataModel";
import { userIsPro } from "./lib/entitlement";
import { Resend } from "resend";

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

const collaboratorRole = v.union(v.literal("editor"), v.literal("commenter"));

export const createInvitation = internalMutation({
  args: {
    lixId: v.string(),
    email: v.string(),
    role: collaboratorRole,
    invitedBy: v.string(),
  },
  returns: v.object({
    alreadyInvited: v.boolean(),
    role: collaboratorRole,
    invitationId: v.union(v.id("collaborators"), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, args.lixId, args.invitedBy, ["owner"]);

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
        return {
          alreadyInvited: true,
          role: existing.role as "editor" | "commenter",
          invitationId: null,
        };
      }
    }

    const invitationId = await ctx.db.insert("collaborators", {
      lixId: args.lixId,
      userId: inviteeUserId ?? email,
      role: args.role,
      status: "pending",
      invitedBy: args.invitedBy,
      invitedAt: Date.now(),
    });

    return { alreadyInvited: false, role: args.role, invitationId };
  },
});

export const removeUndeliveredInvitation = internalMutation({
  args: {
    invitationId: v.id("collaborators"),
    invitedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("collaborators", args.invitationId);
    if (
      !invitation ||
      invitation.status !== "pending" ||
      invitation.invitedBy !== args.invitedBy
    ) {
      return false;
    }
    await ctx.db.delete("collaborators", invitation._id);
    return true;
  },
});

function inviteOrigin(): string {
  return (process.env.SITE_URL ?? "https://www.twyne.love").replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const inviteCollaborator = action({
  args: {
    lixId: v.string(),
    folioName: v.string(),
    email: v.string(),
    role: collaboratorRole,
  },
  returns: v.object({
    alreadyInvited: v.boolean(),
    role: collaboratorRole,
    emailDelivered: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const invitation: {
      alreadyInvited: boolean;
      role: "editor" | "commenter";
      invitationId: Id<"collaborators"> | null;
    } = await ctx.runMutation(internal.collaboration.createInvitation, {
      lixId: args.lixId,
      email: args.email,
      role: args.role,
      invitedBy: identity.tokenIdentifier,
    });

    if (invitation.alreadyInvited || !invitation.invitationId) {
      return {
        alreadyInvited: true,
        role: invitation.role,
        emailDelivered: false,
      };
    }

    const rollback = async () => {
      await ctx.runMutation(
        internal.collaboration.removeUndeliveredInvitation,
        {
          invitationId: invitation.invitationId!,
          invitedBy: identity.tokenIdentifier,
        },
      );
    };
    const apiKey = process.env.RESEND_API_KEY;
    const origin = inviteOrigin();
    if (!apiKey) {
      if (origin.startsWith("http://localhost")) {
        console.log(
          `[twyne-collaboration] Invite for ${args.email}: ${origin}/editor?shared=${encodeURIComponent(args.lixId)}`,
        );
        return {
          alreadyInvited: false,
          role: invitation.role,
          emailDelivered: false,
        };
      }
      await rollback();
      throw new Error("Collaboration email delivery is not configured.");
    }

    const inviteUrl = `${origin}/editor?shared=${encodeURIComponent(args.lixId)}`;
    const sender =
      process.env.RESEND_FROM_EMAIL ?? "Twyne <support@twyne.love>";
    const inviter = identity.email ?? "A Twyne writer";
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: sender,
      to: args.email.trim().toLowerCase(),
      subject: `${inviter} invited you to edit “${args.folioName}” in Twyne`,
      text: `${inviter} invited you to join “${args.folioName}” as ${args.role}.\n\nOpen the shared folio: ${inviteUrl}\n\nYou can ignore this email if you were not expecting it.`,
      html: `<p><strong>${escapeHtml(inviter)}</strong> invited you to join <strong>${escapeHtml(args.folioName)}</strong> as ${escapeHtml(args.role)}.</p><p><a href="${escapeHtml(inviteUrl)}">Open the shared folio</a></p><p>If you were not expecting this invitation, you can ignore this email.</p>`,
    });
    if (error) {
      await rollback();
      throw new Error("Failed to deliver the collaboration invitation.");
    }

    return {
      alreadyInvited: false,
      role: invitation.role,
      emailDelivered: true,
    };
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

/** Pending invitations for the signed-in writer, including invites sent before
 * they created their Twyne account and therefore addressed to their email. */
export const listPendingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const keys = [
      identity.tokenIdentifier,
      identity.email?.trim().toLowerCase(),
    ].filter((value): value is string => Boolean(value));
    const rows = (
      await Promise.all(
        keys.map((userId) =>
          ctx.db
            .query("collaborators")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((row) => row.status === "pending");

    const uniqueRows = [...new Map(rows.map((row) => [row._id, row])).values()];
    const invitations = await Promise.all(
      uniqueRows.map(async (row) => {
        const doc = await ctx.db
          .query("sharedLixBlobs")
          .withIndex("by_lixId", (q) => q.eq("lixId", row.lixId))
          .first();
        return doc
          ? {
              lixId: row.lixId,
              folioName: doc.folioName,
              role: row.role as "editor" | "commenter",
              invitedAt: row.invitedAt,
            }
          : null;
      }),
    );
    return invitations
      .filter(
        (invitation): invitation is NonNullable<typeof invitation> =>
          invitation !== null,
      )
      .sort((a, b) => b.invitedAt - a.invitedAt);
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
