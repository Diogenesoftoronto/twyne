"use node";

/**
 * Relay for MCP servers the browser cannot reach directly.
 *
 * Twyne talks to MCP servers from the browser first, so a writer's bearer
 * token stays on their device. Most hosted MCP servers send no CORS headers,
 * though, so that attempt fails for reasons the browser refuses to describe.
 * This action is the fallback: the client replays the same JSON-RPC request
 * through Convex, which has no same-origin policy to answer to.
 *
 * Two deliberate limits:
 *
 *  - It is authenticated and rate-limited. An open relay that fetches any URL
 *    an anonymous caller names is an SSRF hole pointed at Convex's own
 *    network, so `assertRelayableUrl` rejects private, loopback, and
 *    link-local destinations before anything is sent.
 *  - It does not stream. Streamable HTTP responses arrive here as one buffered
 *    body, so an MCP server that answers a tool call with a long SSE stream is
 *    collected and returned whole. Direct (non-relayed) connections keep
 *    streaming normally.
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { userIsPro } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";

const RELAY_TIMEOUT_MS = 30_000;
const MAX_RELAY_BODY_BYTES = 4 * 1024 * 1024;

/** Headers worth carrying back; the rest are hop-by-hop or noise. */
const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "www-authenticate",
];

/** Request headers a caller may set. Anything else is dropped. */
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254/16 covers the cloud metadata endpoint at 169.254.169.254.
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
}

/**
 * Reject destinations that are not public HTTPS endpoints.
 *
 * This is a hostname check, so it does not stop a DNS-rebinding attack where a
 * public name resolves to a private address. Convex gives no hook to pin the
 * resolved address, so the residual risk is accepted: the caller is
 * authenticated and rate-limited, and the response body is returned only to
 * that caller.
 */
function assertRelayableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That MCP endpoint is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MCP endpoints must be http or https.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new Error(
      "Twyne cannot relay to a local address. A server on this machine has to be reached directly.",
    );
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("Twyne cannot relay to a private network address.");
  }
  return url;
}

export const relay = action({
  args: {
    url: v.string(),
    method: v.optional(v.string()),
    headers: v.optional(v.record(v.string(), v.string())),
    body: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        "Sign in to reach MCP servers that this browser cannot call directly.",
      );
    }
    const isPro = await userIsPro(ctx, identity.tokenIdentifier);
    await consumeRateLimit(ctx, {
      action: "mcp:relay",
      identifier: identity.tokenIdentifier,
      ...(isPro ? RATE_LIMITS.research : RATE_LIMITS.researchFree),
    });

    const url = assertRelayableUrl(args.url);
    const headers = new Headers();
    for (const [key, value] of Object.entries(args.headers ?? {})) {
      if (ALLOWED_REQUEST_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), RELAY_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: args.method ?? "POST",
        headers,
        body: args.body,
        signal: abort.signal,
        // A redirect could land on a private host that survived the check
        // above, so resolve nothing and let the client decide.
        redirect: "manual",
      });
      const raw = await res.arrayBuffer();
      if (raw.byteLength > MAX_RELAY_BODY_BYTES) {
        throw new Error("The MCP server returned more data than Twyne relays.");
      }
      const out: Record<string, string> = {};
      for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
        const value = res.headers.get(name);
        if (value) out[name] = value;
      }
      return {
        status: res.status,
        headers: out,
        body: new TextDecoder().decode(raw),
      };
    } catch (error) {
      if (abort.signal.aborted) {
        throw new Error("The MCP server took too long to answer.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
});
