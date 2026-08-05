#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import {
  exportBundles,
  fetchFolioBundles,
  importSources,
  type ExportFormat,
} from "./archive.js";
import { TwyneClient } from "./client.js";
import { FOLIO_INCLUDES, type CitationEntry, type FolioInclude } from "./types.js";

export const TWYNE_MCP_TOOL_NAMES = [
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
] as const;

function textResult(value: unknown) {
  const structuredContent =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2) ?? String(value),
      },
    ],
    structuredContent,
  };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

async function resultOf(task: () => Promise<unknown>) {
  try {
    return textResult(await task());
  } catch (error) {
    return toolError(error);
  }
}

const folioType = z.enum(["draft", "notes", "outline"]);
const includeValue = z.enum(FOLIO_INCLUDES);
const folioId = z.string().trim().min(1).describe("Twyne folio ID");
const citationEntry = z.looseObject({
  id: z.string().optional(),
  title: z.string().trim().min(1),
  author: z.string().optional(),
  url: z.string().url().optional(),
  doi: z.string().optional(),
  citationKey: z.string().optional(),
  accessedAt: z.number().optional(),
});

export function registerTwyneTools(server: McpServer, client: TwyneClient): void {
  server.registerTool(
    "twyne_list_folios",
    {
      title: "List Twyne folios",
      description: "List the authenticated writer's Twyne folios with IDs, names, types, and timestamps.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => resultOf(() => client.listFolios()),
  );

  server.registerTool(
    "twyne_get_folio",
    {
      title: "Get a Twyne folio",
      description:
        "Fetch a folio and selected writing-room data. By default this includes manuscript HTML, brief, critiques, rubric, suggestions, and citations.",
      inputSchema: {
        folioId,
        include: z
          .array(includeValue)
          .optional()
          .describe("Optional fields to include; omit to fetch the complete folio bundle"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ folioId, include }) =>
      resultOf(async () => {
        const bundle = await client.getFolio(folioId, include as FolioInclude[] | undefined);
        if (!bundle) throw new Error(`Folio not found: ${folioId}`);
        return bundle;
      }),
  );

  server.registerTool(
    "twyne_create_folio",
    {
      title: "Create a Twyne folio",
      description: "Create a draft, notes, or outline folio, optionally with manuscript HTML and a project brief.",
      inputSchema: {
        name: z.string().trim().min(1).max(240),
        type: folioType.optional().default("draft"),
        html: z.string().optional().describe("Tiptap-compatible manuscript HTML"),
        brief: z.unknown().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, type, html, brief }) =>
      resultOf(() =>
        client.putFolio({
          folio: { name, type },
          ...(html !== undefined ? { html } : {}),
          ...(brief !== undefined ? { brief } : {}),
        }),
      ),
  );

  server.registerTool(
    "twyne_update_folio",
    {
      title: "Update a Twyne folio",
      description:
        "Update folio metadata, manuscript HTML, or brief. expectedUpdatedAt enables optimistic conflict detection.",
      inputSchema: {
        folioId,
        name: z.string().trim().min(1).max(240).optional(),
        type: folioType.optional(),
        html: z.string().optional(),
        brief: z.unknown().optional(),
        expectedUpdatedAt: z.number().optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ folioId, name, type, html, brief, expectedUpdatedAt }) =>
      resultOf(async () => {
        const current = await client.getFolio(folioId, []);
        if (!current) throw new Error(`Folio not found: ${folioId}`);
        return client.putFolio({
          folio: {
            ...current.folio,
            id: folioId,
            name: name ?? current.folio.name,
            type: type ?? current.folio.type,
          },
          ...(html !== undefined ? { html } : {}),
          ...(brief !== undefined ? { brief } : {}),
          ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
        });
      }),
  );

  server.registerTool(
    "twyne_search_folios",
    {
      title: "Search Twyne folios",
      description: "Search folio names and manuscript text, returning ranked snippets for fast retrieval.",
      inputSchema: {
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(50).optional().default(20),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, limit }) => resultOf(() => client.searchFolios(query, limit)),
  );

  server.registerTool(
    "twyne_import_folios",
    {
      title: "Import Twyne folios",
      description:
        "Bulk import one or more Twyne archive-v2 JSON bundles or individual Markdown, HTML, and text files supplied as name/content pairs.",
      inputSchema: {
        sources: z
          .array(
            z.object({
              name: z.string().trim().min(1).describe("Filename including .twyne.json, .md, .html, or .txt"),
              content: z.string(),
              type: folioType.optional(),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ sources }) => resultOf(() => importSources(client, sources)),
  );

  server.registerTool(
    "twyne_export_folios",
    {
      title: "Export Twyne folios",
      description:
        "Export selected folios, or all folios when IDs are omitted. Archive is the bulk Twyne archive-v2 format; Markdown, HTML, and text require one folio.",
      inputSchema: {
        folioIds: z.array(folioId).max(500).optional(),
        format: z.enum(["archive", "markdown", "html", "txt"]).optional().default("archive"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ folioIds, format }) =>
      resultOf(async () =>
        exportBundles(await fetchFolioBundles(client, folioIds), format as ExportFormat),
      ),
  );

  server.registerTool(
    "twyne_get_feedback",
    {
      title: "Get Twyne critiques",
      description:
        "Get all feedback for a folio in one fast call: editor notes and replies, rubric results, and actionable suggestions.",
      inputSchema: { folioId },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ folioId }) => resultOf(() => client.getFeedback(folioId)),
  );

  server.registerTool(
    "twyne_list_citations",
    {
      title: "List Twyne citations",
      description:
        "Retrieve saved sources, optionally scoped to a folio or searched by title, author, URL, DOI, or citation key. Use before adding sources to avoid duplicates.",
      inputSchema: {
        folioId: folioId.optional(),
        search: z.string().trim().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ folioId, search }) =>
      resultOf(() =>
        client.listCitations({
          ...(folioId ? { folioId } : {}),
          ...(search ? { search } : {}),
        }),
      ),
  );

  server.registerTool(
    "twyne_upsert_citations",
    {
      title: "Save Twyne citations",
      description:
        "Bulk create or update cited sources for a folio. Call this after using external sources so claims can retain their provenance; pass an existing citation ID to update it.",
      inputSchema: {
        folioId,
        entries: z.array(citationEntry).min(1).max(100),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ folioId, entries }) =>
      resultOf(() => client.putCitations(folioId, entries as CitationEntry[])),
  );
}

export function createTwyneMcpServer(client: TwyneClient): McpServer {
  const server = new McpServer({ name: "twyne", version: "0.1.0" });
  registerTwyneTools(server, client);
  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createTwyneMcpServer(await TwyneClient.fromEnvironment());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMcpServer().catch((error) => {
    console.error(`twyne-mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
