/**
 * Search backends for the Apparatus.
 *
 * Claim-checking needs one thing from a search API — turn a query into sources
 * — and every vendor spells that differently. Each adapter here owns the two
 * places the differences live: how the request is built, and where the results
 * hide in the response. Everything downstream sees `Source[]`.
 *
 * Adding a vendor means adding an entry to `SEARCH_BACKENDS`. Nothing in the
 * research loop, the settings UI, or the citation code needs to change.
 */

import type { Source } from "../../convex/research";
import type { SearchBackendConfig, SearchBackendId } from "../types";

export interface SearchRequest {
  query: string;
  context: string;
  maxResults: number;
}

export interface SearchBackendAdapter {
  id: SearchBackendId;
  label: string;
  /** Shown in settings so the writer knows where to get a key. */
  keyHint: string;
  defaultUrl: string;
  /** Whether the writer must supply their own endpoint. */
  requiresUrl?: boolean;
  buildRequest(
    req: SearchRequest,
    config: SearchBackendConfig,
  ): { url: string; init: RequestInit };
  /** Pull the result array out of the parsed response body. */
  extract(body: unknown, config: SearchBackendConfig): unknown;
}

function jsonPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): { url: string; init: RequestInit } {
  return {
    url,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  };
}

function endpoint(config: SearchBackendConfig, fallback: string): string {
  const custom = config.baseUrl.trim();
  return custom || fallback;
}

function pick(body: unknown, path: string): unknown {
  if (!path) return undefined;
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      body,
    );
}

/** First array of objects that look like search hits, searched breadth-first. */
function findResultArray(body: unknown): unknown {
  const queue: unknown[] = [body];
  let steps = 0;
  while (queue.length && steps < 200) {
    steps += 1;
    const node = queue.shift();
    if (Array.isArray(node)) {
      const looksLikeHits = node.some(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).url === "string",
      );
      if (looksLikeHits) return node;
      continue;
    }
    if (node && typeof node === "object") {
      queue.push(...Object.values(node as Record<string, unknown>));
    }
  }
  return undefined;
}

export const SEARCH_BACKENDS: Record<SearchBackendId, SearchBackendAdapter> = {
  tinyfish: {
    id: "tinyfish",
    label: "TinyFish",
    keyHint: "api.tinyfish.ai",
    defaultUrl: "https://api.search.tinyfish.ai/v1/search",
    buildRequest: (req, config) =>
      jsonPost(
        endpoint(config, "https://api.search.tinyfish.ai/v1/search"),
        { authorization: `Bearer ${config.apiKey}` },
        { query: req.query, context: req.context, num_results: req.maxResults },
      ),
    extract: (body) => (body as { results?: unknown })?.results,
  },

  exa: {
    id: "exa",
    label: "Exa",
    keyHint: "exa.ai",
    defaultUrl: "https://api.exa.ai/search",
    buildRequest: (req, config) =>
      jsonPost(
        endpoint(config, "https://api.exa.ai/search"),
        { "x-api-key": config.apiKey },
        {
          query: req.query,
          numResults: req.maxResults,
          type: "auto",
          contents: { text: { maxCharacters: 600 } },
        },
      ),
    extract: (body) => (body as { results?: unknown })?.results,
  },

  tavily: {
    id: "tavily",
    label: "Tavily",
    keyHint: "tavily.com",
    defaultUrl: "https://api.tavily.com/search",
    buildRequest: (req, config) =>
      jsonPost(
        endpoint(config, "https://api.tavily.com/search"),
        { authorization: `Bearer ${config.apiKey}` },
        {
          query: req.query,
          max_results: req.maxResults,
          search_depth: "advanced",
          include_answer: false,
        },
      ),
    extract: (body) => (body as { results?: unknown })?.results,
  },

  brave: {
    id: "brave",
    label: "Brave Search",
    keyHint: "brave.com/search/api",
    defaultUrl: "https://api.search.brave.com/res/v1/web/search",
    buildRequest: (req, config) => {
      const base = endpoint(
        config,
        "https://api.search.brave.com/res/v1/web/search",
      );
      const url = new URL(base);
      url.searchParams.set("q", req.query);
      url.searchParams.set("count", String(req.maxResults));
      return {
        url: url.toString(),
        init: {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-subscription-token": config.apiKey,
          },
        },
      };
    },
    extract: (body) => (body as { web?: { results?: unknown } })?.web?.results,
  },

  serper: {
    id: "serper",
    label: "Serper",
    keyHint: "serper.dev",
    defaultUrl: "https://google.serper.dev/search",
    buildRequest: (req, config) =>
      jsonPost(
        endpoint(config, "https://google.serper.dev/search"),
        { "x-api-key": config.apiKey },
        { q: req.query, num: req.maxResults },
      ),
    extract: (body) => (body as { organic?: unknown })?.organic,
  },

  custom: {
    id: "custom",
    label: "Custom JSON endpoint",
    keyHint: "your own search service",
    defaultUrl: "",
    requiresUrl: true,
    buildRequest: (req, config) =>
      jsonPost(
        config.baseUrl.trim(),
        config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        { query: req.query, context: req.context, max_results: req.maxResults },
      ),
    extract: (body, config) =>
      pick(body, config.resultsPath) ?? findResultArray(body),
  },
};

