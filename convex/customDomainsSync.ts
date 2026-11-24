/**
 * Network side of custom domains: talks to the hosting provider and records
 * what it says through internal mutations in convex/customDomains.ts.
 * Runs in the default Convex runtime (`fetch` only, no Node built-ins).
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  CustomDomainProviderError,
  customDomainProviderFromEnv,
} from "./lib/customDomainProvider";

const NOT_CONFIGURED =
  "Custom domains aren't switched on for this Twyne deployment yet.";
const UNREGISTER_RETRY_MS = 5 * 60_000;
const UNREGISTER_MAX_ATTEMPTS = 12;

/** Register the domain if it isn't yet, otherwise read its current state. */
export const sync = internalAction({
  args: { domainId: v.id("customDomains") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const row = await ctx.runQuery(internal.customDomains.getForSync, {
      domainId,
    });
    if (!row || row.status === "removed") return null;

    const provider = customDomainProviderFromEnv(process.env);
    if (!provider) {
      await ctx.runMutation(internal.customDomains.recordProviderError, {
        domainId,
        message: NOT_CONFIGURED,
        reason: "not_configured",
      });
      return null;
    }

    try {
      const state = row.providerDomainId
        ? await provider.get(row.providerDomainId)
        : await provider.register(row.hostname);
      if (!state) {
        await ctx.runMutation(internal.customDomains.recordProviderError, {
          domainId,
          message: "The provider no longer has this domain.",
          reason: "not_found",
        });
        return null;
      }
      await ctx.runMutation(internal.customDomains.recordProviderState, {
        domainId,
        state,
      });
    } catch (error) {
      const retryable =
        !(error instanceof CustomDomainProviderError) || error.retryable;
      console.error(`custom domain sync failed for ${row.hostname}`, error);
      await ctx.runMutation(internal.customDomains.recordProviderError, {
        domainId,
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "The check didn't finish.",
        reason: retryable ? "retryable" : "rejected",
      });
    }
    return null;
  },
});

/** Remove a domain from the provider, retrying for about an hour. */
export const unregister = internalAction({
  args: {
    domainId: v.id("customDomains"),
    providerDomainId: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { domainId, providerDomainId, attempt }) => {
    const provider = customDomainProviderFromEnv(process.env);
    try {
      if (!provider) throw new Error(NOT_CONFIGURED);
      await provider.unregister(providerDomainId);
      await ctx.runMutation(internal.customDomains.clearProviderDomain, {
        domainId,
        providerDomainId,
      });
    } catch (error) {
      console.error(`custom domain removal failed (${providerDomainId})`, error);
      if (attempt + 1 < UNREGISTER_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          UNREGISTER_RETRY_MS,
          internal.customDomainsSync.unregister,
          { domainId, providerDomainId, attempt: attempt + 1 },
        );
      }
    }
    return null;
  },
});
