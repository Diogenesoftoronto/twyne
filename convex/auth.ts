import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { passkey } from "@better-auth/passkey";
import { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config.js";
import { Resend } from "resend";

const siteUrl = process.env.SITE_URL ?? "http://localhost:5173";
const resendFrom = process.env.RESEND_FROM_EMAIL ?? "Twyne <support@twyne.love>";

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
    trustedOrigins: [siteUrl],
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
      passkey(),
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          const apiKey = process.env.RESEND_API_KEY;
          if (!apiKey) {
            console.log(`[twyne-auth] OTP for ${email}: ${otp}`);
            return;
          }

          const resend = new Resend(apiKey);
          const { error } = await resend.emails.send({
            from: resendFrom,
            to: email,
            subject: "Your Twyne verification code",
            text: `Your one-time verification code is: ${otp}`,
          });

          if (error) {
            console.error("[twyne-auth] Resend error:", error);
            throw new Error("Failed to send verification email.");
          }
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));
