/**
 * Using the writer's MCP servers as research.
 *
 * Two things stand between "a server is connected" and "a claim has a source":
 *
 *  1. Nobody agrees what a search tool is called or what arguments it takes.
 *     One server has `search(query, max_results)`, the next has
 *     `find_documents(q, limit)`, a vault exposes `grep(pattern)`. Rather than
 *     make the writer describe each one, `pickSearchTool` and `shapeArguments`
 *     read the tool's own declared schema and map Twyne's three inputs onto it.
 *  2. Connections are expensive relative to a research pass, which fires one
 *     search per claim. `pool` keeps handles alive for the session and rebuilds
 *     only when the server list actually changes.
 *
 * Resources are the other half: a knowledge base that exposes documents rather
 * than a search tool still has citable material, so `readMcpResources` pulls
 * those directly.
 */

import { jsonSchema, tool, type ToolSet } from "ai";
import type { ConvexClient } from "convex/browser";
import type { Source } from "../../convex/research";
import type { ApparatusSettings, McpServerConfig } from "../types";
import {
  connectEnabledServers,
  fillUriTemplate,
  readToolResult,
  type McpResourceInfo,
  type McpServerHandle,
  type McpToolInfo,
} from "./mcp-client";
import { toSources } from "./research-backends";

/* ── Connection pool ───────────────────────────────────────────── */

interface Pool {
  signature: string;
  handles: McpServerHandle[];
  failures: { config: McpServerConfig; message: string }[];
}

let pool: Pool | null = null;
let pending: Promise<Pool> | null = null;

/**
 * The Convex client the relay needs, shared across entry points.
 *
 * The research watcher is handed a client at startup; the drafting tool loop is
 * not, and has no route to one. Rather than thread it through every caller, the
 * watcher publishes it here.
 */
let convexForRelay: ConvexClient | null = null;

export function setMcpConvexClient(client: ConvexClient | null): void {
  convexForRelay = client;
}

export function mcpConvexClient(): ConvexClient | null {
  return convexForRelay;
}

/** Everything that would require reconnecting, and nothing that would not. */
function signatureOf(servers: McpServerConfig[]): string {
  return servers
    .filter((s) => s.enabled)
    .map((s) =>
      [s.id, s.url, s.transport, s.connection, s.bearerToken ? "t" : ""].join(
        "\0",
      ),
    )
    .join("\x01");
}

