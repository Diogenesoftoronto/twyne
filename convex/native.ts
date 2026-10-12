import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Confirm the identity accepted by Convex before a native client attaches an
 * account partition. The caller supplies neither an owner nor token claims.
 * Session cookies and provider credentials are never part of this response.
 */
export const session = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      issuer: v.string(),
      subject: v.string(),
      tokenIdentifier: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      issuer: identity.issuer,
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier,
    };
  },
});
