"use node";

/**
 * Pluggable research provider for the Apparatus. Twyne can swap the
 * underlying search/fetch backend (TinyFish, Exa, Tavily, Brave, …)
 * without UI changes by setting an env var. The interface is tiny:
 *
 *   searchSources({ query, context }) -> { results: Source[] }
 *   fetchSource  ({ url })           -> { title, author, …, markdown, embeddable }
 *
 * Falls back to a deterministic local generator when no provider is
 * configured, so the panel never breaks entirely.
 */

import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { userIsPro } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { applicationError } from "./lib/applicationErrors";
import {
  callerFromIdentity,
  callerFromTokenIdentifier,
  type HostedCaller,
} from "./lib/authIdentity";
import {
  createDpopFetch,
  issueNotOrganicAccessToken,
  notOrganicEnabled,
  notOrganicIssuer,
  NOTORGANIC_PRODUCT,
} from "./lib/notorganic";

/* ── Public shape ──────────────────────────────────────────────── */

export interface Source {
  title: string;
  url: string;
  snippet: string;
  author?: string;
  publisher?: string;
  date?: string;
  why?: string;
}

export const sourceValidator = v.object({
  title: v.string(),
  url: v.string(),
  snippet: v.string(),
  author: v.optional(v.string()),
  publisher: v.optional(v.string()),
  date: v.optional(v.string()),
  why: v.optional(v.string()),
});

export interface FetchedSource {
  title: string;
  author?: string;
  publisher?: string;
  date?: string;
  markdown: string;
  embeddable: boolean;
}

/* ── Hosted search provider ───────────────────────────────────── */

/**
 * Which upstream the hosted path calls, chosen by env so the deployment can
 * change vendors without a code change:
 *
 *   RESEARCH_PROVIDER   notorganic | tinyfish | exa | tavily | brave | serper | custom
 *   RESEARCH_API_KEY    the key for that provider
 *   RESEARCH_SEARCH_URL overrides the built-in endpoint (required for custom)
 *   RESEARCH_FETCH_URL  url→markdown endpoint, if the provider has one
 *
 * TINYFISH_API_KEY is still honoured so existing deployments keep working.
 */

type KeyProviderId =
  | "tinyfish"
  | "exa"
  | "tavily"
  | "brave"
  | "serper"
  | "custom";
type ProviderId = KeyProviderId | "notorganic";

interface ProviderSpec {
  searchUrl: string;
  fetchUrl?: string;
  /** Build the search request for this vendor. */
  search: (
    key: string,
    query: string,
    context: string,
    limit: number,
  ) => { url: string; init: RequestInit };
  /** Where the hits sit in the response. */
  path: (body: unknown) => unknown;
}

