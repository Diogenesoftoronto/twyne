import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import {
  assertUniqueDidLink,
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  providerJsonRequest,
} from "./lib/notorganic";

const didValidator = v.string();

function productSubject(identity: {
  subject?: string;
  tokenIdentifier: string;
}): string {
  return identity.subject || identity.tokenIdentifier;
}

export const getLinkedDidBySubject = internalQuery({
  args: { productSubject: v.string() },
  handler: async (ctx, { productSubject }) => {
    return await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", productSubject),
      )
      .unique();
  },
});

export const getMyProviderIdentity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", productSubject(identity)),
      )
      .unique();
  },
});

/**
 * Link the DID restored by the official browser ATProto OAuth client to the
 * currently authenticated Better Auth subject.
 *
 * Boundary: Convex verifies the Better Auth side. The DID proof is the
 * already-verified legacy browser OAuth session, not a server-owned ATProto
 * callback. A future server OAuth conversion must replace this argument with
 * a one-time server-verifiable authorization code before it can create Better
 * Auth sessions for ATProto-only users.
 */
export const linkDidFromLegacyBrowserSession = mutation({
  args: { did: didValidator },
  handler: async (ctx, { did }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("A Better Auth session is required");
    if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did)) {
      throw new Error("Invalid DID");
    }
    const subject = productSubject(identity);
    const [existingByDid, existingBySubject] = await Promise.all([
      ctx.db
        .query("providerIdentities")
        .withIndex("by_did", (q) => q.eq("did", did))
        .unique(),
      ctx.db
        .query("providerIdentities")
        .withIndex("by_productSubject", (q) => q.eq("productSubject", subject))
        .unique(),
    ]);
    assertUniqueDidLink(
      { did, productSubject: subject },
      existingByDid,
      existingBySubject,
    );
    const now = Date.now();
    if (existingBySubject) {
      await ctx.db.patch(existingBySubject._id, {
        verifiedAt: now,
        updatedAt: now,
      });
      return existingBySubject._id;
    }
    return await ctx.db.insert("providerIdentities", {
      did,
      productSubject: subject,
      verificationMethod: "legacy_atproto_browser_oauth",
      sessionVersion: 1,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function linkedDidForAction(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  const row = await ctx.runQuery(
    // Kept dynamic until Convex regenerates api.d.ts for this new module.
    "providerIdentity:getLinkedDidBySubject" as any,
    { productSubject: productSubject(identity) },
  );
  if (!row) {
    throw new Error("Link an ATProto identity before using Not Organic");
  }
  return row as { did: string; sessionVersion: number };
}

export const getWalletState = action({
  args: {},
  handler: async (ctx) => {
    const link = await linkedDidForAction(ctx);
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      feature: "wallet",
      capabilities: ["wallet:read"],
      sessionVersion: link.sessionVersion,
    });
    return providerJsonRequest<unknown>(
      "/v1/wallet",
      token,
      {},
      {
        issuer: notOrganicIssuer(),
        feature: "wallet",
      },
    );
  },
});

export const createProviderCheckout = action({
  args: {
    planId: v.string(),
    successUrl: v.optional(v.string()),
  },
  handler: async (ctx, { planId, successUrl }) => {
    const link = await linkedDidForAction(ctx);
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      feature: "billing-checkout",
      capabilities: ["billing:checkout"],
      sessionVersion: link.sessionVersion,
    });
    const returnUrl =
      successUrl ??
      `${(process.env.SITE_URL ?? "https://www.twyne.love").replace(/\/$/, "")}/pricing?checkout=success`;
    if (!returnUrl.startsWith("https://")) {
      throw new Error("Provider checkout requires an HTTPS success URL");
    }
    const checkout = await providerJsonRequest<{ url: string }>(
      "/v1/billing/checkout",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          product_id: planId,
          return_url: returnUrl,
        }),
      },
      {
        issuer: notOrganicIssuer(),
        feature: "billing-checkout",
      },
    );
    return { checkoutUrl: checkout.url };
  },
});
