/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

const ownerAId = "test-issuer|integration-owner-a";
const ownerBId = "test-issuer|integration-owner-b";

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    ownerA: t.withIdentity({ tokenIdentifier: ownerAId }),
    ownerB: t.withIdentity({ tokenIdentifier: ownerBId }),
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

describeConvex("integration tokens", () => {
  test("returns a secret once and stores only its digest", async () => {
    const { t, ownerA, ownerB } = setup();
    const created = await ownerA.mutation(api.integrations.createToken, {
      name: "Claude Desktop",
    });

    expect(created.token).toMatch(/^twyne_pat_[a-f0-9]{64}$/);
    expect(await ownerA.query(api.integrations.listTokens, {})).toEqual([
      {
        id: created.id,
        name: "Claude Desktop",
        prefix: created.prefix,
        createdAt: created.createdAt,
      },
    ]);
    expect(await ownerB.query(api.integrations.listTokens, {})).toEqual([]);

    const stored = await t.run((ctx) =>
      ctx.db.get("integrationTokens", created.id),
    );
    expect(stored?.tokenHash).toBe(await sha256(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    await expect(
      t.query(internal.integrations.authenticate, {
        tokenHash: await sha256(created.token),
      }),
    ).resolves.toEqual({ userId: ownerAId });

    await expect(
      ownerB.mutation(api.integrations.revokeToken, { id: created.id }),
    ).resolves.toBe(false);
    await expect(
      ownerA.mutation(api.integrations.revokeToken, { id: created.id }),
    ).resolves.toBe(true);
  });
});

describeConvex("folio integration boundary", () => {
  test("creates an owner-scoped bundle and rejects stale updates", async () => {
    const { t } = setup();
    const created = await t.mutation(internal.integrations.putFolio, {
      userId: ownerAId,
      folio: { name: "A field guide", type: "draft" },
      html: "<p>First draft.</p>",
      brief: { answers: { audience: "gardeners" }, updatedAt: 1 },
    });

    expect(
      await t.query(internal.integrations.listFolios, { userId: ownerBId }),
    ).toEqual([]);
    const bundle = await t.query(internal.integrations.getFolio, {
      userId: ownerAId,
      folioId: created.id,
      include: [
        "content",
        "brief",
        "feedback",
        "rubric",
        "suggestions",
        "citations",
      ],
    });
    expect(bundle).toMatchObject({
      folio: { id: created.id, name: "A field guide", type: "draft" },
      html: "<p>First draft.</p>",
      brief: { answers: { audience: "gardeners" }, updatedAt: 1 },
      feedback: { notes: [], replies: [] },
      rubric: null,
      suggestions: [],
      citations: [],
    });

    await expect(
      t.mutation(internal.integrations.putFolio, {
        userId: ownerAId,
        folio: { id: created.id, name: "Stale title" },
        expectedUpdatedAt: created.updatedAt - 1,
      }),
    ).rejects.toThrow("changed since it was read");
  });

  test("upserts and searches folio-scoped citations", async () => {
    const { t } = setup();
    const folio = await t.mutation(internal.integrations.putFolio, {
      userId: ownerAId,
      folio: { name: "Marine notes" },
      html: "<p>Octopuses edit their own RNA.</p>",
    });
    await t.mutation(internal.integrations.putCitations, {
      userId: ownerAId,
      folioId: folio.id,
      entries: [
        {
          id: "rna-paper",
          title: "Extensive RNA editing in coleoid cephalopods",
          author: "Liscovitch-Brauer et al.",
          url: "https://example.test/rna",
        },
      ],
    });

    const citations = await t.query(internal.integrations.listCitations, {
      userId: ownerAId,
      folioId: folio.id,
      search: "coleoid",
    });
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      id: "rna-paper",
      folioId: folio.id,
    });

    const search = await t.query(internal.integrations.searchFolios, {
      userId: ownerAId,
      search: "octopuses",
      limit: 10,
    });
    expect(search).toHaveLength(1);
    expect(search[0]).toMatchObject({ folio: { id: folio.id } });
  });
});
