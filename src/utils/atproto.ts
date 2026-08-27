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
import { reportApplicationError } from "./application-diagnostics";

/**
 * OAuth scope requested from the user's PDS. `include:site.standard.authFull`
 * is the permission set standard.site publications use; `blob:image/*` lets a
 * later version upload cover images.
 */
export const SCOPE = "atproto blob:image/* include:site.standard.authFull";
export const AUTH_CALLBACK_PATH = "/auth/callback/";

const HANDLE_RESOLVER = "https://bsky.social";
export const PUBLIC_BSKY_APPVIEW = "https://public.api.bsky.app";

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

function needsIpLiteralLoopback(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "[::1]" || h === "::1";
}

function ipLiteralPageUrl(): string {
  const url = new URL(window.location.href);
  url.hostname = "127.0.0.1";
  url.protocol = "http:";
  return url.href;
}

function oauthOrigin(): string {
  const url = new URL(window.location.origin);
  // RFC 8252 requires an IP literal for loopback OAuth redirects. Browsers
  // treat localhost and 127.0.0.1 as different origins, so keep this mapping
  // in one place and make the callback land on the standards-compliant form.
  if (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1"
  ) {
    url.hostname = "127.0.0.1";
    url.protocol = "http:";
  }
  return url.origin;
}

function oauthCallbackUrl(): string {
  return `${oauthOrigin()}${AUTH_CALLBACK_PATH}`;
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
    const origin = oauthOrigin();

    if (isLoopback()) {
      const { atprotoLoopbackClientMetadata } = await import(
        "@atproto/oauth-types"
      );
      // The loopback client id encodes the redirect + scope in its query.
      const clientId = `http://localhost?redirect_uri=${encodeURIComponent(
        oauthCallbackUrl(),
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
let initSessionPromise: Promise<AtprotoSession | null> | null = null;

/**
 * Complete a pending OAuth callback (the `?code&state` on the landing
 * route) and/or restore a persisted session. Returns the resolved profile
 * or null when no Bluesky session exists.
 */
export async function initSession(): Promise<AtprotoSession | null> {
  if (!isBrowser()) return null;
  // The ATProto browser client refuses to initialize on a localhost hostname.
  // Do not emit a known, unactionable warning during ordinary local writing;
  // signInWithBluesky performs the one-time move to the IP-literal origin.
  if (needsIpLiteralLoopback()) return null;

  // AuthProvider can restart its visible task while the Convex client is
  // booting. Keep OAuth callback exchange/session refresh single-flight so two
  // overlapping initializations cannot race the rotating DPoP nonce.
  if (initSessionPromise) return initSessionPromise;
  initSessionPromise = restoreSession();
  try {
    return await initSessionPromise;
  } finally {
    initSessionPromise = null;
  }
}

async function restoreSession(): Promise<AtprotoSession | null> {
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
    reportApplicationError("twyne:atproto:restore-session", e, {
      source: "auth",
      title: "Bluesky connection interrupted",
      dedupeKey: "atproto-session",
      metadata: { operation: "restore-atproto-session" },
    });
    activeOAuthSession = null;
    return null;
  }
}

/**
 * Redirects the browser to the Bluesky consent screen. Never returns.
 * @param handle  The user's full Bluesky handle (e.g. `alice.bsky.social`)
 *                or a DID. Required — the public PDS host (`bsky.social`)
 *                is not a valid identifier and will fail to resolve.
 */
export async function signInWithBluesky(handle: string): Promise<void> {
  const trimmed = handle?.trim();
  if (!trimmed) {
    throw new Error("Add your Bluesky handle (e.g. alice.bsky.social) first.");
  }
  if (needsIpLiteralLoopback()) {
    window.location.replace(ipLiteralPageUrl());
    return;
  }
  const client = await getOAuthClient();
  await client.signIn(trimmed, { redirect_uri: oauthCallbackUrl() });
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
  const { Agent } = await import("@atproto/api");
  // Profiles are public AppView data. Using the OAuth session here routes the
  // request through the user's PDS and requires an audience-bound Bluesky RPC
  // scope that existing Standard.site grants do not have.
  const agent = new Agent(PUBLIC_BSKY_APPVIEW);
  return resolveAtprotoProfile(
    did,
    (actor) => agent.getProfile({ actor }),
    (error) => {
      reportApplicationError("twyne:atproto:load-profile", error, {
        source: "fetch",
        title: "Bluesky profile unavailable",
        variant: "warning",
        dedupeKey: "atproto-profile",
        metadata: { operation: "load-atproto-profile" },
      });
    },
  );
}

export async function resolveAtprotoProfile(
  did: string,
  getProfile: (actor: string) => Promise<{
    data: { handle: string; displayName?: string; avatar?: string };
  }>,
  onError?: (error: unknown) => void,
): Promise<AtprotoSession> {
  try {
    const res = await getProfile(did);
    return {
      did,
      handle: res.data.handle,
      displayName: res.data.displayName || undefined,
      avatar: res.data.avatar || undefined,
    };
  } catch (e) {
    // The session is valid even if the profile lookup fails; fall back to
    // the DID as a display string.
    onError?.(e);
    return { did, handle: did };
  }
}
