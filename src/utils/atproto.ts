/**
 * ATProto / Bluesky OAuth — client-only.
 *
 * Everything here is reached through dynamic `import()` so the heavy
 * `@atproto/*` browser bundles never enter an SSR module graph (the same
 * discipline that keeps the AI SDK from crashing SSR with "process is not
 * defined"). Call these from event handlers or `useVisibleTask$` only.
 *
 * Mirrors the shape of mozzius/standard.horse's auth client: a single
 * cached BrowserOAuthClient, loopback metadata for localhost dev, and a
 * hosted `/oauth-client-metadata.json` document in production.
 */

import type { Agent } from "@atproto/api";

/**
 * OAuth scope requested from the user's PDS. `include:site.standard.authFull`
 * is the permission set standard.site publications use; `blob:image/*` lets a
 * later version upload cover images.
 */
export const SCOPE =
  "atproto blob:image/* include:site.standard.authFull";

const HANDLE_RESOLVER = "https://bsky.social";

export interface AtprotoSession {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isLoopback(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

// Module-level cache: build the client once per page.
let clientPromise: Promise<any> | null = null;

async function getOAuthClient(): Promise<any> {
  if (!isBrowser()) throw new Error("atproto OAuth is browser-only");
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const { BrowserOAuthClient } = await import(
      "@atproto/oauth-client-browser"
    );
    const origin = window.location.origin;

    if (isLoopback()) {
      const { atprotoLoopbackClientMetadata } = await import(
        "@atproto/oauth-types"
      );
      // The loopback client id encodes the redirect + scope in its query.
      const clientId = `http://localhost?redirect_uri=${encodeURIComponent(
        `${origin}/`,
      )}&scope=${encodeURIComponent(SCOPE)}`;
      return new BrowserOAuthClient({
        handleResolver: HANDLE_RESOLVER,
        clientMetadata: atprotoLoopbackClientMetadata(clientId),
      });
    }

    return BrowserOAuthClient.load({
      clientId: `${origin}/oauth-client-metadata.json`,
      handleResolver: HANDLE_RESOLVER,
    });
  })();

  return clientPromise;
}

// Cache the live OAuth session object so getAgent() can reuse it.
let activeOAuthSession: any = null;

/**
 * Complete a pending OAuth callback (the `?code&state` on the landing
 * route) and/or restore a persisted session. Returns the resolved profile
 * or null when no Bluesky session exists.
 */
export async function initSession(): Promise<AtprotoSession | null> {
  if (!isBrowser()) return null;
  try {
    const client = await getOAuthClient();
    const result = await client.init();
    if (!result?.session) {
      activeOAuthSession = null;
      return null;
    }
    activeOAuthSession = result.session;
    return resolveProfile(result.session);
  } catch (e) {
    // A failed restore should never block the rest of auth from loading.
    console.warn("[atproto] initSession failed", e);
    activeOAuthSession = null;
    return null;
  }
}

/** Redirects the browser to the Bluesky consent screen. Never returns. */
export async function signInWithBluesky(handle?: string): Promise<void> {
  const client = await getOAuthClient();
  await client.signIn(handle?.trim() || "bsky.social");
}

/** Revoke the active session and clear local state. */
export async function signOutBluesky(): Promise<void> {
  if (!activeOAuthSession) return;
  try {
    const client = await getOAuthClient();
    const did = activeOAuthSession.did ?? activeOAuthSession.sub;
    if (did) await client.revoke(did);
  } catch (e) {
    console.warn("[atproto] signOut failed", e);
  } finally {
    activeOAuthSession = null;
  }
}

/** Build an XRPC Agent from the restored OAuth session. */
export async function getAgent(): Promise<Agent> {
  if (!activeOAuthSession) {
    throw new Error("No active Bluesky session");
  }
  const { Agent } = await import("@atproto/api");
  return new Agent(activeOAuthSession);
}

/** The DID of the active session, or null. */
export function getActiveDid(): string | null {
  if (!activeOAuthSession) return null;
  return activeOAuthSession.did ?? activeOAuthSession.sub ?? null;
}

async function resolveProfile(session: any): Promise<AtprotoSession> {
  const did: string = session.did ?? session.sub;
  try {
    const { Agent } = await import("@atproto/api");
    const agent = new Agent(session);
    const res = await agent.getProfile({ actor: did });
    return {
      did,
      handle: res.data.handle,
      displayName: res.data.displayName || undefined,
      avatar: res.data.avatar || undefined,
    };
  } catch (e) {
    // The session is valid even if the profile lookup fails; fall back to
    // the DID as a display string.
    console.warn("[atproto] getProfile failed", e);
    return { did, handle: did };
  }
}
