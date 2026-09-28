import { createAuthClient } from "better-auth/client";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { isDev } from "@qwik.dev/core/build";

const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as
  | string
  | undefined;

/* ── Dev-mode passthrough ──
 * In local dev the Convex backend isn't wired up. Return a no-op client so
 * auth never blocks any UI or throws network errors. */
const mockClient = {
  useSession: {
    get: () => ({ data: null, isPending: false }),
    subscribe: () => () => {},
  },
  signOut: async () => {},
} as any;

export const authClient =
  isDev && !convexSiteUrl
    ? mockClient
    : createAuthClient({
        baseURL: convexSiteUrl,
        plugins: [
          // `crossDomainClient()` ships a `getActions` signature that
          // drifts from the `BetterAuthClientPlugin` constraint in this
          // better-auth version. The runtime contract is fine; suppress
          // the structural-typing noise.
          crossDomainClient() as any,
          convexClient(),
        ],
      });

export const { signOut, useSession } = authClient;
