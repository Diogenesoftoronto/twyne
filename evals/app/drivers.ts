/**
 * How the evals reach Twyne: through the same surfaces an outside agent or a
 * script would use.
 *
 *   mcp         the `twyne-mcp` server, connected in-process over MCP's
 *               in-memory transport. Async context survives, so spans the app
 *               emits nest under each case's trace.
 *   mcp-stdio   the `twyne-mcp` server as a child process over stdio, the way
 *               Claude Code or Codex would launch it.
 *   cli         the `twyne` CLI as a child process with `--json`.
 *
 * Every driver talks to `/api/integrations/v1` with a personal access token,
 * whether the app runs in-process (./local-app.ts) or is a deployment.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TwyneClient } from "../../packages/twyne-tools/src/client";
import { createTwyneMcpServer } from "../../packages/twyne-tools/src/mcp";

const TOOLS_DIR = resolve(
  fileURLToPath(new URL("../../packages/twyne-tools", import.meta.url)),
);

export interface Connection {
  apiUrl: string;
  token: string;
  /** In-process fetch for the `mcp` driver; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface McpDriver {
  kind: "mcp" | "mcp-stdio";
  tools(): Promise<string[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

function toolPayload(result: {
  isError?: boolean;
  content?: unknown;
  structuredContent?: unknown;
}): unknown {
  const text = Array.isArray(result.content)
    ? result.content
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
        )
        .join("\n")
    : "";
  if (result.isError) throw new Error(text || "MCP tool failed");
  if (result.structuredContent !== undefined) return result.structuredContent;
  return text ? JSON.parse(text) : null;
}

export async function connectMcp(
  connection: Connection,
  kind: McpDriver["kind"] = "mcp",
): Promise<McpDriver> {
  const client = new Client({ name: "twyne-app-evals", version: "1.0.0" });
  let closeServer = async () => {};

  if (kind === "mcp") {
    const server = createTwyneMcpServer(
      new TwyneClient({
        apiUrl: connection.apiUrl,
        accessToken: connection.token,
        fetch: connection.fetch,
      }),
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    closeServer = () => server.close();
    await client.connect(clientSide);
  } else {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(TOOLS_DIR, "src/mcp.ts")],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          TWYNE_API_URL: connection.apiUrl,
          TWYNE_ACCESS_TOKEN: connection.token,
        },
        stderr: "pipe",
      }),
    );
  }

  return {
    kind,
    async tools() {
      const listed = await client.listTools();
      return listed.tools.map((tool) => tool.name);
    },
    async call(name, args) {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 600_000 },
      );
      return toolPayload(result as Parameters<typeof toolPayload>[0]);
    },
    async close() {
      await client.close();
      await closeServer();
    },
  };
}

/**
 * Run the `twyne` CLI once and parse its `--json` output. Files named in
 * `files` are written to a scratch directory and their paths substituted for
 * `{name}` placeholders in `args`.
 */
export async function runCliJson(
  connection: Connection,
  args: string[],
  files: Record<string, string> = {},
): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "twyne-cli-"));
  try {
    const paths: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      paths[name] = join(dir, name);
      await writeFile(paths[name], content);
    }
    const argv = args.map((arg) =>
      arg.replace(
        /\{([^}]+)\}/g,
        (match, name: string) => paths[name] ?? match,
      ),
    );
    const child = spawn(
      process.execPath,
      [join(TOOLS_DIR, "src/cli.ts"), ...argv, "--json"],
      {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          TWYNE_API_URL: connection.apiUrl,
          TWYNE_ACCESS_TOKEN: connection.token,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number>((done) =>
      child.on("close", (exit) => done(exit ?? 1)),
    );
    if (code !== 0)
      throw new Error(`twyne ${args[0]} exited ${code}: ${stderr.trim()}`);
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
