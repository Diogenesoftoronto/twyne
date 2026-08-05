import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TwyneClient } from "../src/client.js";
import {
  createTwyneMcpServer,
  registerTwyneTools,
  TWYNE_MCP_TOOL_NAMES,
} from "../src/mcp.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe("Twyne MCP surface", () => {
  test("hard-limits the surface to the exact 10 unique requested names", () => {
    expect(TWYNE_MCP_TOOL_NAMES).toEqual([
      "twyne_list_folios",
      "twyne_get_folio",
      "twyne_create_folio",
      "twyne_update_folio",
      "twyne_search_folios",
      "twyne_import_folios",
      "twyne_export_folios",
      "twyne_get_feedback",
      "twyne_list_citations",
      "twyne_upsert_citations",
    ]);
    expect(new Set(TWYNE_MCP_TOOL_NAMES).size).toBe(TWYNE_MCP_TOOL_NAMES.length);
    expect(TWYNE_MCP_TOOL_NAMES.length).toBeLessThanOrEqual(15);

    const registered: string[] = [];
    const fakeServer = {
      registerTool(name: string) {
        registered.push(name);
      },
    } as unknown as McpServer;
    registerTwyneTools(fakeServer, {} as TwyneClient);
    expect(registered).toEqual(TWYNE_MCP_TOOL_NAMES);
  });

  test("returns both text and structuredContent through SDK v1", async () => {
    const twyne = new TwyneClient({
      apiUrl: "https://twyne.example",
      accessToken: "twyne_pat_secret",
      fetch: (async () =>
        Response.json({ ok: true, data: [{ id: "folio-1", name: "Draft", type: "draft" }] })) as typeof fetch,
    });
    const server = createTwyneMcpServer(twyne);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(() => client.close(), () => server.close());

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(TWYNE_MCP_TOOL_NAMES);
    const result = await client.callTool({ name: "twyne_list_folios", arguments: {} });
    expect(result.structuredContent).toEqual({
      result: [{ id: "folio-1", name: "Draft", type: "draft" }],
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify([{ id: "folio-1", name: "Draft", type: "draft" }], null, 2),
      },
    ]);
  });
});
