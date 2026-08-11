/**
 * MCP client for the writer's own servers.
 *
 * Twyne connects to MCP servers from the browser, which is the right default —
 * the bearer token never leaves the device, and it works signed-out. It is also
 * the half that fails most often, because a browser will not call an endpoint
 * that does not opt in via CORS, and most hosted MCP servers do not. Worse, the
 * failure is deliberately opaque: a blocked cross-origin request throws a
 * TypeError with no status and no explanation, indistinguishable from the
 * server being down.
 *
 * So "auto" mode tries direct, and on that specific opaque failure replays the
 * request through `convex/mcp.ts:relay`. Once a server has needed the relay, it
 * stays relayed for the rest of the session rather than paying the failed
 * direct attempt on every call.
 *
 * The transport is the official SDK's Streamable HTTP client with a swapped
 * `fetch`, so the protocol (initialize handshake, session ids, SSE framing,
 * protocol negotiation) is handled by the SDK in both modes rather than
 * reimplemented.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { McpServerConfig } from "../types";

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceInfo {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  /** Set when this came from resources/templates/list rather than a concrete list. */
  template?: boolean;
}

export interface McpServerHandle {
  config: McpServerConfig;
  client: Client;
  route: "direct" | "relay";
  serverName?: string;
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  close: () => Promise<void>;
}

const CLIENT_INFO = { name: "twyne", version: "1" };
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * A cross-origin block surfaces as a bare TypeError with no response. A real
 * HTTP error (401, 404, 500) reaches us with a status and should not trigger a
 * relay retry — relaying would just repeat the same rejection from a different
 * address.
 */
function looksLikeCorsFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /failed to fetch|networkerror|load failed|cors|access-control/i.test(
      message,
    ) && !/\b(4\d\d|5\d\d)\b/.test(message)
  );
}

/** Servers known to need the relay, so we stop retrying direct every call. */
const relayOnly = new Set<string>();

function relayFetch(convex: ConvexClient): FetchLike {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const body =
      typeof init?.body === "string" ? init.body : init?.body ? "" : undefined;

    const res = (await convex.action(api.mcp.relay, {
      url,
      method: init?.method ?? "POST",
      headers,
      ...(body === undefined ? {} : { body }),
    })) as { status: number; headers: Record<string, string>; body: string };

    return new Response(res.body || null, {
      status: res.status,
      headers: new Headers(res.headers),
    });
  };
}

function buildTransport(
  config: McpServerConfig,
  fetchImpl: FetchLike | undefined,
) {
  const url = new URL(config.url);
  const headers: Record<string, string> = {};
  if (config.bearerToken.trim()) {
    headers.authorization = `Bearer ${config.bearerToken.trim()}`;
  }
  const opts = {
    requestInit: { headers },
    ...(fetchImpl ? { fetch: fetchImpl as never } : {}),
  };
  return config.transport === "sse"
    ? new SSEClientTransport(url, opts)
    : new StreamableHTTPClientTransport(url, opts);
}

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The MCP server did not answer in time.")),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverTools(client: Client): Promise<McpToolInfo[]> {
  try {
    const res = await client.listTools();
    return (res.tools ?? []).map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  } catch {
    // A server may expose only resources; that is not an error.
    return [];
  }
}

async function discoverResources(client: Client): Promise<McpResourceInfo[]> {
  const out: McpResourceInfo[] = [];
  try {
    const res = await client.listResources();
    for (const r of res.resources ?? []) {
      out.push({
        uri: r.uri,
        name: r.name,
        title: r.title,
        description: r.description,
        mimeType: r.mimeType,
      });
    }
  } catch {
    // Not every server implements resources/list.
  }
  try {
    const res = await client.listResourceTemplates();
    for (const t of res.resourceTemplates ?? []) {
      out.push({
        uri: t.uriTemplate,
        name: t.name,
        title: t.title,
        description: t.description,
        mimeType: t.mimeType,
        template: true,
      });
    }
  } catch {
    // Templates are optional too.
  }
  return out;
}

async function connectOnce(
  config: McpServerConfig,
  fetchImpl: FetchLike | undefined,
): Promise<Client> {
  const client = new Client(CLIENT_INFO, {
    capabilities: { roots: {}, sampling: {} },
  });
  await withTimeout(
    client.connect(buildTransport(config, fetchImpl)),
    CONNECT_TIMEOUT_MS,
  );
  return client;
}

