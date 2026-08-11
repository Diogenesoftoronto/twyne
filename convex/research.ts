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

import { action } from "./_generated/server";
import { v } from "convex/values";
import { userIsPro } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";

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
 *   RESEARCH_PROVIDER   tinyfish | exa | tavily | brave | serper | custom
 *   RESEARCH_API_KEY    the key for that provider
 *   RESEARCH_SEARCH_URL overrides the built-in endpoint (required for custom)
 *   RESEARCH_FETCH_URL  url→markdown endpoint, if the provider has one
 *
 * TINYFISH_API_KEY is still honoured so existing deployments keep working.
 */

type ProviderId = "tinyfish" | "exa" | "tavily" | "brave" | "serper" | "custom";

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

const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  tinyfish: {
    searchUrl: "https://api.search.tinyfish.ai/v1/search",
    fetchUrl: "https://api.fetch.tinyfish.ai/v1/fetch",
    search: (key, query, context, limit) => ({
      url: providerSearchUrl("https://api.search.tinyfish.ai/v1/search"),
      init: jsonPost({ authorization: `Bearer ${key}` }, {
        query,
        context,
        num_results: limit,
      }),
    }),
    path: (b) => (b as { results?: unknown })?.results,
  },
  exa: {
    searchUrl: "https://api.exa.ai/search",
    fetchUrl: "https://api.exa.ai/contents",
    search: (key, query, _context, limit) => ({
      url: providerSearchUrl("https://api.exa.ai/search"),
      init: jsonPost({ "x-api-key": key }, {
        query,
        numResults: limit,
        type: "auto",
        contents: { text: { maxCharacters: 600 } },
      }),
    }),
    path: (b) => (b as { results?: unknown })?.results,
  },
  tavily: {
    searchUrl: "https://api.tavily.com/search",
    fetchUrl: "https://api.tavily.com/extract",
    search: (key, query, _context, limit) => ({
      url: providerSearchUrl("https://api.tavily.com/search"),
      init: jsonPost({ authorization: `Bearer ${key}` }, {
        query,
        max_results: limit,
        search_depth: "advanced",
      }),
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

function jsonPost(
  headers: Record<string, string>,
  body: unknown,
): RequestInit {
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
  const raw = (process.env.RESEARCH_PROVIDER ?? "tinyfish").trim().toLowerCase();
  return raw in PROVIDERS ? (raw as ProviderId) : "tinyfish";
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
      snippet: str("snippet", "description", "text", "content", "summary") ?? "",
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
): Promise<Source[]> {
  const key = researchApiKey();
  const spec = PROVIDERS[providerId()];
  if (!key && providerId() !== "custom") return [];
  try {
    const { url, init } = spec.search(key, query, context, 8);
    if (!url) return [];
    const res = await fetch(url, init);
    if (!res.ok) return [];
    return normalize(spec.path(await res.json()), 8);
  } catch {
    return [];
  }
}

async function providerFetch(url: string): Promise<FetchedSource | null> {
  const key = researchApiKey();
  const spec = PROVIDERS[providerId()];
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

export const searchSources = action({
  args: { query: v.string(), context: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ results: Source[]; provider: string }> => {
    // Live research spends the TinyFish provider key, so it requires a
    // signed-in user. Pro subscribers get a higher rate-limit tier; signed-out
    // visitors (and local dev with no key) get the deterministic local stub
    // so the Apparatus never breaks.
    const identity = await ctx.auth.getUserIdentity();

    // Rate limit on the host-provider path. The local stub is free and
    // unthrottled-by-design (it's what makes the Apparatus never break), but
    // the bucket is consumed first so a noisy client can't bypass via a
    // provider that happens to be configured.
    const isPro = identity
      ? await userIsPro(ctx, identity.tokenIdentifier)
      : false;
    if (identity) {
      await consumeRateLimit(ctx, {
        action: "research:search",
        identifier: identity.tokenIdentifier,
        ...(isPro ? RATE_LIMITS.research : RATE_LIMITS.researchFree),
      });
    }

    if (identity && researchApiKey()) {
      const r = await providerSearch(args.query, args.context ?? "");
      if (r.length > 0) return { results: r, provider: "tinyfish" };
    }
    return {
      results: localSearch(args.query, args.context ?? ""),
      provider: "local",
    };
  },
});

export const fetchSource = action({
  args: { url: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<FetchedSource & { provider: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    const isPro = identity
      ? await userIsPro(ctx, identity.tokenIdentifier)
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
      if (r) return { ...r, provider: "tinyfish" };
    }
    return { ...localFetch(args.url), provider: "local" };
  },
});
