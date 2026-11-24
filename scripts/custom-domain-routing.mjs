/**
 * Custom domains for writers' published pages.
 *
 * A request whose Host is not a Twyne host is a candidate custom domain
 * (`example.com`, `reports.example.com`). The server resolves it to a writer
 * handle through Convex and rewrites the path onto the existing public routes:
 *
 *   /            -> /{handle}/
 *   /{slug}/     -> /{handle}/{slug}/
 *
 * Kept dependency-free and side-effect free: `server.js` imports it directly,
 * and the Convex hostname validation and the SEO helpers import the host
 * classification from here so the two sides agree on what "Twyne" is.
 */

/** Where app routes on a custom domain are sent. */
export const TWYNE_PUBLIC_ORIGIN = "https://twyne.love";

/**
 * Hosts that serve the Twyne app itself (and their subdomains). Railway's
 * healthcheck arrives as `healthcheck.railway.app`, and environment domains
 * are `*.up.railway.app`, so both count as Twyne.
 */
export const TWYNE_HOST_SUFFIXES = Object.freeze([
  "twyne.love",
  "railway.app",
  "railway.internal",
  "railway.com",
]);

/** Header `server.js` sets (after stripping any inbound copy) for SSR. */
export const CUSTOM_DOMAIN_HEADER = "x-twyne-custom-domain";

/**
 * First path segments that belong to the Twyne app. On a custom domain these
 * redirect to Twyne instead of being read as a piece slug. Keep in step with
 * `src/routes/` (a test checks every route directory is classified).
 */
export const APP_ROUTE_ROOTS = new Set([
  "account",
  "admin",
  "analysis",
  "api",
  "apparatus",
  "at",
  "auth",
  "blog",
  "desk",
  "docs",
  "dossier",
  "download",
  "downloads",
  "editor",
  "faq",
  "help",
  "house",
  "library",
  "oauth-client-metadata.json",
  "onboarding",
  "p",
  "personas",
  "pricing",
  "privacy",
  "privacy-ledger",
  "revisions",
  "rubric",
  "settings",
  "signin",
  "signout",
  "terms",
  "writing-tools",
]);

/**
 * First path segments served unchanged on a custom domain: build output,
 * static assets, the per-piece social card, and well-known files.
 */
export const PASSTHROUGH_ROOTS = new Set([
  "build",
  "assets",
  "og",
  ".well-known",
  "~partytown",
]);

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * Lowercased hostname from a Host header: port and trailing dot removed,
 * IPv6 brackets kept. Empty string when absent or unparseable.
 * @param {string | string[] | undefined | null} value
 * @returns {string}
 */
export function hostFromHeader(value) {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(0, end + 1) : "";
  }
  const colon = raw.indexOf(":");
  const host = colon >= 0 ? raw.slice(0, colon) : raw;
  return host.replace(/\.+$/, "");
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isIpAddress(hostname) {
  return (
    IPV4_RE.test(hostname) || hostname.includes(":") || hostname.startsWith("[")
  );
}

/**
 * True for hosts that serve the Twyne app: no host, localhost, IP literals,
 * Twyne and Railway names, plus any extra hosts (e.g. from `TWYNE_APP_HOSTS`).
 * @param {string} hostname
 * @param {Iterable<string>} [extraHosts]
 * @returns {boolean}
 */
export function isTwyneHost(hostname, extraHosts = []) {
  const host = hostFromHeader(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIpAddress(host)) return true;
  if (
    TWYNE_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }
  for (const extra of extraHosts) {
    if (extra && host === extra.trim().toLowerCase()) return true;
  }
  return false;
}

/**
 * @typedef {{ action: "pass" }
 *   | { action: "rewrite"; path: string }
 *   | { action: "redirect"; status: 301 | 302; location: string }} CustomDomainPlan
 */

/**
 * Decide what a custom-domain request becomes. Pure: no I/O.
 * @param {{ pathname: string; search?: string; handle: string; twyneOrigin?: string }} input
 * @returns {CustomDomainPlan}
 */
export function planCustomDomainRequest({
  pathname,
  search = "",
  handle,
  twyneOrigin = TWYNE_PUBLIC_ORIGIN,
}) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const segments = path.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase() ?? "";
  const last = segments[segments.length - 1] ?? "";
  const owner = handle.toLowerCase();

  if (first && PASSTHROUGH_ROOTS.has(first)) return { action: "pass" };
  if (first && APP_ROUTE_ROOTS.has(first)) {
    return {
      action: "redirect",
      status: 302,
      location: `${twyneOrigin}${path}${search}`,
    };
  }
  // Root files (favicon, manifest, service worker, robots) are site-wide.
  // Route data for the writer's page is the exception: it must follow the
  // rewrite or client navigation would fetch the wrong route's data.
  if (segments.length === 1 && last.includes(".") && last !== "q-data.json") {
    return { action: "pass" };
  }
  if (first === owner) return { action: "pass" };
  if (segments.length && !last.includes(".") && !path.endsWith("/")) {
    // Add the trailing slash here: left to the router, its redirect would
    // expose the rewritten /{handle}/ path.
    return { action: "redirect", status: 301, location: `${path}/${search}` };
  }
  return { action: "rewrite", path: `/${owner}${path}${search}` };
}

