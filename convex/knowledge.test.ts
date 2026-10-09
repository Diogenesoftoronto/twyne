/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";

const provider = vi.hoisted(() => ({ issue: vi.fn(), request: vi.fn() }));
vi.mock("./lib/notorganic", () => ({
  issueNotOrganicAccessToken: provider.issue,
  providerJsonRequest: provider.request,
  notOrganicIssuer: () => "https://api.notorganic.info",
}));
const modules = import.meta.glob("./**/*.ts");
const sources = makeFunctionReference<"action", Record<string, never>, unknown>(
  "knowledge:sources",
);
const call = makeFunctionReference<
  "action",
  { sourceId: string; tool: string; arguments: unknown },
  unknown
>("knowledge:call");
const read = makeFunctionReference<
  "action",
  { sourceId: string; uri: string },
  unknown
>("knowledge:read");
async function setup(verified = true) {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("providerIdentities", {
      did: "did:plc:writer",
      productSubject: "writer",
      verificationMethod: verified
        ? "notorganic_pkce"
        : "legacy_atproto_browser_oauth",
      sessionVersion: 7,
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  provider.issue.mockResolvedValue({ accessToken: "server-only" });
  provider.request.mockResolvedValue({ data: [] });
  return {
    t,
    writer: t.withIdentity({
      subject: "writer",
      tokenIdentifier: "https://auth.twyne.love|writer",
    }),
  };
}
afterEach(() => {
  vi.clearAllMocks();
});
describe("trusted Twyne account knowledge actions", () => {
  test("anonymous and unverified links cannot obtain provider credentials", async () => {
    const { t, writer } = await setup(false);
    await expect(t.action(sources, {})).rejects.toThrow("Sign in");
    await expect(writer.action(sources, {})).rejects.toThrow("Reconnect");
    expect(provider.issue).not.toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalled();
  });
  test("lists with verified DID/sessionVersion and minimum read capability", async () => {
    const { writer } = await setup();
    expect(await writer.action(sources, {})).toEqual({ data: [] });
    expect(provider.issue).toHaveBeenCalledWith({
      did: "did:plc:writer",
      sessionVersion: 7,
      feature: "knowledge",
      capabilities: ["knowledge:read"],
    });
    expect(provider.request.mock.calls[0]?.[0]).toBe("/v1/knowledge/sources");
  });
  test("calls request only tool capability and escape route segments", async () => {
    const { writer } = await setup();
    await writer.action(call, {
      sourceId: "notes/one",
      tool: "search?all",
      arguments: { query: "claim" },
    });
    expect(provider.issue.mock.calls[0]?.[0].capabilities).toEqual([
      "knowledge:tools",
    ]);
    expect(provider.request.mock.calls[0]?.[0]).toBe(
      "/v1/knowledge/sources/notes%2Fone/tools/search%3Fall/call",
    );
    expect(provider.request.mock.calls[0]?.[2]).toMatchObject({
      method: "POST",
      body: '{"arguments":{"query":"claim"}}',
    });
  });
  test("resource read validates URI and keeps scope at read", async () => {
    const { writer } = await setup();
    await expect(
      writer.action(read, { sourceId: "notes", uri: "" }),
    ).rejects.toThrow("listed");
    await writer.action(read, { sourceId: "notes", uri: "notes://one" });
    expect(provider.issue.mock.calls[0]?.[0].capabilities).toEqual([
      "knowledge:read",
    ]);
    expect(provider.request.mock.calls[0]?.[0]).toBe(
      "/v1/knowledge/sources/notes/resources/read",
    );
  });
  test("changed tool consent requires a fresh review without replay", async () => {
    const { writer } = await setup();
    provider.request.mockRejectedValueOnce(
      new Error("Not Organic API failed (409): knowledge_tool_changed"),
    );
    await expect(
      writer.action(call, { sourceId: "notes", tool: "search", arguments: {} }),
    ).rejects.toThrow("tool changed");
    expect(provider.request).toHaveBeenCalledTimes(1);
  });
  test("revocation is actionable and upstream details never reach the browser", async () => {
    const { writer } = await setup();
    provider.request.mockRejectedValueOnce(
      new Error("Not Organic API failed (403): secret details"),
    );
    await expect(writer.action(sources, {})).rejects.toThrow("revoked");
    provider.request.mockRejectedValueOnce(
      new Error("private internal configuration"),
    );
    await expect(writer.action(sources, {})).rejects.toThrow("unavailable");
    expect(provider.request).toHaveBeenCalledTimes(2);
  });
});
