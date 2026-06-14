import { createAuthClient } from "better-auth/client";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { isDev } from "@builder.io/qwik/build";

const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

/* ── Dev-mode passthrough ──
 * In local dev the Convex backend isn't wired up. Return a no-op client so
 * auth never blocks any UI or throws network errors. */
const mockClient = {
  useSession: {
    get: () => ({ data: null, isPending: false }),
    subscribe: () => () => {},
  },
  signIn: { email: async () => ({ error: null }) },
  signUp: { email: async () => ({ error: null }) },
  signOut: async () => {},
  emailOtp: {
    sendVerificationOtp: async () => ({ error: null }),
    verifyEmail: async () => ({ error: null }),
  },
} as any;

export const authClient = isDev && !convexSiteUrl
  ? mockClient
  : createAuthClient({
      baseURL: convexSiteUrl,
      plugins: [
        passkeyClient(),
        emailOTPClient(),
        crossDomainClient(),
        convexClient(),
      ],
    });

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  passkey: passkeyApi,
  emailOtp,
} = authClient;
