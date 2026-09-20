import { v } from "convex/values";
import {
  action,
  internalQuery,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { redeemProviderLink } from "./lib/providerLink";
import {
  assertUniqueDidLink,
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  providerJsonRequest,
} from "./lib/notorganic";

import { providerCheckoutSelection } from "./lib/providerCheckout";

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
    const link = await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", productSubject),
      )
      .unique();
    return link?.verificationMethod === "notorganic_pkce" ? link : null;
  },
});

export const getMyProviderIdentity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const link = await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", productSubject(identity)),
      )
      .unique();
    return link?.verificationMethod === "notorganic_pkce" ? link : null;
  },
});

/** Legacy clients must reverify ownership through the provider authorization flow. */
export const linkDidFromLegacyBrowserSession = mutation({
  args: { did: didValidator },
  handler: async () => {
    throw new Error(
      "Connect Not Organic from Settings to verify account ownership.",
    );
  },
});

export const saveVerifiedLink = internalMutation({
  args: { did: didValidator, subject: v.string(), sessionVersion: v.number() },
  handler: async (ctx, { did, subject, sessionVersion }) => {
    if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did)) {
      throw new Error("Invalid DID");
    }
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
        verificationMethod: "notorganic_pkce",
        sessionVersion,
        verifiedAt: now,
        updatedAt: now,
      });
      return existingBySubject._id;
    }
    return await ctx.db.insert("providerIdentities", {
      did,
      productSubject: subject,
      verificationMethod: "notorganic_pkce",
      sessionVersion,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const completeProviderLink = action({
  args: { code: v.string(), verifier: v.string() },
  returns: v.object({ did: v.string() }),
  handler: async (ctx, args): Promise<{ did: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new Error("Sign in to Twyne before connecting Not Organic.");
    const link = await redeemProviderLink(
      args,
      process.env.SITE_URL ?? "https://twyne.love",
      notOrganicIssuer(),
    );
    await ctx.runMutation(
      makeFunctionReference<
        "mutation",
        { did: string; subject: string; sessionVersion: number }
      >("providerIdentity:saveVerifiedLink"),
      {
        ...link,
        subject: productSubject(identity),
      },
    );
    return { did: link.did };
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
    planId: v.optional(v.string()),
    packId: v.optional(v.string()),
    successUrl: v.optional(v.string()),
  },
  handler: async (ctx, { planId, packId, successUrl }) => {
    const selection = providerCheckoutSelection(
      { planId, packId },
      {
        NOTORGANIC_ENABLED: process.env.NOTORGANIC_ENABLED,
        NOTORGANIC_TWYNE_PRO_V2_ENABLED:
          process.env.NOTORGANIC_TWYNE_PRO_V2_ENABLED,
      },
    );
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
    const expectedOrigin = new URL(
      process.env.SITE_URL ?? "https://www.twyne.love",
    ).origin;
    const parsedReturn = new URL(returnUrl);
    if (
      parsedReturn.protocol !== "https:" ||
      parsedReturn.origin !== expectedOrigin ||
      parsedReturn.username ||
      parsedReturn.password
    ) {
      throw new Error(
        "Provider checkout requires a same-site HTTPS success URL",
      );
    }
    const checkout = await providerJsonRequest<{ url: string }>(
      "/v1/billing/checkout",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ...selection,
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