export const SEARCH_BACKEND_IDS = Object.keys(
  SEARCH_BACKENDS,
) as SearchBackendId[];

export function searchBackend(id: SearchBackendId): SearchBackendAdapter {
  return SEARCH_BACKENDS[id] ?? SEARCH_BACKENDS.tinyfish;
}

/**
 * Map one vendor's result object onto a Source. Field names vary enough
 * between vendors that this reads every spelling rather than per-adapter
 * mappers: a hit is a url plus whatever description the vendor supplies.
 */
export function toSource(value: unknown): Source | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const url = typeof rec.url === "string" ? rec.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return null;
  const str = (...keys: string[]): string => {
    for (const key of keys) {
      const v = rec[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const title = str("title", "name", "heading");
  const snippet = str(
    "snippet",
    "description",
    "text",
    "content",
    "summary",
    "excerpt",
  );
  const source: Source = {
    title: title || url,
    url,
    snippet: snippet.slice(0, 1200),
  };
  const author = str("author", "byline");
  const publisher = str("publisher", "source", "site", "siteName");
  const date = str("date", "published", "publishedDate", "published_date");
  if (author) source.author = author;
  if (publisher) source.publisher = publisher;
  if (date) source.date = date;
  return source;
}

export function toSources(value: unknown, maxResults: number): Source[] {
  if (!Array.isArray(value)) return [];
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const source = toSource(item);
    if (!source || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
    if (out.length >= maxResults) break;
  }
  return out;
}

/** Run a search against whichever backend the writer configured. */
export async function runSearchBackend(
  req: SearchRequest,
  config: SearchBackendConfig,
): Promise<{ ok: true; results: Source[] } | { ok: false; message: string }> {
  const adapter = searchBackend(config.id);
  if (adapter.requiresUrl && !config.baseUrl.trim()) {
    return {
      ok: false,
      message: `${adapter.label} needs an endpoint URL in Settings.`,
    };
  }
  if (!config.apiKey.trim() && adapter.id !== "custom") {
    return {
      ok: false,
      message: `No ${adapter.label} key — add one in Settings to search claims.`,
    };
  }
  const { url, init } = adapter.buildRequest(req, config);
  const res = await fetch(url, init);
  if (!res.ok) {
    return {
      ok: false,
      message: `${adapter.label} returned HTTP ${res.status}. Check the key or retry.`,
    };
  }
  const body = await res.json();
  return { ok: true, results: toSources(adapter.extract(body, config), req.maxResults) };
}
