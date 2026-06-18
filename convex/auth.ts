import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { passkey } from "@better-auth/passkey";
import { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config.js";
import { Resend } from "resend";

const siteUrl = normalizeOrigin(
  process.env.SITE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:5173",
);
const resendFrom =
  process.env.RESEND_FROM_EMAIL ?? "Twyne <support@twyne.love>";

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
      passkey(),
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          const apiKey = process.env.RESEND_API_KEY;
          if (!apiKey) {
            if (!isLoopbackOrigin(siteUrl)) {
              console.error(
                "[twyne-auth] RESEND_API_KEY is missing; refusing to pretend production OTP was sent.",
              );
              throw new Error("Email delivery is not configured.");
            }
            console.log(`[twyne-auth] OTP for ${email}: ${otp}`);
            return;
          }

          const resend = new Resend(apiKey);
          const { error } = await resend.emails.send({
            from: resendFrom,
            to: email,
            subject: "Your Twyne verification code",
            text: `Your one-time Twyne verification code is: ${otp}\n\nThis code expires soon. If you did not request it, you can ignore this email.`,
            html: `<p>Your one-time Twyne verification code is:</p><p style="font-size:24px;letter-spacing:0.18em"><strong>${otp}</strong></p><p>This code expires soon. If you did not request it, you can ignore this email.</p>`,
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
  for (const raw of (process.env.TRUSTED_ORIGINS ?? "").split(",")) {
    const trimmed = raw.trim();
    if (trimmed) origins.add(normalizeOrigin(trimmed));
  }
  if (origin === "https://twyne.love") origins.add("https://www.twyne.love");
  if (origin === "https://www.twyne.love") origins.add("https://twyne.love");
  return [...origins];
}
