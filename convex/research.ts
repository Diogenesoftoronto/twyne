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

/* ── TinyFish provider (default) ──────────────────────────────── */

const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai/v1/search";
const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai/v1/fetch";

async function tinyfishSearch(
  query: string,
  context: string,
): Promise<Source[]> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(TINYFISH_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, context, num_results: 8 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
        author?: string;
        publisher?: string;
        date?: string;
      }>;
    };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? "(untitled)",
      url: r.url ?? "",
      snippet: r.snippet ?? "",
      author: r.author,
      publisher: r.publisher,
      date: r.date,
    }));
  } catch {
    return [];
  }
}

async function tinyfishFetch(url: string): Promise<FetchedSource | null> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(TINYFISH_FETCH_URL, {
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
      embeddable?: boolean;
    };
    return {
      title: data.title ?? url,
      author: data.author,
      publisher: data.publisher,
      date: data.date,
      markdown: data.markdown ?? "",
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
        ? `Set TINYFISH_API_KEY for live results. Echo of your context: ${trimmed}`
        : "Set TINYFISH_API_KEY to enable live research. This is a local stub.",
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
    markdown: `# ${url}\n\n_Live fetch disabled. Set TINYFISH_API_KEY to pull clean markdown from this URL._`,
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
    // Live research spends the TinyFish provider key, so it requires a signed-in
    // Pro subscriber. Signed-in free users (and local dev with no key) get the
    // deterministic local stub so the Apparatus never breaks.
    const identity = await ctx.auth.getUserIdentity();

    // Rate limit on the host-provider path. The local stub is free and
    // unthrottled-by-design (it's what makes the Apparatus never break), but
    // the bucket is consumed first so a noisy client can't bypass via a
    // provider that happens to be configured.
    if (identity) {
      await consumeRateLimit(ctx, {
        action: "research:search",
        identifier: identity.tokenIdentifier,
        ...RATE_LIMITS.research,
      });
    }

    const canHost = identity
      ? await userIsPro(ctx, identity.tokenIdentifier)
      : false;
    if (canHost && process.env.TINYFISH_API_KEY) {
      const r = await tinyfishSearch(args.query, args.context ?? "");
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
    if (identity) {
      await consumeRateLimit(ctx, {
        action: "research:fetch",
        identifier: identity.tokenIdentifier,
        ...RATE_LIMITS.research,
      });
    }
    const canHost = identity
      ? await userIsPro(ctx, identity.tokenIdentifier)
      : false;
    if (canHost && process.env.TINYFISH_API_KEY) {
      const r = await tinyfishFetch(args.url);
      if (r) return { ...r, provider: "tinyfish" };
    }
    return { ...localFetch(args.url), provider: "local" };
  },
});
