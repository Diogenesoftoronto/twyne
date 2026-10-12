/** Opt-in, authenticated public desk projection; PDS transport stays in OAuth. */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { publicDeskRecord } from "../src/utils/public-desk-contract";

const statsRef = makeFunctionReference<
  "query",
  { handle: string; now: number },
  Record<string, unknown> | null
>("usage:getPublicStats");

async function owner(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  const rows = await ctx.db
    .query("handles")
    .withIndex("by_userId", (q) => q.eq("userId", identity.tokenIdentifier))
    .take(100);
  const row = rows.sort(
    (a, b) =>
      a.claimedAt - b.claimedAt ||
      a._creationTime - b._creationTime ||
      a._id.localeCompare(b._id),
  )[0];
  const link = await ctx.db
    .query("providerIdentities")
    .withIndex("by_productSubject", (q) =>
      q.eq("productSubject", identity.subject || identity.tokenIdentifier),
    )
    .unique();
  return {
    row,
    did: link?.verificationMethod === "notorganic_pkce" ? link.did : null,
  };
}

export const getStatus = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    pending: v.boolean(),
    did: v.union(v.string(), v.null()),
    linkedDid: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const { row, did } = await owner(ctx);
    const state = row?.deskPublication;
    return {
      enabled: state?.enabled ?? false,
      pending: !!state && state.syncedRevision !== state.revision,
      did: state?.did ?? did,
      linkedDid: did,
    };
  },
});

export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { enabled }) => {
    const { row, did } = await owner(ctx);
    if (!row) throw new Error("Claim a Twyne alias first.");
    if (enabled && !did)
      throw new Error("Sign in with Not Organic to verify your PDS identity.");
    const previous = row.deskPublication;
    if (!previous && !enabled) return null;
    if (
      enabled &&
      previous?.did &&
      did &&
      previous.did !== did &&
      (previous.enabled || previous.syncedRevision !== previous.revision)
    )
      throw new Error("Remove the desk from your previous PDS first.");
    if (previous?.enabled === enabled && (!enabled || previous.did === did))
      return null;
    await ctx.db.patch(row._id, {
      deskPublication: {
        enabled,
        did: enabled ? did! : previous!.did,
        revision: (previous?.revision ?? 0) + 1,
        publicationId: crypto.randomUUID(),
        updatedAt: Date.now(),
      },
    });
    return null;
  },
});

/** Rebuild only from persisted consent and the authenticated owner's data. */
export const prepare = mutation({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      did: v.string(),
      revision: v.number(),
      publicationId: v.string(),
      pending: v.boolean(),
      recordJson: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const { row, did } = await owner(ctx);
    if (!row?.deskPublication) return null;
    let state = row.deskPublication;
    const now = Date.now();
    // A missing/replaced identity can never publish; retain old DID for removal.
    const enabled = state.enabled && did === state.did;
    let payload: string | undefined;
    if (enabled) {
      const stats = await ctx.runQuery(statsRef, { handle: row.handle, now });
      const candidate = publicDeskRecord(row, stats ?? {}, now);
      const old = state.payload ? JSON.parse(state.payload) : null;
      // Stable timestamp/revision for retries of the same public snapshot.
      if (old) candidate.updatedAt = old.updatedAt;
      if (JSON.stringify(candidate) !== state.payload)
        candidate.updatedAt = new Date(now).toISOString();
      payload = JSON.stringify(candidate);
    }
    if (
      !state.publicationId ||
      state.enabled !== enabled ||
      state.payload !== payload
    ) {
      state = {
        ...state,
        enabled,
        payload,
        revision: state.revision + 1,
        publicationId: crypto.randomUUID(),
        updatedAt: now,
      };
      await ctx.db.patch(row._id, { deskPublication: state });
    }
    return {
      did: state.did,
      revision: state.revision,
      publicationId: state.publicationId!,
      pending: state.syncedRevision !== state.revision,
      recordJson: payload ?? null,
    };
  },
});

/** An older completion must never acknowledge a newer privacy choice. */
export const acknowledge = mutation({
  args: { revision: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { revision }) => {
    const { row } = await owner(ctx);
    if (!row?.deskPublication || row.deskPublication.revision !== revision)
      return false;
    await ctx.db.patch(row._id, {
      deskPublication: { ...row.deskPublication, syncedRevision: revision },
    });
    return true;
  },
});
