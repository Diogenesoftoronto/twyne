import { describe, expect, test } from "bun:test";
import { pickSearchTool, shapeArguments } from "./mcp-research";
import { fillUriTemplate, readToolResult } from "./mcp-client";
import type { McpServerHandle, McpToolInfo } from "./mcp-client";
import { DEFAULT_MCP_SERVER } from "../types";

function handle(tools: McpToolInfo[], searchToolName = ""): McpServerHandle {
  return {
    config: { ...DEFAULT_MCP_SERVER, id: "s1", url: "https://x/mcp", searchToolName },
    client: {} as McpServerHandle["client"],
    route: "direct",
    tools,
    resources: [],
    close: async () => {},
  };
}

const stringProp = { type: "string" };

describe("pickSearchTool", () => {
  test("prefers the tool the writer named, even against a better-looking one", () => {
    const chosen = pickSearchTool(
      handle(
        [
          { name: "search", description: "Search the web" },
          { name: "grep_vault", description: "Grep my notes" },
        ],
        "grep_vault",
      ),
    );
    expect(chosen?.name).toBe("grep_vault");
  });

  test("returns null when the named tool is not on the server", () => {
    expect(pickSearchTool(handle([{ name: "search" }], "missing"))).toBeNull();
  });

  test("auto-detects by name over description", () => {
    const chosen = pickSearchTool(
      handle([
        { name: "create_page", description: "Make a page you can search later" },
        { name: "find_documents", description: "Locate documents" },
      ]),
    );
    expect(chosen?.name).toBe("find_documents");
  });

  test("ignores servers with no search-shaped tool", () => {
    expect(
      pickSearchTool(handle([{ name: "delete_page" }, { name: "rename" }])),
    ).toBeNull();
  });
});

describe("shapeArguments", () => {
  const input = { query: "who said this", context: "a claim", maxResults: 5 };

  test("maps onto a conventional schema", () => {
    const args = shapeArguments(
      {
        name: "search",
        inputSchema: {
          type: "object",
          properties: {
            query: stringProp,
            context: stringProp,
            max_results: { type: "number" },
          },
        },
      },
      input,
    );
    expect(args).toEqual({
      query: "who said this",
      context: "a claim",
      max_results: 5,
    });
  });

  test("maps onto a server that spells everything differently", () => {
    const args = shapeArguments(
      {
        name: "find",
        inputSchema: {
          type: "object",
          properties: { q: stringProp, limit: { type: "integer" } },
        },
      },
      input,
    );
    expect(args).toEqual({ q: "who said this", limit: 5 });
  });

  test("omits a limit the tool does not accept", () => {
    const args = shapeArguments(
      {
        name: "grep",
        inputSchema: { type: "object", properties: { pattern: stringProp } },
      },
      input,
    );
    expect(args).toEqual({ pattern: "who said this" });
  });

  test("falls back to query when the schema is missing", () => {
    expect(shapeArguments({ name: "search" }, input)).toEqual({
      query: "who said this",
    });
  });

  test("never puts context in the same slot as the query", () => {
    const args = shapeArguments(
      {
        name: "search",
        inputSchema: { type: "object", properties: { text: stringProp } },
      },
      input,
    );
    expect(args).toEqual({ text: "who said this" });
  });
});

describe("readToolResult", () => {
  test("prefers structuredContent", () => {
    expect(
      readToolResult({
        structuredContent: { results: [{ url: "https://a" }] },
        content: [{ type: "text", text: "ignored" }],
      }).structured,
    ).toEqual({ results: [{ url: "https://a" }] });
  });

  test("parses JSON out of a text block when there is no structured output", () => {
    expect(
      readToolResult({
        content: [{ type: "text", text: '{"results":[{"url":"https://b"}]}' }],
      }).structured,
    ).toEqual({ results: [{ url: "https://b" }] });
  });

  test("keeps non-JSON text as text", () => {
    const result = readToolResult({
      content: [{ type: "text", text: "no sources found" }],
    });
    expect(result.structured).toBeUndefined();
    expect(result.text).toBe("no sources found");
  });

  test("surfaces the error flag", () => {
    expect(
      readToolResult({ isError: true, content: [{ type: "text", text: "boom" }] })
        .isError,
    ).toBe(true);
  });
});

describe("fillUriTemplate", () => {
  test("expands named values and escapes them", () => {
    expect(fillUriTemplate("notes://{folder}/{file}", {
      folder: "my notes",
      file: "draft.md",
    })).toBe("notes://my%20notes/draft.md");
  });

  test("leaves unknown variables in place rather than emptying them", () => {
    expect(fillUriTemplate("notes://{folder}/{file}", { folder: "a" })).toBe(
      "notes://a/{file}",
    );
  });

  test("handles operator prefixes", () => {
    expect(fillUriTemplate("https://x/{+path}", { path: "a/b" })).toBe(
      "https://x/a%2Fb",
    );
  });
});