const PROVIDERS: Record<KeyProviderId, ProviderSpec> = {
  tinyfish: {
    searchUrl: "https://api.search.tinyfish.ai/v1/search",
    fetchUrl: "https://api.fetch.tinyfish.ai/v1/fetch",
    search: (key, query, context, limit) => ({
      url: providerSearchUrl("https://api.search.tinyfish.ai/v1/search"),
      init: jsonPost(
        { authorization: `Bearer ${key}` },
        {
          query,
          context,
          num_results: limit,
        },
      ),
    }),
    path: (b) => (b as { results?: unknown })?.results,
  },
  exa: {
    searchUrl: "https://api.exa.ai/search",
    fetchUrl: "https://api.exa.ai/contents",
    search: (key, query, _context, limit) => ({
      url: providerSearchUrl("https://api.exa.ai/search"),
      init: jsonPost(
        { "x-api-key": key },
        {
          query,
          numResults: limit,
          type: "auto",
          contents: { text: { maxCharacters: 600 } },
        },
      ),
    }),
    path: (b) => (b as { results?: unknown })?.results,
  },
  tavily: {
    searchUrl: "https://api.tavily.com/search",
    fetchUrl: "https://api.tavily.com/extract",
    search: (key, query, _context, limit) => ({
      url: providerSearchUrl("https://api.tavily.com/search"),
      init: jsonPost(
        { authorization: `Bearer ${key}` },
        {
          query,
          max_results: limit,
          search_depth: "advanced",
        },
      ),
    }),
    path: (b) => (b as { results?: unknown })?.results,
  },
  brave: {
    searchUrl: "https://api.search.brave.com/res/v1/web/search",
    search: (key, query, _context, limit) => {
      const url = new URL(
        providerSearchUrl("https://api.search.brave.com/res/v1/web/search"),
      );
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(limit));
      return {
        url: url.toString(),
        init: {
          method: "GET",
          headers: { accept: "application/json", "x-subscription-token": key },
        },
      };
    },
    path: (b) => (b as { web?: { results?: unknown } })?.web?.results,
  },
  serper: {
    searchUrl: "https://google.serper.dev/search",
    search: (key, query, _context, limit) => ({
      url: providerSearchUrl("https://google.serper.dev/search"),
      init: jsonPost({ "x-api-key": key }, { q: query, num: limit }),
    }),
    path: (b) => (b as { organic?: unknown })?.organic,
  },
  custom: {
    searchUrl: "",
    search: (key, query, context, limit) => ({
      url: providerSearchUrl(""),
      init: jsonPost(key ? { authorization: `Bearer ${key}` } : {}, {
        query,
        context,
        max_results: limit,
      }),
    }),
    path: (b) => {
      const rec = (b ?? {}) as Record<string, unknown>;
      for (const key of ["results", "sources", "data", "items", "hits"]) {
        if (Array.isArray(rec[key])) return rec[key];
      }
      return Array.isArray(b) ? b : undefined;
    },
  },
};