async function getPool(
  servers: McpServerConfig[],
  convex: ConvexClient | null,
): Promise<Pool> {
  const signature = signatureOf(servers);
  if (pool && pool.signature === signature) return pool;
  if (pending) {
    const settled = await pending;
    if (settled.signature === signature) return settled;
  }
  pending = (async () => {
    if (pool) await Promise.all(pool.handles.map((h) => h.close()));
    const { handles, failures } = await connectEnabledServers(servers, convex);
    pool = { signature, handles, failures };
    return pool;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}

/** Drop every connection — called when settings change or on sign-out. */
export async function resetMcpPool(): Promise<void> {
  const current = pool;
  pool = null;
  pending = null;
  if (current) await Promise.all(current.handles.map((h) => h.close()));
}

export async function inspectMcpServers(
  servers: McpServerConfig[],
  convex: ConvexClient | null,
): Promise<Pool> {
  return getPool(servers, convex);
}

/* ── Tool selection ────────────────────────────────────────────── */

const SEARCH_NAME_HINTS = [
  "search",
  "query",
  "find",
  "lookup",
  "retrieve",
  "grep",
  "fetch_documents",
];

/**
 * The tool most likely to answer "find me sources for this claim".
 *
 * A configured name always wins — auto-detection is a convenience, not a
 * substitute for the writer knowing their own server.
 */
export function pickSearchTool(handle: McpServerHandle): McpToolInfo | null {
  const configured = handle.config.searchToolName.trim();
  if (configured) {
    return handle.tools.find((t) => t.name === configured) ?? null;
  }
  const scored = handle.tools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
      let score = 0;
      for (const hint of SEARCH_NAME_HINTS) {
        if (tool.name.toLowerCase().includes(hint)) score += 3;
        else if (haystack.includes(hint)) score += 1;
      }
      // A tool that takes a free-text argument is a likelier search than one
      // that takes an id.
      if (stringArgName(tool)) score += 2;
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.tool ?? null;
}

function properties(tool: McpToolInfo): Record<string, Record<string, unknown>> {
  const props = tool.inputSchema?.properties;
  return props && typeof props === "object"
    ? (props as Record<string, Record<string, unknown>>)
    : {};
}

function findProp(
  tool: McpToolInfo,
  type: string,
  names: string[],
): string | null {
  const props = properties(tool);
  for (const name of names) {
    const prop = props[name];
    if (prop && (prop.type === type || prop.type === undefined)) return name;
  }
  // Fall back to any property of the right type whose name contains a hint.
  for (const [name, prop] of Object.entries(props)) {
    if (prop?.type !== type) continue;
    if (names.some((hint) => name.toLowerCase().includes(hint))) return name;
  }
  return null;
}

function stringArgName(tool: McpToolInfo): string | null {
  return findProp(tool, "string", [
    "query",
    "q",
    "search",
    "keyword",
    "keywords",
    "text",
    "prompt",
    "input",
    "pattern",
    "term",
  ]);
}

/**
 * Map Twyne's (query, context, maxResults) onto whatever this tool declares.
 * Unknown required arguments are left out — the server's own error is a better
 * message than a guess.
 */
export function shapeArguments(
  tool: McpToolInfo,
  input: { query: string; context: string; maxResults: number },
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const queryArg = stringArgName(tool) ?? "query";
  args[queryArg] = input.query;

  const contextArg = findProp(tool, "string", [
    "context",
    "instructions",
    "background",
    "hint",
  ]);
  if (contextArg && contextArg !== queryArg && input.context) {
    args[contextArg] = input.context;
  }

  const limitArg =
    findProp(tool, "number", [
      "max_results",
      "maxresults",
      "num_results",
      "limit",
      "count",
      "top_k",
      "topk",
      "n",
    ]) ??
    findProp(tool, "integer", [
      "max_results",
      "maxresults",
      "num_results",
      "limit",
      "count",
      "top_k",
      "topk",
      "n",
    ]);
  if (limitArg) args[limitArg] = input.maxResults;

  return args;
}

/* ── Search ────────────────────────────────────────────────────── */

export interface McpSearchOutcome {
  results: Source[];
  provider: string;
  /** Populated when some servers answered and others did not. */
  warnings: string[];
}

/**
 * Search every enabled server that has a usable tool, and merge the hits.
 *
 * Servers are queried together rather than in priority order: a writer with a
 * web-search server and a personal vault wants both consulted for the same
 * claim, and the ranking that follows already prefers the better match.
 */
export async function searchMcpServers(
  input: { query: string; context: string },
  settings: ApparatusSettings,
  convex: ConvexClient | null,
): Promise<McpSearchOutcome> {
  const { handles, failures } = await getPool(settings.mcpServers, convex);
  const warnings = failures.map(
    (f) => `${f.config.label || f.config.url}: ${f.message}`,
  );
  if (!handles.length) return { results: [], provider: "mcp", warnings };

  const perServer = await Promise.all(
    handles.map(async (handle) => {
      const tool = pickSearchTool(handle);
      if (!tool) {
        warnings.push(
          `${handle.config.label || handle.config.url} exposes no search tool. Name one in Settings if it should be used.`,
        );
        return [] as Source[];
      }
      try {
        const raw = await handle.client.callTool({
          name: tool.name,
          arguments: shapeArguments(tool, {
            ...input,
            maxResults: settings.maxResults,
          }),
        });
        const { structured, text, isError } = readToolResult(raw);
        if (isError) {
          warnings.push(
            `${handle.config.label || handle.config.url} (${tool.name}): ${text || "tool reported an error"}`,
          );
          return [] as Source[];
        }
        return extractSources(structured, settings.maxResults);
      } catch (error) {
        warnings.push(
          `${handle.config.label || handle.config.url} (${tool.name}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [] as Source[];
      }
    }),
  );

  const merged: Source[] = [];
  const seen = new Set<string>();
  for (const source of perServer.flat()) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    merged.push(source);
  }
  const names = handles.map((h) => h.config.label || h.serverName || "mcp");
  return {
    results: merged.slice(0, settings.maxResults),
    provider: `mcp:${names.join(",")}`,
    warnings,
  };
}

/** Search tool output is JSON, but where the hits sit is anyone's guess. */
function extractSources(structured: unknown, maxResults: number): Source[] {
  if (!structured) return [];
  const direct = toSources(structured, maxResults);
  if (direct.length) return direct;
  if (typeof structured !== "object") return [];
  const rec = structured as Record<string, unknown>;
  for (const key of ["results", "sources", "documents", "items", "data", "hits"]) {
    const hit = toSources(rec[key], maxResults);
    if (hit.length) return hit;
  }
  return [];
}

/* ── Tools for the drafting loop ───────────────────────────────── */

/** MCP tool names allow characters the model-facing namespace should not. */
function toolKey(serverId: string, toolName: string): string {
  return `mcp_${serverId}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
}

const MAX_TOOL_RESULT_CHARS = 8000;

/**
 * Offer the writer's MCP tools to a persona mid-draft.
 *
 * Only servers with `exposeToModel` are included: a writer who connects a
 * research server does not thereby agree that every editorial persona may call
 * it on every note. The names are namespaced per server so two servers can both
 * expose a tool called `search` without colliding.
 */
export async function buildMcpToolSet(
  settings: ApparatusSettings,
  convex: ConvexClient | null,
): Promise<ToolSet> {
  const servers = settings.mcpServers.filter(
    (s) => s.enabled && s.exposeToModel && s.url.trim(),
  );
  if (!servers.length) return {};

  const { handles } = await getPool(settings.mcpServers, convex);
  const tools: ToolSet = {};

  for (const handle of handles) {
    if (!handle.config.exposeToModel) continue;
    const serverLabel = handle.config.label || handle.serverName || "MCP";
    for (const info of handle.tools) {
      const key = toolKey(handle.config.id, info.name);
      const schema = (info.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>;

      tools[key] = tool({
        description:
          `${info.description ?? info.title ?? info.name} (from ${serverLabel})`.slice(
            0,
            1000,
          ),
        inputSchema: jsonSchema(schema as never),
        execute: async (args) => {
          try {
            const raw = await handle.client.callTool({
              name: info.name,
              arguments: (args ?? {}) as Record<string, unknown>,
            });
            const { structured, text, isError } = readToolResult(raw);
            if (isError) {
              return { error: text || `${info.name} failed.` };
            }
            // Prefer structured data; fall back to the text the tool printed.
            if (structured !== undefined) {
              const json = JSON.stringify(structured);
              return json.length > MAX_TOOL_RESULT_CHARS
                ? { truncated: true, result: json.slice(0, MAX_TOOL_RESULT_CHARS) }
                : { result: structured };
            }
            return { result: text.slice(0, MAX_TOOL_RESULT_CHARS) };
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
    }
  }
  return tools;
}

/* ── Resources as knowledge bases ──────────────────────────────── */

export interface McpDocument {
  server: string;
  uri: string;
  title: string;
  mimeType?: string;
  text: string;
}

const MAX_RESOURCE_CHARS = 20_000;

function resourceTitle(resource: McpResourceInfo): string {
  return resource.title || resource.name || resource.uri;
}

/**
 * List the documents the writer's servers expose, without reading them.
 * Templates are reported but not expanded — they need arguments Twyne does not
 * have until someone asks for a specific document.
 */
export async function listMcpDocuments(
  settings: ApparatusSettings,
  convex: ConvexClient | null,
): Promise<{ server: string; resource: McpResourceInfo }[]> {
  const { handles } = await getPool(settings.mcpServers, convex);
  return handles
    .filter((h) => h.config.useResources)
    .flatMap((h) =>
      h.resources.map((resource) => ({
        server: h.config.label || h.config.url,
        resource,
      })),
    );
}

/** Read one resource's text, expanding a template if values are supplied. */
export async function readMcpResource(
  uri: string,
  settings: ApparatusSettings,
  convex: ConvexClient | null,
  templateValues: Record<string, string> = {},
): Promise<McpDocument | null> {
  const { handles } = await getPool(settings.mcpServers, convex);
  const resolved = fillUriTemplate(uri, templateValues);

  for (const handle of handles) {
    if (!handle.config.useResources) continue;
    const known = handle.resources.some(
      (r) => r.uri === uri || fillUriTemplate(r.uri, templateValues) === resolved,
    );
    if (!known) continue;
    try {
      const res = await handle.client.readResource({ uri: resolved });
      // Contents are either text or a base64 blob; only text is citable here.
      const text = (res.contents ?? [])
        .map((entry) => ("text" in entry && typeof entry.text === "string" ? entry.text : ""))
        .join("\n")
        .trim();
      if (!text) continue;
      const meta = handle.resources.find((r) => r.uri === uri);
      return {
        server: handle.config.label || handle.config.url,
        uri: resolved,
        title: meta ? resourceTitle(meta) : resolved,
        mimeType: meta?.mimeType,
        text: text.slice(0, MAX_RESOURCE_CHARS),
      };
    } catch {
      // Try the next server that claims this uri.
    }
  }
  return null;
}
