import { afterEach, describe, expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import {
  accountKnowledgeSnapshot,
  accountResources,
  accountKnowledgeTools,
  callAccountTool,
  chooseAccountSearchTool,
  chooseAccountModelTool,
  chooseAccountSource,
  knowledgeSetupUrl,
  readAccountResource,
  refreshAccountKnowledge,
  resolveAccountToolReview,
  searchAccountKnowledge,
  setAccountKnowledgeContext,
} from "./account-knowledge";

const source = {
  id: "notes",
  label: "Writer notes",
  resources_allowed: true,
  tools: [
    {
      name: "search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    },
  ],
};
function setup(
  action: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>,
) {
  setAccountKnowledgeContext(
    { action } as unknown as ConvexClient,
    `writer-${Math.random()}`,
  );
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  setAccountKnowledgeContext(null, null);
});

describe("account knowledge consent and account boundaries", () => {
  test("sharing does not opt into tools or resources", async () => {
    let calls = 0;
    setup(async () => {
      calls++;
      return { data: [source] };
    });
    await refreshAccountKnowledge();
    expect(await accountKnowledgeTools()).toEqual({});
    expect(accountKnowledgeSnapshot().choices).toEqual({});
    await expect(
      callAccountTool("notes", "search", {}, "model"),
    ).rejects.toThrow("Select");
    await expect(accountResources("notes")).rejects.toThrow("Select");
    expect(calls).toBe(2);
  });
  test("exact calls wait for approval; cancel never sends a remote call", async () => {
    let calls = 0;
    setup(async () => {
      calls++;
      return { data: [source] };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "model", true);
    chooseAccountModelTool("notes", "search", true);
    const pending = callAccountTool(
      "notes",
      "search",
      { query: "draft claim" },
      "model",
    );
    expect(accountKnowledgeSnapshot().review).toMatchObject({
      label: "Writer notes",
      tool: "search",
      argumentsJson: '{\n  "query": "draft claim"\n}',
    });
    expect(calls).toBe(1);
    resolveAccountToolReview(false);
    await expect(pending).rejects.toThrow("cancelled");
    expect(calls).toBe(1);
  });
  test("account switches reject pending review and discard late catalogs", async () => {
    let settle!: (value: unknown) => void;
    setup(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const loading = refreshAccountKnowledge();
    setAccountKnowledgeContext(null, null);
    settle({ data: [source] });
    expect(await loading).toEqual([]);
    expect(accountKnowledgeSnapshot().sources).toEqual([]);
    setup(async () => ({ data: [source] }));
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "model", true);
    chooseAccountModelTool("notes", "search", true);
    const pending = callAccountTool("notes", "search", {}, "model");
    setAccountKnowledgeContext(null, null);
    await expect(pending).rejects.toThrow("cancelled");
    expect(accountKnowledgeSnapshot().review).toBeUndefined();
  });
  test("approved tool executes once; access revocation prunes consent", async () => {
    let calls = 0;
    setup(async (_, args) => {
      if (!args.tool) return { data: [source] };
      calls++;
      throw new Error(
        "Access to this source was revoked. Share it with Twyne in Not Organic, then refresh sources.",
      );
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "model", true);
    chooseAccountModelTool("notes", "search", true);
    await expect(
      callAccountTool("notes", "unapproved", {}, "model"),
    ).rejects.toThrow("not approved");
    const pending = callAccountTool("notes", "search", {}, "model");
    resolveAccountToolReview(true);
    await expect(pending).rejects.toThrow("revoked");
    expect(calls).toBe(1);
    expect(accountKnowledgeSnapshot().sources).toEqual([]);
    expect(accountKnowledgeSnapshot().choices).toEqual({});
  });
  test("resource reads require current selection and a listed URI", async () => {
    const reads: string[] = [];
    setup(async (_, args) => {
      if (!args.sourceId) return { data: [source] };
      if (args.uri) {
        reads.push(String(args.uri));
        return { contents: [{ text: "Untrusted plain source text" }] };
      }
      return { resources: [{ name: "Note", uri: "notes://one" }] };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "resources", true);
    await expect(
      readAccountResource("notes", "notes://unknown"),
    ).rejects.toThrow("listed");
    expect(await readAccountResource("notes", "notes://one")).toBe(
      "Untrusted plain source text",
    );
    expect(reads).toEqual(["notes://one"]);
    chooseAccountSource("notes", "resources", false);
    await expect(readAccountResource("notes", "notes://one")).rejects.toThrow(
      "Select",
    );
  });
  test("research needs an explicit tool and preserves genuine citation URLs", async () => {
    let calls = 0;
    setup(async (_, args) => {
      if (!args.tool) return { data: [source] };
      calls++;
      return {
        structuredContent: {
          results: [
            {
              title: "Paper",
              url: "https://example.org/paper",
              description: "Evidence",
            },
            { title: "Invented", url: "javascript:alert(1)" },
            { title: "No URL", text: "Knowledge text" },
          ],
        },
      };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "research", true);
    const input = { query: "claim", context: "", maxResults: 5 };
    expect((await searchAccountKnowledge(input)).warnings[0]).toContain(
      "Choose",
    );
    expect(calls).toBe(0);
    chooseAccountSearchTool("notes", "search");
    const pending = searchAccountKnowledge(input);
    await tick();
    resolveAccountToolReview(true);
    const result = await pending;
    expect(result.results.map((source) => source.url)).toEqual([
      "https://example.org/paper",
    ]);
    expect(result.provider).toBe("account:Writer notes");
    expect(calls).toBe(1);
  });
  test("late resource reads are discarded after account switch", async () => {
    let settle!: (value: unknown) => void;
    setup(async (_, args) => {
      if (!args.sourceId) return { data: [source] };
      if (args.uri)
        return new Promise((resolve) => {
          settle = resolve;
        });
      return { resources: [{ name: "Note", uri: "notes://one" }] };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "resources", true);
    const pending = readAccountResource("notes", "notes://one");
    await tick();
    setAccountKnowledgeContext(null, null);
    settle({ contents: [{ text: "Previous account secret" }] });
    await expect(pending).rejects.toThrow("discarded");
  });
  test("approval dispatches the reviewed immutable arguments", async () => {
    let sent: unknown;
    setup(async (_, input) => {
      if (!input.tool) return { data: [source] };
      sent = input.arguments;
      return { content: [] };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "model", true);
    chooseAccountModelTool("notes", "search", true);
    const args = { query: "reviewed", nested: { value: 1 } };
    const pending = callAccountTool("notes", "search", args, "model");
    args.query = "unreviewed";
    args.nested.value = 2;
    resolveAccountToolReview(true);
    await pending;
    expect(sent).toEqual({ query: "reviewed", nested: { value: 1 } });
  });
  test("deselecting a tool and aborting deny pending reviews", async () => {
    let calls = 0;
    setup(async () => {
      calls++;
      return { data: [source] };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "model", true);
    chooseAccountModelTool("notes", "search", true);
    const pending = callAccountTool("notes", "search", {}, "model");
    chooseAccountModelTool("notes", "search", false);
    await expect(pending).rejects.toThrow("cancelled");
    expect(calls).toBe(1);
    chooseAccountModelTool("notes", "search", true);
    const abort = new AbortController();
    const aborted = callAccountTool(
      "notes",
      "search",
      {},
      "model",
      abort.signal,
    );
    abort.abort();
    await expect(aborted).rejects.toThrow("cancelled");
    expect(calls).toBe(1);
  });
  test("malformed and duplicate catalogs fail closed", async () => {
    for (const sources of [
      [{ ...source, tools: [{ name: "bad", inputSchema: [] }] }],
      [source, source],
      [{ ...source, tools: [source.tools[0], source.tools[0]] }],
    ]) {
      setup(async () => ({ data: sources }));
      expect(await refreshAccountKnowledge()).toEqual([]);
      expect(accountKnowledgeSnapshot().error).toContain("unavailable");
      await expect(accountResources("notes")).rejects.toThrow("Select");
    }
  });
  test("older catalogs cannot replace a newer revocation response", async () => {
    let old!: (value: unknown) => void;
    let requests = 0;
    setup(async () =>
      ++requests === 1
        ? new Promise((resolve) => {
            old = resolve;
          })
        : { data: [] },
    );
    const first = refreshAccountKnowledge();
    await refreshAccountKnowledge();
    old({ data: [source] });
    await first;
    expect(accountKnowledgeSnapshot().sources).toEqual([]);
  });
  test("same-name definition changes clear exact consent and cancel review", async () => {
    let changed = false,
      calls = 0;
    setup(async (_, args) => {
      if (args.tool) {
        calls++;
        return {};
      }
      return {
        data: [
          {
            ...source,
            tools: changed
              ? [{ ...source.tools[0], description: "Now edits remote notes" }]
              : source.tools,
          },
        ],
      };
    });
    await refreshAccountKnowledge();
    chooseAccountSource("notes", "model", true);
    chooseAccountModelTool("notes", "search", true);
    const pending = callAccountTool("notes", "search", {}, "model");
    changed = true;
    await refreshAccountKnowledge();
    await expect(pending).rejects.toThrow("cancelled");
    expect(calls).toBe(0);
    expect(accountKnowledgeSnapshot().choices.notes.modelTools).toEqual([]);
  });
  test("handoff names the real Twyne product and same-origin return", () => {
    const url = new URL(
      knowledgeSetupUrl("https://www.twyne.love", "/apparatus/"),
    );
    expect(url.searchParams.get("app_product")).toBe("twyne");
    expect(url.searchParams.get("app_client")).toBe("https://www.twyne.love");
    expect(url.searchParams.get("return_to")).toBe(
      "https://www.twyne.love/apparatus/",
    );
    expect(() =>
      knowledgeSetupUrl("https://www.twyne.love", "https://evil.example/"),
    ).toThrow("same-site");
  });
});