function jsonPost(headers: Record<string, string>, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function providerSearchUrl(fallback: string): string {
  return process.env.RESEARCH_SEARCH_URL?.trim() || fallback;
}

function providerId(): ProviderId {
  const raw = (process.env.RESEARCH_PROVIDER ?? "tinyfish")
    .trim()
    .toLowerCase();
  return raw === "notorganic" || Object.hasOwn(PROVIDERS, raw)
    ? (raw as ProviderId)
    : "tinyfish";
}

/** The configured key, falling back to the original TinyFish-only variable. */
export function researchApiKey(): string {
  return (
    process.env.RESEARCH_API_KEY?.trim() ||
    process.env.TINYFISH_API_KEY?.trim() ||
    ""
  );
}

function normalize(value: unknown, limit: number): Source[] {
  if (!Array.isArray(value)) return [];
  const out: Source[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!url) continue;
    const str = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const v = r[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return undefined;
    };
    out.push({
      title: str("title", "name") ?? "(untitled)",
      url,
      snippet:
        str("snippet", "description", "text", "content", "summary") ?? "",
      author: str("author", "byline"),
      publisher: str("publisher", "source", "site"),
      date: str("date", "published", "publishedDate"),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function providerSearch(
  query: string,
  context: string,
  limit: number,
): Promise<Source[]> {
  const key = researchApiKey();
  const id = providerId();
  if (id === "notorganic") throw applicationError("configuration_required");
  const spec = PROVIDERS[id];
  try {
    const { url, init } = spec.search(key, query, context, limit);
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error("search failed");
    }
    const rows = spec.path(await res.json());
    if (!Array.isArray(rows)) throw new Error("invalid search response");
    return normalize(rows, limit);
  } catch {
    throw applicationError("provider_unavailable", {
      message: "The search service could not answer. Try again shortly.",
    });
  }
}

async function providerFetch(url: string): Promise<FetchedSource | null> {
  const key = researchApiKey();
  const id = providerId();
  if (id === "notorganic") return null;
  const spec = PROVIDERS[id];
  const endpoint = process.env.RESEARCH_FETCH_URL?.trim() || spec.fetchUrl;
  if (!key || !endpoint) return null;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ url, format: "markdown" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author?: string;
      publisher?: string;
      date?: string;
      markdown?: string;
      text?: string;
      embeddable?: boolean;
    };
    return {
      title: data.title ?? url,
      author: data.author,
      publisher: data.publisher,
      date: data.date,
      markdown: data.markdown ?? data.text ?? "",
      embeddable: data.embeddable ?? false,
    };
  } catch {
    return null;
  }
}

/* ── Local fallback — always available, never calls the network ─ */

function localSearch(query: string, context: string): Source[] {
  // Deterministic stub so the panel has something to render in dev.
  // The query and context are echoed in a way that proves the call worked.
  const slug =
    query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "search";
  const trimmed = context.trim().slice(0, 80);
  return [
    {
      title: `Local stub: ${query}`,
      url: `https://example.invalid/${slug}`,
      snippet: trimmed
        ? `Set RESEARCH_API_KEY for live results. Echo of your context: ${trimmed}`
        : "Set RESEARCH_API_KEY to enable live research. This is a local stub.",
      publisher: "Twyne local",
    },
    {
      title: "Why the apparatus is a research tool",
      url: "https://twyne.love/docs/apparatus",
      snippet:
        "The Apparatus exists so writers can do research and build a bibliography while they write.",
      publisher: "Twyne",
      date: "2025",
    },
  ];
}

function localFetch(url: string): FetchedSource {
  return {
    title: url,
    markdown: `# ${url}\n\n_Live fetch disabled. Set RESEARCH_API_KEY to pull clean markdown from this URL._`,
    embeddable: false,
  };
}

/* ── Convex actions ───────────────────────────────────────────── */

/* ── Not Organic web search ───────────────────────────────────── */

/**
 * `RESEARCH_PROVIDER=notorganic`: search through Not Organic's metered
 * `/v1/web/search` as the writer's own linked account. Hosted inference is
 * already paid from that wallet, so research needs no separate search key —
 * which matters because a deployment with no `RESEARCH_API_KEY` gives every
 * hosted writer placeholder results and an Apparatus that never finds a
 * source. The per-search ceiling is `NOTORGANIC_SEARCH_MAX_COST_MICROUSD`.
 */
const NOTORGANIC_SEARCH_DEFAULT_MAX_COST_MICROUSD = 50_000;

function notOrganicSearchSelected(): boolean {
  return (
    (process.env.RESEARCH_PROVIDER ?? "").trim().toLowerCase() ===
      "notorganic" && notOrganicEnabled()
  );
}

function notOrganicSearchCeiling(): number {
  const raw = Number(process.env.NOTORGANIC_SEARCH_MAX_COST_MICROUSD);
  return Number.isSafeInteger(raw) && raw > 0
    ? raw
    : NOTORGANIC_SEARCH_DEFAULT_MAX_COST_MICROUSD;
}

/** Not Organic's result rows, mapped onto the Apparatus' `Source`. */
export function notOrganicSources(body: unknown, limit: number): Source[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return normalize(
    results.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        date: r.published_at,
        publisher: typeof r.url === "string" ? hostOf(r.url) : undefined,
      };
    }),
    limit,
  );
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

