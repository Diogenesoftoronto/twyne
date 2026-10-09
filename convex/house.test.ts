/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { HouseState } from "../src/utils/house-model";
const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;
const snapshot: HouseState = {
  house: { name: "Writer", dossier: { tone: "Plain" }, updatedAt: 2 },
  collections: [
    {
      id: "series",
      name: "Series",
      description: "Essays",
      dossier: { audience: "Readers" },
      folioIds: ["f1", "f2"],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  charter: [
    {
      id: "standard",
      scope: "house",
      ownerRef: "house",
      text: "Cite sources",
      severity: "must",
      kind: "citation",
      order: 0,
      updatedAt: 2,
    },
  ],
  ledger: [
    {
      id: "entry",
      at: 2,
      layer: "house",
      ownerRef: "house",
      field: "tone",
      from: "",
      to: "Plain",
      source: "manual",
    },
  ],
};
function setup() {
  const t = convexTest(schema, modules);
  return { t, writer: t.withIdentity({ tokenIdentifier: "issuer|a" }) };
}
describeConvex("House snapshots", () => {
  test("folio Charter occurrence exceptions round-trip without granting another writer access", async () => {
    const { writer, t } = setup();
    const state = {
      ...snapshot,
      charter: [
        {
          ...snapshot.charter[0],
          scope: "folio" as const,
          ownerRef: "f1",
          occurrenceException: {
            version: 1 as const,
            findingId: "stance",
            signatures: [{ key: "exact contextual occurrence", count: 1 }],
          },
        },
      ],
    };
    await writer.mutation(api.house.putHouseSnapshot, state);
    expect(await writer.query(api.house.getHouse, {})).toEqual(state);
    const other = t.withIdentity({ tokenIdentifier: "issuer|other" });
    expect(await other.query(api.house.getHouse, {})).toBeNull();
    await expect(
      writer.mutation(api.house.putHouseSnapshot, {
        ...state,
        charter: [{ ...state.charter[0], scope: "house", ownerRef: "house" }],
      }),
    ).rejects.toThrow("bounded folio");
    await expect(
      writer.mutation(api.house.putHouseSnapshot, {
        ...state,
        charter: [
          {
            ...state.charter[0],
            occurrenceException: {
              ...state.charter[0].occurrenceException,
              signatures: [{ key: "exact", count: -1 }],
            },
          },
        ],
      }),
    ).rejects.toThrow("bounded folio");
  });

  test("round-trips a full snapshot", async () => {
    const { writer } = setup();
    expect(await writer.query(api.house.getHouse, {})).toBeNull();
    await writer.mutation(api.house.putHouseSnapshot, snapshot);
    expect(await writer.query(api.house.getHouse, {})).toEqual(snapshot);
  });
  test("replacement deletes missing collections, members and charter but retains ledger", async () => {
    const { writer, t } = setup();
    await writer.mutation(api.house.putHouseSnapshot, snapshot);
    await writer.mutation(api.house.putHouseSnapshot, {
      ...snapshot,
      collections: [],
      charter: [],
      ledger: [],
    });
    expect(await writer.query(api.house.getHouse, {})).toEqual({
      ...snapshot,
      collections: [],
      charter: [],
    });
    expect(
      await t.run((ctx) => ctx.db.query("collectionMembers").collect()),
    ).toEqual([]);
  });
  test("stale uploads cannot resurrect withdrawn standards or collections", async () => {
    const { writer } = setup();
    await writer.mutation(api.house.putHouseSnapshot, snapshot);
    const withdrawn = {
      ...snapshot,
      house: { ...snapshot.house, updatedAt: 3 },
      collections: [],
      charter: [],
    };
    await writer.mutation(api.house.putHouseSnapshot, withdrawn);
    await writer.mutation(api.house.putHouseSnapshot, snapshot);
    expect(await writer.query(api.house.getHouse, {})).toEqual(withdrawn);
  });
  test("a folio cannot belong to two collections", async () => {
    const { writer } = setup();
    await expect(
      writer.mutation(api.house.putHouseSnapshot, {
        ...snapshot,
        collections: [
          ...snapshot.collections,
          { ...snapshot.collections[0], id: "other" },
        ],
      }),
    ).rejects.toThrow("Duplicate id");
  });
  test("ledger insertion is idempotent and pagination is newest first", async () => {
    const { writer } = setup();
    await writer.mutation(api.house.putHouseSnapshot, snapshot);
    await writer.mutation(api.house.putHouseSnapshot, {
      ...snapshot,
      ledger: [
        { ...snapshot.ledger[0], to: "Ignored" },
        { ...snapshot.ledger[0], id: "new", at: 3 },
      ],
    });
    const first = await writer.query(api.house.listLedger, {
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(first.page[0].id).toBe("new");
    const second = await writer.query(api.house.listLedger, {
      paginationOpts: { cursor: first.continueCursor, numItems: 1 },
    });
    expect(second.page).toEqual(snapshot.ledger);
    expect((await writer.query(api.house.getHouse, {}))?.ledger).toHaveLength(
      2,
    );
  });
  test("signed-out access throws for every endpoint", async () => {
    const { t } = setup();
    await expect(t.query(api.house.getHouse, {})).rejects.toThrow(
      "Not signed in",
    );
    await expect(
      t.mutation(api.house.putHouseSnapshot, snapshot),
    ).rejects.toThrow("Not signed in");
    await expect(
      t.query(api.house.listLedger, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow("Not signed in");
  });
  test("another writer cannot read or replace the first writer's data", async () => {
    const { writer, t } = setup();
    await writer.mutation(api.house.putHouseSnapshot, snapshot);
    const b = t.withIdentity({ tokenIdentifier: "issuer|b" });
    expect(await b.query(api.house.getHouse, {})).toBeNull();
    expect(
      (
        await b.query(api.house.listLedger, {
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page,
    ).toEqual([]);
    await b.mutation(api.house.putHouseSnapshot, {
      ...snapshot,
      house: { ...snapshot.house, name: "B" },
    });
    expect(await writer.query(api.house.getHouse, {})).toEqual(snapshot);
  });
  test("rejects oversized strings and ledger batches atomically", async () => {
    const { writer } = setup();
    await expect(
      writer.mutation(api.house.putHouseSnapshot, {
        ...snapshot,
        house: { ...snapshot.house, name: "x".repeat(16001) },
      }),
    ).rejects.toThrow("String exceeds");
    await expect(
      writer.mutation(api.house.putHouseSnapshot, {
        ...snapshot,
        ledger: Array.from({ length: 201 }, (_, i) => ({
          ...snapshot.ledger[0],
          id: String(i),
        })),
      }),
    ).rejects.toThrow("200 entries");
    expect(await writer.query(api.house.getHouse, {})).toBeNull();
  });
});
