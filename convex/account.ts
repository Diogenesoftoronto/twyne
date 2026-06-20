/**
 * Account deletion. The privacy policy promises users can "Delete your account
 * and synced data" once they've signed in — this is the workflow that backs
 * that promise.
 *
 * `deleteAccount` is auth-gated (the signed-in identity is the only authority,
 * per the Convex guideline — there is no userId argument) and wipes, in order:
 *
 *   1. Every app-owned row the user has synced (briefs, folios, persona notes,
 *      rubric, suggestions, room settings, lix snapshots, …) — the "synced
 *      data" the policy refers to.
 *   2. Their published pieces, comments, subscription, and admin self-removal.
 *   3. Best-effort: the better-auth identity (user, sessions, accounts) so the
 *      email and login credentials are purged and the account can't be reused.
 *
 * The synced-data deletion always succeeds and is the substantive guarantee.
 * The identity purge is defensive: if the better-auth component's internal
 * shape ever changes, it logs and the rest of the deletion still stands, the
 * caller is signed out, and the result reports `identityPurged: false` so we
 * can see it needs a follow-up.
 */
import { mutation } from "./_generated/server";
import { components } from "./_generated/api";

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const userId = identity.tokenIdentifier;
    const email = identity.email?.trim().toLowerCase() ?? null;
    const deleted: Record<string, number> = {};

    // ── Synced app data (per-user, keyed by userId). ──
    deleted.briefs = await deleteByUserId(ctx, "briefs", userId);
    deleted.folios = await deleteByUserId(ctx, "folios", userId);
    deleted.folioContent = await deleteByUserId(ctx, "folioContent", userId);
    deleted.customPersonas = await deleteByUserId(
      ctx,
      "customPersonas",
      userId,
    );
    deleted.personaNotes = await deleteByUserId(ctx, "personaNotes", userId);
    deleted.personaReplies = await deleteByUserId(
      ctx,
      "personaReplies",
      userId,
    );
    deleted.rubricResults = await deleteByUserId(ctx, "rubricResults", userId);
    deleted.suggestions = await deleteByUserId(ctx, "suggestions", userId);
    deleted.roomSettings = await deleteByUserId(ctx, "roomSettings", userId);
    deleted.lixBlobs = await deleteByUserId(ctx, "lixBlobs", userId);
    deleted.subscriptions = await deleteByUserId(ctx, "subscriptions", userId);

    // ── Published pieces + comments (keyed by ownerId). ──
    deleted.published = await deleteByOwner(ctx, "published", userId);
    deleted.userComments = await deleteByOwner(ctx, "userComments", userId);
    deleted.userCommentReplies = await deleteByOwner(
      ctx,
      "userCommentReplies",
      userId,
    );

    // ── Admin roster: remove self. ──
    deleted.admins = await deleteByUserId(ctx, "admins", userId);

    // ── Writer handle (handles table). ──
    deleted.handles = await deleteByUserId(ctx, "handles", userId);

    // ── Test OTP records (keyed by email) — tidy up if we have the email. ──
    if (email) {
      const otps = await ctx.db
        .query("e2eOtps")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      for (const o of otps) await ctx.db.delete(o._id);
      deleted.e2eOtps = otps.length;
    }

    // ── Best-effort better-auth identity purge. ──
    // Matched by email (which the identity carries for OTP/passkey accounts).
    // Failures here never fail the whole operation: the synced data is already
    // gone. The caller signs out client-side regardless of this outcome.
    let identityPurged = false;
    if (email) {
      try {
        identityPurged = await purgeBetterAuthIdentity(ctx, email);
      } catch (err) {
        console.error("[twyne:account] auth identity purge failed:", err);
      }
    }

    return { deleted, identityPurged, emailProvided: !!email };
  },
});

/* ── Helpers ────────────────────────────────────────────────────── */

async function deleteByUserId(
  ctx: { db: any },
  table: string,
  userId: string,
): Promise<number> {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length;
}

async function deleteByOwner(
  ctx: { db: any },
  table: string,
  ownerId: string,
): Promise<number> {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_ownerId", (q: any) => q.eq("ownerId", ownerId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length;
}

/**
 * Delete the better-auth user row (and cascade sessions/accounts) for the
 * given email via the better-auth component's internal adapter. The user row
 * holds the email; once it's gone the account can't be signed into even if
 * credential rows linger. Returns true when a user was found and deleted.
 *
 * The component's `deleteMany` mutation requires `paginationOpts` (it paginates
 * results internally). We pass a generous page size; sessions/accounts are
 * always small (< 100).
 */
async function purgeBetterAuthIdentity(
  ctx: { runQuery: any; runMutation: any },
  email: string,
): Promise<boolean> {
  const adapter = (components.betterAuth as any).adapter;

  const user = await ctx.runQuery(adapter.findOne, {
    model: "user",
    where: [{ field: "email", operator: "eq", value: email }],
  });
  if (!user?._id) return false;
  const btUserId: string = user._id;

  // Revoke active sessions and unlink auth accounts (OAuth/OTP) so nothing
  // remains that could re-authenticate the account.
  for (const model of ["session", "account"]) {
    await ctx.runMutation(adapter.deleteMany, {
      input: {
        model,
        where: [{ field: "userId", operator: "eq", value: btUserId }],
      },
      paginationOpts: { cursor: null, numItems: 1000 },
    });
  }

  // Finally remove the user row (carries the email) itself.
  await ctx.runMutation(adapter.deleteMany, {
    input: {
      model: "user",
      where: [{ field: "_id", operator: "eq", value: btUserId }],
    },
    paginationOpts: { cursor: null, numItems: 1000 },
  });
  return true;
}
