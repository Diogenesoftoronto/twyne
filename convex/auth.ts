import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config.js";
import { makeFunctionReference } from "convex/server";
import { notOrganicIssuer } from "./lib/notorganic";
import { redeemProviderLink } from "./lib/providerLink";
import {
  NOTORGANIC_SIGN_IN_PATH,
  notOrganicSignIn,
} from "./lib/notorganicSignIn";

const siteUrl = normalizeOrigin(
  process.env.SITE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:5173",
);
const TWYNE_PRODUCTION_ORIGINS = [
  "https://twyne.love",
  "https://www.twyne.love",
] as const;
const saveVerifiedLink = makeFunctionReference<
  "mutation",
  { did: string; subject: string; sessionVersion: number }
>("providerIdentity:saveVerifiedLink");

const authComponents = components as any;

export const authComponent = createClient<DataModel>(
  authComponents.betterAuth,
  {
    verbose: false,
  },
);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(siteUrl),
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: false,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    plugins: [
      notOrganicSignIn({
        // The browser's origin is the PKCE client_id; it must be one Twyne
        // trusts (twyne.love and www.twyne.love are separate client ids).
        redeem: ({ code, verifier, origin }) => {
          if (!trustedOrigins(siteUrl).includes(origin)) {
            throw new Error("This sign-in came from an untrusted origin.");
          }
          return redeemProviderLink(
            { code, verifier },
            origin,
            notOrganicIssuer(),
            fetch,
            NOTORGANIC_SIGN_IN_PATH,
          );
        },
        onSignedIn: async ({ did, userId, sessionVersion }) => {
          if (!("runMutation" in ctx)) {
            throw new Error("Not Organic sign-in needs a mutation context.");
          }
          await ctx.runMutation(saveVerifiedLink, {
            did,
            subject: userId,
            sessionVersion,
          });
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

function normalizeOrigin(value: string): string {
  const origin = new URL(value).origin;
  const host = new URL(origin).hostname;
  if (host === "twyne.love" || host === "www.twyne.love") {
    return "https://www.twyne.love";
  }
  return origin;
}

function isLoopbackOrigin(value: string): boolean {
  const host = new URL(value).hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function trustedOrigins(origin: string): string[] {
  const origins = new Set<string>([origin]);
  if (isLoopbackOrigin(origin)) {
    const url = new URL(origin);
    const port = url.port ? `:${url.port}` : "";
    // ATProto OAuth must return to an IP-literal loopback URI (RFC 8252),
    // while Vite commonly starts at localhost. Trust both representations of
    // the same local development service so the callback can use 127.0.0.1.
    origins.add(`http://localhost${port}`);
    origins.add(`http://127.0.0.1${port}`);
  }
  if (isTwyneProductionOrigin(origin)) {
    for (const prodOrigin of TWYNE_PRODUCTION_ORIGINS) {
      origins.add(prodOrigin);
    }
  }
  for (const raw of (process.env.TRUSTED_ORIGINS ?? "").split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = normalizeOrigin(trimmed);
    origins.add(normalized);
    if (
      isTwyneProductionOrigin(trimmed) ||
      isTwyneProductionOrigin(normalized)
    ) {
      for (const prodOrigin of TWYNE_PRODUCTION_ORIGINS) {
        origins.add(prodOrigin);
      }
    }
  }
  return [...origins];
}

function isTwyneProductionOrigin(value: string): boolean {
  try {
    return TWYNE_PRODUCTION_ORIGINS.includes(
      new URL(value).origin as (typeof TWYNE_PRODUCTION_ORIGINS)[number],
    );
  } catch {
    return false;
  }
}