async function notOrganicSearch(
  ctx: ActionCtx,
  caller: HostedCaller,
  query: string,
  limit: number,
): Promise<Source[]> {
  const link = await ctx.runQuery(
    internal.providerIdentity.getLinkedDidBySubject,
    { productSubject: caller.subject },
  );
  if (!link)
    throw applicationError("configuration_required", {
      message: "Link your Not Organic account before using hosted research.",
    });
  try {
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      feature: "research",
      capabilities: ["web:search"],
      sessionVersion: link.sessionVersion,
    });
    const res = await createDpopFetch(token, fetch)(
      `${notOrganicIssuer()}/v1/web/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-notorganic-product": NOTORGANIC_PRODUCT,
          "x-notorganic-feature": "research",
          "idempotency-key": `twyne_research_${crypto.randomUUID()}`,
          "x-notorganic-max-cost-microusd": String(notOrganicSearchCeiling()),
        },
        body: JSON.stringify({
          query: query.slice(0, 4096),
          max_results: limit,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      // Never surface the body; it can echo the request.
      await res.body?.cancel();
      throw new Error("search failed");
    }
    const body: unknown = await res.json();
    if (!Array.isArray((body as { results?: unknown } | null)?.results)) {
      throw new Error("invalid search response");
    }
    return notOrganicSources(body, limit);
  } catch {
    // Upstream/token errors can contain the writer's query or credentials.
    throw applicationError("provider_unavailable", {
      message: "The search service could not answer. Try again shortly.",
    });
  }
}

/* ── Search, for a signed-in writer or a token owner ──────────── */

const searchArgs = {
  query: v.string(),
  context: v.optional(v.string()),
  maxResults: v.optional(v.number()),
};

export interface SearchResult {
  results: Source[];
  provider: string;
}

const searchReturns = v.object({
  results: v.array(sourceValidator),
  provider: v.string(),
});

/** Whether this deployment can search for real, before any request is made. */
export function liveSearchConfigured(): boolean {
  const id = providerId();
  if (id === "notorganic") return notOrganicSearchSelected();
  if (id === "custom") return !!process.env.RESEARCH_SEARCH_URL?.trim();
  return !!researchApiKey();
}

/**
 * The search itself. `caller` is null for a signed-out visitor, who gets the
 * deterministic local stub so the Apparatus never breaks.
 */
export async function searchSourcesCore(
  ctx: ActionCtx,
  caller: HostedCaller | null,
  args: { query: string; context?: string; maxResults?: number },
): Promise<SearchResult> {
  const limit = Math.max(1, Math.min(10, Math.floor(args.maxResults ?? 8)));
  // Rate limit on the host-provider path. The local stub is free and
  // unthrottled-by-design (it's what makes the Apparatus never break), but
  // the bucket is consumed first so a noisy client can't bypass via a
  // provider that happens to be configured.
  if (caller) {
    const isPro = await userIsPro(ctx, caller.subject);
    await consumeRateLimit(ctx, {
      action: "research:search",
      identifier: caller.tokenIdentifier,
      ...(isPro ? RATE_LIMITS.research : RATE_LIMITS.researchFree),
    });
  }

  if (caller && liveSearchConfigured()) {
    const id = providerId();
    const results =
      id === "notorganic"
        ? await notOrganicSearch(ctx, caller, args.query, limit)
        : await providerSearch(args.query, args.context ?? "", limit);
    return { results, provider: id };
  }
  return {
    results: localSearch(args.query, args.context ?? "").slice(0, limit),
    provider: "local",
  };
}

export const searchSources = action({
  args: searchArgs,
  returns: searchReturns,
  handler: async (ctx, args): Promise<SearchResult> => {
    // Live research spends a provider key or the writer's Not Organic wallet,
    // so it requires a signed-in user. Pro subscribers get a higher
    // rate-limit tier.
    const identity = await ctx.auth.getUserIdentity();
    return searchSourcesCore(
      ctx,
      identity ? callerFromIdentity(identity) : null,
      args,
    );
  },
});

/** The same search for an integration-token owner (`research.sources`). */
export const searchSourcesAs = internalAction({
  args: { ownerId: v.string(), ...searchArgs },
  returns: searchReturns,
  handler: async (ctx, { ownerId, ...args }): Promise<SearchResult> =>
    searchSourcesCore(ctx, callerFromTokenIdentifier(ownerId), args),
});

export const fetchSource = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<FetchedSource & { provider: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    const isPro = identity
      ? await userIsPro(ctx, identity.subject || identity.tokenIdentifier)
      : false;
    if (identity) {
      await consumeRateLimit(ctx, {
        action: "research:fetch",
        identifier: identity.tokenIdentifier,
        ...(isPro ? RATE_LIMITS.research : RATE_LIMITS.researchFree),
      });
    }
    if (identity && researchApiKey()) {
      const r = await providerFetch(args.url);
      if (r) return { ...r, provider: providerId() };
    }
    return { ...localFetch(args.url), provider: "local" };
  },
});
