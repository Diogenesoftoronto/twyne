import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Agent } from "@atproto/api";
import { ensurePublication, publishDocument } from "./standard-site";

const idb = { values: new Map<string, unknown>() };

vi.mock("./idb", () => ({
  loadMetaFromIdb: async <T>(key: string): Promise<T | null> =>
    (idb.values.get(key) as T | undefined) ?? null,
  saveMetaToIdb: async (key: string, value: unknown): Promise<void> => {
    idb.values.set(key, value);
  },
}));

const did = "did:plc:abcdefghijklmnopqrstuvwx";
const publicationRkey = "3mabcde234567";
const documentRkey = "3mzyxwv765432";

function mockAgent(actorDid = did) {
  const createRecord = vi.fn(async (input: { collection: string }) => ({
    data: {
      uri:
        input.collection === "site.standard.publication"
          ? `at://${actorDid}/site.standard.publication/${publicationRkey}`
          : `at://${actorDid}/site.standard.document/${documentRkey}`,
    },
  }));
  const putRecord = vi.fn(async (input: { collection: string }) => ({
    data: {
      uri:
        input.collection === "site.standard.publication"
          ? `at://${actorDid}/site.standard.publication/${publicationRkey}`
          : `at://${actorDid}/site.standard.document/${documentRkey}`,
    },
  }));
  const agent = {
    did: actorDid,
    assertDid: actorDid,
    com: {
      atproto: {
        repo: {
          listRecords: vi.fn().mockResolvedValue({ data: { records: [] } }),
          getRecord: vi.fn().mockRejectedValue(new Error("missing")),
          createRecord,
          putRecord,
          deleteRecord: vi.fn(),
        },
      },
    },
  } as unknown as Agent;
  return { agent, createRecord, putRecord };
}

describe("Standard.site PDS publishing", () => {
  beforeEach(() => idb.values.clear());

  test("creates a publication then replaces its temporary URL with a verifiable canonical URL", async () => {
    const { agent, putRecord } = mockAgent();
    const publication = await ensurePublication(agent, { name: "A Writer" });

    expect(publication.url).toBe(
      `https://twyne.love/at/did%3Aplc%3Aabcdefghijklmnopqrstuvwx/${publicationRkey}`,
    );
    expect(putRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "site.standard.publication",
        rkey: publicationRkey,
        record: expect.objectContaining({
          $type: "site.standard.publication",
          name: "A Writer",
          url: publication.url,
          preferences: { showInDiscover: true },
        }),
      }),
    );
  });

  test("emits the current content union shape and a real document reader path", async () => {
    const { agent, putRecord } = mockAgent();
    const publication = await ensurePublication(agent, { name: "A Writer" });
    const result = await publishDocument(agent, {
      folio: {
        id: "folio-1",
        name: "A Piece",
        type: "draft",
        createdAt: 1,
        updatedAt: 1,
      },
      html: "<h1>Hello</h1><p><strong>World</strong></p>",
      brief: null,
      publication,
    });

    const documentPut = putRecord.mock.calls.find(
      ([input]) => input.collection === "site.standard.document",
    )?.[0] as unknown as { record: Record<string, unknown> };
    expect(documentPut.record).toMatchObject({
      $type: "site.standard.document",
      site: publication.uri,
      path: `/${documentRkey}`,
      content: {
        $type: "at.markpub.markdown",
        text: {
          $type: "at.markpub.text",
          markdown: expect.stringContaining("**World**"),
        },
        flavor: "gfm",
        renderingRules: "marked",
      },
    });
    expect(Array.isArray(documentPut.record.content)).toBe(false);
    expect(result.viewerUrl).toBe(
      `https://twyne.love/at/did%3Aplc%3Aabcdefghijklmnopqrstuvwx/${publicationRkey}/${documentRkey}`,
    );
  });

  test("keeps publication and document caches isolated by writer DID", async () => {
    const secondDid = "did:plc:zyxwvutsrqponmlkjihgfedc";
    const first = mockAgent(did);
    const second = mockAgent(secondDid);
    const folio = {
      id: "shared-browser-folio",
      name: "A Piece",
      type: "draft" as const,
      createdAt: 1,
      updatedAt: 1,
    };

    const firstPublication = await ensurePublication(first.agent, {
      name: "First Writer",
    });
    await publishDocument(first.agent, {
      folio,
      html: "<p>First</p>",
      brief: null,
      publication: firstPublication,
    });

    const secondPublication = await ensurePublication(second.agent, {
      name: "Second Writer",
    });
    await publishDocument(second.agent, {
      folio,
      html: "<p>Second</p>",
      brief: null,
      publication: secondPublication,
    });

    expect(second.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "site.standard.document" }),
    );
    expect([...idb.values.keys()]).toEqual(
      expect.arrayContaining([
        `atproto-publication:${encodeURIComponent(did)}`,
        `atproto-publication:${encodeURIComponent(secondDid)}`,
        `atproto-doc:${encodeURIComponent(did)}:${folio.id}`,
        `atproto-doc:${encodeURIComponent(secondDid)}:${folio.id}`,
      ]),
    );
  });
});
