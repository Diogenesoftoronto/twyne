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

/* ── In-memory OTP rate limit ────────────────────────────────────
 * Best-effort guard against OTP email spam. The better-auth callback
 * runs inside its own action wrapper without a direct Convex ctx, so we
 * fall back to a module-level Map keyed by email. Resets on cold start
 * (a deployed instance restart) — fine for catching a hot spam loop
 * without restructuring how better-auth invokes the callback. The
 * DB-backed rate limiter covers the rest of the API surface. */
const OTP_LIMIT = 5;
const OTP_WINDOW_MS = 60_000;
const otpBuckets = new Map<string, { count: number; windowStart: number }>();

function consumeOtpRateLimit(email: string): void {
  const key = email.trim().toLowerCase();
  const now = Date.now();
  const existing = otpBuckets.get(key);
  if (!existing || now - existing.windowStart >= OTP_WINDOW_MS) {
    otpBuckets.set(key, { count: 1, windowStart: now });
    return;
  }
  if (existing.count >= OTP_LIMIT) {
    throw new Error(
      `Too many verification codes requested. Try again in ${Math.ceil((OTP_WINDOW_MS - (now - existing.windowStart)) / 1000)}s.`,
    );
  }
  existing.count += 1;
}

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
      passkey({
        // Security: passkey registration is always bound to the authenticated
        // session's user (`requireSession: true`, the plugin default). We
        // deliberately do NOT use `requireSession: false` + `resolveUser`.
        // Resolving an existing user from an unverified email would let an
        // attacker attach their own passkey to a victim's account and take it
        // over. Instead, the client verifies the email via the OTP flow first;
        // that establishes a session, and only then is `addPasskey()` called,
        // binding the credential to the verified, signed-in user.
        registration: {
          requireSession: true,
        },
      }),
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          // In-memory rate limit (see note above the OTP bucket map).
          consumeOtpRateLimit(email);

          if (process.env.E2E_OTP_SECRET) {
            const response = await fetch(
              `${process.env.CONVEX_SITE_URL}/e2e/otp`,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${process.env.E2E_OTP_SECRET}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ email, otp }),
              },
            );
            if (!response.ok) {
              throw new Error("E2E OTP sink rejected the verification code.");
            }
            return;
          }
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