/**
 * Small in-memory resolver: positive answers are cached for `ttlMs`, unknown
 * hosts for `negativeTtlMs`, concurrent lookups for one host share a request,
 * and the map is bounded so random Host headers can't grow it forever. When a
 * lookup fails, an expired answer is served rather than failing the page.
 * @param {{
 *   lookup: (hostname: string) => Promise<string | null>;
 *   ttlMs?: number;
 *   negativeTtlMs?: number;
 *   maxEntries?: number;
 *   now?: () => number;
 * }} options
 * @returns {(hostname: string) => Promise<string | null>}
 */
export function createHostResolver({
  lookup,
  ttlMs = 60_000,
  negativeTtlMs = 15_000,
  maxEntries = 1_000,
  now = Date.now,
}) {
  /** @type {Map<string, { handle: string | null; expiresAt: number }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<string | null>>} */
  const inflight = new Map();

  return async function resolve(hostname) {
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > now()) return cached.handle;
    const pending = inflight.get(hostname);
    if (pending) return pending;

    const request = lookup(hostname)
      .then((handle) => {
        cache.delete(hostname);
        if (cache.size >= maxEntries) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(hostname, {
          handle,
          expiresAt: now() + (handle ? ttlMs : negativeTtlMs),
        });
        return handle;
      })
      .catch((error) => {
        if (cached) return cached.handle;
        throw error;
      })
      .finally(() => inflight.delete(hostname));
    inflight.set(hostname, request);
    return request;
  };
}

/**
 * Look a hostname up through Convex's public HTTP query API. Returns the
 * writer handle for an active custom domain, or null.
 * @param {string} convexUrl e.g. https://acoustic-meerkat-189.convex.cloud
 * @param {typeof fetch} [fetchImpl]
 * @returns {(hostname: string) => Promise<string | null>}
 */
export function convexHostLookup(convexUrl, fetchImpl = fetch) {
  const endpoint = `${convexUrl.replace(/\/+$/, "")}/api/query`;
  return async (hostname) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "customDomains:resolveHost",
        args: { hostname },
        format: "json",
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Custom domain lookup failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body?.status !== "success") {
      throw new Error(
        `Custom domain lookup failed: ${body?.errorMessage ?? "unknown error"}`,
      );
    }
    const handle = body.value?.handle;
    return typeof handle === "string" && handle ? handle : null;
  };
}

/**
 * Node request hook for `server.js`. Returns true when the response has been
 * sent (redirect, 404, error); false when the request should continue to the
 * static handlers and router, possibly with `req.url` rewritten.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {{
 *   resolve: ((hostname: string) => Promise<string | null>) | null;
 *   appHosts?: Iterable<string>;
 *   twyneOrigin?: string;
 *   log?: (message: string, error?: unknown) => void;
 * }} options
 * @returns {Promise<boolean>}
 */
export async function routeCustomDomain(req, res, options) {
  // Only this hook may tell SSR that a request arrived on a custom domain.
  delete req.headers[CUSTOM_DOMAIN_HEADER];
  const hostname = hostFromHeader(req.headers.host);
  if (isTwyneHost(hostname, options.appHosts)) return false;

  const sendPlain = (
    /** @type {number} */ status,
    /** @type {string} */ body,
  ) => {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };

  if (!options.resolve) return sendPlain(404, "Not found\n");
  let handle;
  try {
    handle = await options.resolve(hostname);
  } catch (error) {
    options.log?.(`custom domain lookup failed for ${hostname}`, error);
    return sendPlain(
      503,
      "This page is unavailable right now. Try again soon.\n",
    );
  }
  if (!handle) return sendPlain(404, "Not found\n");

  const url = new URL(req.url ?? "/", "http://custom-domain.invalid");
  const plan = planCustomDomainRequest({
    pathname: url.pathname,
    search: url.search,
    handle,
    twyneOrigin: options.twyneOrigin,
  });
  if (plan.action === "redirect") {
    res.writeHead(plan.status, {
      Location: plan.location,
      "Content-Length": "0",
    });
    res.end();
    return true;
  }
  if (plan.action === "rewrite") req.url = plan.path;
  req.headers[CUSTOM_DOMAIN_HEADER] = hostname;
  return false;
}
