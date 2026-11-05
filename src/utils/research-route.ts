/**
 * Where the Apparatus searches, decided once per claim from what the writer
 * has: an account, a search key, an AI key whose provider can search the web.
 *
 * "Automatic" (stored as `hosted`) is the default, and it is the only choice
 * that adapts. Signed in, the writer's Twyne account searches through Not
 * Organic. Signed out, the writer's own keys take over: a search key first,
 * then an AI provider with built-in web search. The explicit choices are
 * honoured as chosen.
 */
import type { ApparatusResearchProvider, SearchBackendConfig } from "../types";
import { searchBackend } from "./research-backends";

export type ResearchRoute =
  | { kind: "account" }
  | { kind: "search-api"; name: string }
  | { kind: "model-web-search"; name: string; live: boolean }
  | { kind: "mcp" }
  | { kind: "none" };

/** The writer's model for research web search, as the route needs it. */
export interface ResearchSearchModel {
  name: string;
  /** The provider's API runs the search itself (OpenAI, Anthropic, Google). */
  live: boolean;
}

export function hasSearchKey(backend: SearchBackendConfig): boolean {
  return backend.id === "custom"
    ? !!backend.baseUrl.trim()
    : !!backend.apiKey.trim();
}

export function resolveResearchRoute(input: {
  provider: ApparatusResearchProvider;
  searchBackend: SearchBackendConfig;
  signedIn: boolean;
  searchModel: ResearchSearchModel | null;
}): ResearchRoute {
  const { provider, searchBackend: backend, signedIn, searchModel } = input;
  const keyRoute: ResearchRoute = {
    kind: "search-api",
    name: searchBackend(backend.id).label,
  };
  switch (provider) {
    case "search-api":
      return hasSearchKey(backend) ? keyRoute : { kind: "none" };
    case "model-web-search":
      return searchModel
        ? { kind: "model-web-search", ...searchModel }
        : { kind: "none" };
    case "web-mcp":
      return { kind: "mcp" };
    case "hosted":
    default:
      if (signedIn) return { kind: "account" };
      if (hasSearchKey(backend)) return keyRoute;
      if (searchModel?.live)
        return { kind: "model-web-search", ...searchModel };
      return { kind: "none" };
  }
}

/** One line for the status area: who is doing the searching. */
export function describeResearchRoute(route: ResearchRoute): string {
  switch (route.kind) {
    case "account":
      return "Searching through your Twyne account";
    case "search-api":
      return `Searching with your ${route.name} key`;
    case "model-web-search":
      return route.live
        ? `Searching with ${route.name} web search on your key`
        : `Asking ${route.name} for sources, without live search`;
    case "mcp":
      return "Searching your MCP servers";
    case "none":
      return "Nothing to search with yet";
  }
}

export const NO_ROUTE_MESSAGE =
  "Nothing to search with. Sign in, add a search key, or choose an OpenAI, Anthropic or Google model for web search in Settings.";

export interface GroundedSource {
  url: string;
  title?: string;
}

/**
 * The pages a provider's search tool returned, from its raw output. OpenAI
 * lists them under `sources`, Anthropic as an array of results; both carry a
 * `url`. Inline citations alone miss them when the answer is plain JSON.
 */
export function sourcesInToolOutput(output: unknown): GroundedSource[] {
  const found: GroundedSource[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.url === "string" && /^https?:\/\//.test(record.url)) {
      found.push({
        url: record.url,
        title: typeof record.title === "string" ? record.title : undefined,
      });
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(output, 0);
  return found;
}

/** Google grounding cites through its own redirect and names the site in the title. */
const GOOGLE_REDIRECT_HOST = "vertexaisearch.cloud.google.com";

function pageKey(url: string): { host: string; page: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return { host, page: `${host}${parsed.pathname.replace(/\/+$/, "")}` };
  } catch {
    return null;
  }
}

/**
 * Keep only the sources a web search actually returned. A model asked for
 * sources will also offer pages it remembers, and a remembered URL is not
 * evidence. Pages match on host and path; Google's redirects can only be
 * matched on the site they name.
 */
export function keepGroundedSources<T extends { url: string }>(
  results: readonly T[],
  grounded: readonly GroundedSource[],
): T[] {
  const pages = new Set<string>();
  const sites = new Set<string>();
  for (const source of grounded) {
    const key = pageKey(source.url);
    if (!key) continue;
    if (key.host === GOOGLE_REDIRECT_HOST) {
      const site = source.title
        ?.trim()
        .toLowerCase()
        .replace(/^www\./, "");
      if (site) sites.add(site);
    } else {
      pages.add(key.page);
    }
  }
  return results.filter((result) => {
    const key = pageKey(result.url);
    return !!key && (pages.has(key.page) || sites.has(key.host));
  });
}
