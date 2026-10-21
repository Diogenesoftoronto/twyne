/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;
describeConvex("account preferences", () => {
  test("preferences require identity, isolate accounts, and reject stale writes", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ tokenIdentifier: "issuer|alice" });
    const bob = t.withIdentity({ tokenIdentifier: "issuer|bob" });
    await expect(t.query(api.preferences.list, {})).rejects.toThrow(
      "Not signed in",
    );
    const args = {
      kind: "appearance" as const,
      json: '{"preset":"nightpress"}',
      expectedRevision: 0,
    };
    await expect(t.mutation(api.preferences.put, args)).rejects.toThrow(
      "Not signed in",
    );
    expect(await alice.mutation(api.preferences.put, args)).toEqual({
      accepted: true,
      revision: 1,
    });
    expect(await bob.query(api.preferences.list, {})).toEqual([]);
    expect(
      await alice.mutation(api.preferences.put, {
        ...args,
        json: '{"preset":"editorial"}',
      }),
    ).toEqual({ accepted: false, revision: 1 });
    expect(
      JSON.parse((await alice.query(api.preferences.list, {}))[0].json),
    ).toEqual({ preset: "nightpress" });
  });
  test("legacy room and appearance are readable before migration", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ tokenIdentifier: "issuer|alice" });
    await t.run(async (ctx) => {
      await ctx.db.insert("appearance", {
        userId: "issuer|alice",
        preset: "nightpress",
        updatedAt: 1,
      });
      await ctx.db.insert("roomSettings", {
        userId: "issuer|alice",
        settings: {
          level: "sentence",
          maxProposals: 6,
          maxLargeEdits: 2,
          personaScope: [],
        },
        updatedAt: 1,
      });
    });
    const rows = await alice.query(api.preferences.list, {});
    expect(rows.map((row) => row.kind).sort()).toEqual(["appearance", "room"]);
    expect(rows.every((row) => row.revision === 0)).toBe(true);
  });
});