/**
 * Open a server, discover what it offers, and report which route worked.
 *
 * `convex` may be null when signed out; the relay simply is not available then,
 * and a CORS-blocked server surfaces a message saying so.
 */
export async function connectMcpServer(
  config: McpServerConfig,
  convex: ConvexClient | null,
): Promise<McpServerHandle> {
  const canRelay = Boolean(convex) && config.connection !== "direct";
  const forceRelay =
    config.connection === "proxy" || relayOnly.has(config.id);

  let client: Client | null = null;
  let route: "direct" | "relay" = "direct";

  if (!forceRelay) {
    try {
      client = await connectOnce(config, undefined);
    } catch (error) {
      if (!canRelay || !looksLikeCorsFailure(error)) {
        throw new Error(mcpErrorMessage(error, config, canRelay));
      }
    }
  }

  if (!client) {
    if (!convex) {
      throw new Error(
        `${config.label || config.url} cannot be reached from the browser. Sign in so Twyne can relay the connection.`,
      );
    }
    try {
      client = await connectOnce(config, relayFetch(convex));
      route = "relay";
      relayOnly.add(config.id);
    } catch (error) {
      throw new Error(mcpErrorMessage(error, config, true));
    }
  }

  const [tools, resources] = await Promise.all([
    discoverTools(client),
    discoverResources(client),
  ]);
  const version = client.getServerVersion();

  return {
    config,
    client,
    route,
    serverName: version?.name,
    tools,
    resources,
    close: async () => {
      try {
        await client.close();
      } catch {
        // Closing a already-dead transport is not worth reporting.
      }
    },
  };
}

function mcpErrorMessage(
  error: unknown,
  config: McpServerConfig,
  triedRelay: boolean,
): string {
  const label = config.label || config.url;
  const raw = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized/i.test(raw)) {
    return `${label} rejected the token. Check the bearer token in Settings.`;
  }
  if (/404|not found/i.test(raw)) {
    return `${label} has no MCP endpoint at that URL. Many servers expect a path like /mcp.`;
  }
  if (!triedRelay && looksLikeCorsFailure(error)) {
    return `${label} refused a direct browser connection. Sign in, or set this server to relay through Twyne.`;
  }
  return `${label}: ${raw}`;
}

/**
 * Connect every enabled server, keeping failures per-server: one unreachable
 * knowledge base should not take the rest of the research pass down with it.
 */
export async function connectEnabledServers(
  servers: McpServerConfig[],
  convex: ConvexClient | null,
): Promise<{
  handles: McpServerHandle[];
  failures: { config: McpServerConfig; message: string }[];
}> {
  const enabled = servers.filter((s) => s.enabled && s.url.trim());
  const settled = await Promise.all(
    enabled.map(async (config) => {
      try {
        return { ok: true as const, handle: await connectMcpServer(config, convex) };
      } catch (error) {
        return {
          ok: false as const,
          config,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return {
    handles: settled.flatMap((r) => (r.ok ? [r.handle] : [])),
    failures: settled.flatMap((r) =>
      r.ok ? [] : [{ config: r.config, message: r.message }],
    ),
  };
}

/* ── Reading tool and resource output ──────────────────────────── */

export interface McpContentBlock {
  type: string;
  text?: string;
  uri?: string;
  mimeType?: string;
}

/**
 * MCP tool results carry `structuredContent` when the tool declares an output
 * schema, and a content block array otherwise — where JSON is commonly stringified
 * into a text block. Callers want the data, so try structured first and parse
 * text blocks as a fallback.
 */
export function readToolResult(result: unknown): {
  structured: unknown;
  text: string;
  isError: boolean;
} {
  const rec = (result ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(rec.content)
    ? (rec.content as McpContentBlock[])
    : [];
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  let structured = rec.structuredContent;
  if (structured === undefined && text) {
    try {
      structured = JSON.parse(text);
    } catch {
      structured = undefined;
    }
  }
  return { structured, text, isError: rec.isError === true };
}

/** Fill a URI template (RFC 6570 simple expansion) with named values. */
export function fillUriTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, expr: string) => {
    const name = expr.replace(/^[+#./;?&]/, "").split(/[,:*]/)[0];
    const value = values[name];
    return value === undefined ? match : encodeURIComponent(value);
  });
}
