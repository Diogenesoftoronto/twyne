import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { passkey } from "@better-auth/passkey";
import { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config.js";

const siteUrl = process.env.SITE_URL ?? "http://localhost:5173";

const authComponents = components as any;

export const authComponent = createClient<DataModel>(authComponents.betterAuth, {
  verbose: false,
});

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    plugins: [
      passkey(),
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          console.log(`[twyne-auth] OTP for ${email}: ${otp}`);
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));
