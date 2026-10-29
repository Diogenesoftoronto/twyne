/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
// Convex loads this provider through the lazy module glob, after setup.
const provider = supportsViteModules
  ? { issue: vi.fn(), request: vi.fn() }
  : ({} as never);
if (supportsViteModules) {
  vi.doMock("./lib/notorganic", () => ({
    issueNotOrganicAccessToken: provider.issue,
    providerJsonRequest: provider.request,
    notOrganicIssuer: () => "https://api.notorganic.info",
  }));
}
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

afterEach(() => vi.clearAllMocks());

function awardedKeys(): string[] {
  return (provider.request.mock.calls as Array<[string, unknown, RequestInit]>)
    .filter(([, , init]) => init?.method === "POST")
    .map(([, , init]) => JSON.parse(String(init.body)).achievement);
}

describeConvex("Twyne achievements", () => {
  test("awards what synced data earns, once, and lists the ledger", async () => {
    provider.issue.mockResolvedValue({ accessToken: "token" });
    provider.request.mockImplementation(
      async (_path: string, _token: unknown, init: RequestInit) =>
        init?.method === "POST"
          ? {}
          : {
              data: [
                {
                  id: "aw_1",
                  application: "twyne",
                  title: "First draft",
                  description: "Started writing.",
                  asset_path: "/achievements/twyne/first-draft.png",
                  awarded_at: 1,
                },
              ],
            },
    );
    const t = convexTest(schema, modules);
    const writer = t.withIdentity({
      tokenIdentifier: "issuer|writer",
      subject: "writer",
    });
    await t.run((ctx) =>
      ctx.db.insert("providerIdentities", {
        did: "did:plc:writer",
        productSubject: "writer",
        sessionVersion: 3,
        verificationMethod: "notorganic_pkce",
        verifiedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const notes = Array.from(
      { length: 10 },
      (_, i) => `<sup data-type="footnote">${i}</sup>`,
    ).join("");
    await writer.mutation(api.sync.putFolioContent, {
      folioId: "f1",
      html: `<p>${"word ".repeat(10_000)}${notes}</p>`,
      typstSource: "x",
    });
    await writer.mutation(api.sync.putSuggestion, {
      folioId: "f1",
      suggestionId: "s1",
      versionId: "v1",
      personaId: "p",
      personaName: "Editor",
      color: "red",
      blockId: "b",
      original: "A darling sentence.",
      replacement: "",
      rationale: "Cut it.",
      kind: "sentence",
      status: "accepted",
    });

    await t.action(internal.achievements.evaluate, {
      ownerId: "issuer|writer",
    });
    expect(awardedKeys().sort()).toEqual([
      "first-draft",
      "kill-your-darlings",
      "notes-from-the-room",
      "ten-thousand-words",
      "well-sourced",
    ]);
    expect(provider.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        did: "did:plc:writer",
        capabilities: ["achievements:award"],
        sessionVersion: 3,
      }),
    );

    provider.request.mockClear();
    await t.action(internal.achievements.evaluate, {
      ownerId: "issuer|writer",
    });
    expect(awardedKeys()).toEqual([]);

    const listed = await writer.action(api.achievements.listMine, {});
    expect(listed).toEqual([
      expect.objectContaining({
        title: "First draft",
        imageUrl:
          "https://id.notorganic.info/achievements/twyne/first-draft.png",
      }),
    ]);
  });

  test("never awards an account without a verified Not Organic link", async () => {
    const t = convexTest(schema, modules);
    const writer = t.withIdentity({ tokenIdentifier: "issuer|solo" });
    await writer.mutation(api.sync.putFolioContent, {
      folioId: "f1",
      html: "<p>Words</p>",
      typstSource: "Words",
    });
    await t.action(internal.achievements.evaluate, { ownerId: "issuer|solo" });
    expect(provider.request).not.toHaveBeenCalled();
  });
});
