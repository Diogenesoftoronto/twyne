import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TwyneClient } from "../src/client.js";
import { brief, grade, interview, note, rewrite } from "./room-fixtures.js";
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
  test("hard-limits the surface to the exact 15 unique requested names", () => {
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
      "twyne_convene_room",
      "twyne_ask_editor",
      "twyne_suggest_rewrite",
      "twyne_grade_draft",
      "twyne_interview_turn",
    ]);
    expect(new Set(TWYNE_MCP_TOOL_NAMES).size).toBe(
      TWYNE_MCP_TOOL_NAMES.length,
    );
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
        Response.json({
          ok: true,
          data: [{ id: "folio-1", name: "Draft", type: "draft" }],
        })) as typeof fetch,
    });
    const server = createTwyneMcpServer(twyne);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closers.push(
      () => client.close(),
      () => server.close(),
    );

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(TWYNE_MCP_TOOL_NAMES);
    const result = await client.callTool({
      name: "twyne_list_folios",
      arguments: {},
    });
    expect(result.structuredContent).toEqual({
      result: [{ id: "folio-1", name: "Draft", type: "draft" }],
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          [{ id: "folio-1", name: "Draft", type: "draft" }],
          null,
          2,
        ),
      },
    ]);
  });
});

async function connectedClient(fetchImpl: typeof fetch) {
  const server = createTwyneMcpServer(
    new TwyneClient({
      apiUrl: "http://localhost:8788",
      accessToken: "twyne_pat_test",
      fetch: fetchImpl,
    }),
  );
  const client = new Client({ name: "room-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  closers.push(
    () => client.close(),
    () => server.close(),
  );
  return client;
}

const roomCases = [
  {
    name: "twyne_convene_room",
    operation: "room.convene",
    input: {
      draftText: "Everyone agrees.",
      personaIds: ["devil", "angel"],
      brief,
      writerProfile: {},
      responseLocale: "fr",
      newMaterial: "More",
      trajectory: { direction: "Tighten" },
    },
    data: { notes: [note] },
  },
  {
    name: "twyne_ask_editor",
    operation: "editor.ask",
    input: {
      folioId: "folio-1",
      personaId: "devil",
      instruction: "elaborate",
      userMessage: "Why?",
      priorMessages: [{ author: "writer", text: "Explain" }],
      anchor: "Everyone agrees.",
      brief: null,
      writerProfile: {},
      responseLocale: "en",
    },
    data: { note },
  },
  {
    name: "twyne_suggest_rewrite",
    operation: "rewrite.suggest",
    input: {
      draftText: "Everyone agrees.",
      personaId: "editor",
      original: "Everyone agrees.",
      level: "sentence",
      brief,
      writerProfile: {},
      responseLocale: "en",
    },
    data: rewrite,
  },
  {
    name: "twyne_grade_draft",
    operation: "rubric.grade",
    input: {
      folioId: "folio-1",
      brief,
      criteria: [{ label: "Clarity", description: "Readable" }],
      responseLocale: "en",
    },
    data: grade,
  },
  {
    name: "twyne_interview_turn",
    operation: "interview.turn",
    input: {
      messages: [{ author: "writer", text: "An essay" }],
      mode: "refine",
      currentBrief: brief,
      startingMaterial: "Opening",
      responseLocale: "en",
    },
    data: interview,
  },
];

describe("room MCP tools", () => {
  for (const example of roomCases) {
    test(`${example.name} round-trips data and input through MCP`, async () => {
      const requests: unknown[] = [];
      const client = await connectedClient((async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, data: example.data });
      }) as typeof fetch);
      const result = await client.callTool({
        name: example.name,
        arguments: example.input,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(example.data);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(example.data, null, 2) },
      ]);
      expect(requests).toEqual([
        { operation: example.operation, ...example.input },
      ]);
      const tool = (await client.listTools()).tools.find(
        (tool) => tool.name === example.name,
      );
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    });
  }

  for (const example of roomCases.slice(0, 4)) {
    test(`${example.name} rejects both or neither draft sources without fetching`, async () => {
      let calls = 0;
      const client = await connectedClient((async () => {
        calls++;
        return Response.json({ ok: true, data: {} });
      }) as typeof fetch);
      const input: Record<string, unknown> = { ...example.input };
      delete input.folioId;
      delete input.draftText;
      for (const source of [{}, { folioId: "folio-1", draftText: "Draft" }]) {
        const result = await client.callTool({
          name: example.name,
          arguments: { ...input, ...source },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
          { type: "text", text: "Supply exactly one of folioId or draftText" },
        ]);
      }
      expect(calls).toBe(0);
    });
  }

  test("returns API failures as tool errors", async () => {
    const client = await connectedClient((async () =>
      Response.json(
        { ok: false, error: "Insufficient credits" },
        { status: 402 },
      )) as typeof fetch);
    const result = await client.callTool({
      name: "twyne_convene_room",
      arguments: { draftText: "Draft" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Insufficient credits" },
    ]);
  });

  test("rejects unknown persona IDs in the input schema", async () => {
    let calls = 0;
    const client = await connectedClient((async () => {
      calls++;
      return Response.json({ ok: true, data: {} });
    }) as typeof fetch);
    const result = await client.callTool({
      name: "twyne_ask_editor",
      arguments: { draftText: "Draft", personaId: "unknown" },
    });
    expect(result.isError).toBe(true);
    expect(calls).toBe(0);
  });
});
