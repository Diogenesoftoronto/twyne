import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { portablePreference } from "../src/utils/account-preferences-contract";

import { preferenceKind } from "./preferenceValidators";
const row = v.object({
  kind: preferenceKind,
  json: v.string(),
  revision: v.number(),
});
export const list = query({
  args: {},
  returns: v.array(row),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const rows = await ctx.db
      .query("accountPreferences")
      .withIndex("by_userId_and_kind", (q) =>
        q.eq("userId", identity.tokenIdentifier),
      )
      .take(6);
    const result = rows.map(({ kind, json, revision }) => ({
      kind,
      json,
      revision,
    }));
    // Existing accounts retain their previously saved room and palette.
    for (const kind of ["room", "appearance"] as const) {
      if (result.some((row) => row.kind === kind)) continue;
      const legacy =
        kind === "room"
          ? await ctx.db
              .query("roomSettings")
              .withIndex("by_userId", (q) =>
                q.eq("userId", identity.tokenIdentifier),
              )
              .unique()
          : await ctx.db
              .query("appearance")
              .withIndex("by_userId", (q) =>
                q.eq("userId", identity.tokenIdentifier),
              )
              .unique();
      if (legacy) {
        const value = "settings" in legacy ? legacy.settings : legacy;
        result.push({
          kind,
          json: JSON.stringify(portablePreference(kind, value)),
          revision: 0,
        });
      }
    }
    return result;
  },
});
export const put = mutation({
  args: {
    kind: preferenceKind,
    json: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.object({ accepted: v.boolean(), revision: v.number() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    if (args.json.length > 64000)
      throw new ConvexError("Preferences too large");
    const json = JSON.stringify(
      portablePreference(args.kind, JSON.parse(args.json)),
    );
    const userId = identity.tokenIdentifier;
    const existing = await ctx.db
      .query("accountPreferences")
      .withIndex("by_userId_and_kind", (q) =>
        q.eq("userId", userId).eq("kind", args.kind),
      )
      .unique();
    const revision = existing?.revision ?? 0;
    if (args.expectedRevision !== revision)
      return { accepted: false, revision };
    const update = { json, revision: revision + 1 };
    if (existing) await ctx.db.patch(existing._id, update);
    else
      await ctx.db.insert("accountPreferences", {
        userId,
        kind: args.kind,
        ...update,
      });
    return { accepted: true, revision: update.revision };
  },
});
