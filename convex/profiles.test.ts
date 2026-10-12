/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { EXTRA_ALIAS_PRICE_MICROUSD } from "../src/utils/alias-policy";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    writer: t.withIdentity({ tokenIdentifier: "issuer|writer" }),
    other: t.withIdentity({ tokenIdentifier: "issuer|other" }),
  };
}
describeConvex("authenticated Twyne alias ownership", () => {
  test("requires authentication, persists ownership, and exposes it only to its account", async () => {
    const { t, writer, other } = setup();
    await expect(
      t.mutation(api.profiles.claimHandle, { handle: "my-alias" }),
    ).rejects.toThrow("Not signed in");
    await writer.mutation(api.profiles.claimHandle, { handle: "My Alias" });
    expect(
      (await writer.query(api.profiles.getMyHandle, {}))?.ownedAliases,
    ).toEqual(["my-alias"]);
    expect(await other.query(api.profiles.getMyHandle, {})).toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.query("handles").collect()))[0]?.userId,
    ).toBe("issuer|writer");
  });
  test("same-account retries are idempotent and do not exhaust new-claim quota", async () => {
    const { t, writer } = setup();
    expect(
      (await writer.mutation(api.profiles.claimHandle, { handle: "my-alias" }))
        .changed,
    ).toBe(true);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await writer.mutation(api.profiles.claimHandle, {
            handle: "my-alias",
          })
        ).changed,
      ).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(1);
  });
  test("a new alias cannot replace or release the included alias", async () => {
    const { writer, other } = setup();
    await writer.mutation(api.profiles.claimHandle, { handle: "my-alias" });
    await expect(
      writer.mutation(api.profiles.claimHandle, { handle: "second-alias" }),
    ).rejects.toThrow("included alias");
    await expect(
      other.mutation(api.profiles.claimHandle, { handle: "my-alias" }),
    ).rejects.toThrow("already taken");
    expect((await writer.query(api.profiles.getMyHandle, {}))?.handle).toBe(
      "my-alias",
    );
  });
  test("new aliases cannot shadow current routes while an existing legacy claim stays owned", async () => {
    const { t, writer, other } = setup();
    for (const handle of [
      "at",
      "desk",
      "house",
      "og",
      "privacy-ledger",
      "revisions",
      "writing-tools",
    ]) {
      await expect(
        writer.mutation(api.profiles.claimHandle, { handle }),
      ).rejects.toThrow();
    }
    await t.run((ctx) =>
      ctx.db.insert("handles", {
        userId: "issuer|writer",
        handle: "desk",
        claimedAt: 1,
        updatedAt: 1,
      }),
    );
    expect(
      await writer.mutation(api.profiles.claimHandle, { handle: "desk" }),
    ).toEqual({ handle: "desk", changed: false });
    expect(
      (await writer.query(api.profiles.getMyHandle, {}))?.ownedAliases,
    ).toEqual(["desk"]);
    await expect(
      other.mutation(api.profiles.claimHandle, { handle: "desk" }),
    ).rejects.toThrow("reserved");
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(1);
  });
  test("concurrent different standard claims by one account leave exactly one alias", async () => {
    const { t, writer } = setup();
    const results = await Promise.allSettled([
      writer.mutation(api.profiles.claimHandle, { handle: "first-alias" }),
      writer.mutation(api.profiles.claimHandle, { handle: "second-alias" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(1);
  });
  test("concurrent retries by one account preserve one row", async () => {
    const { t, writer } = setup();
    const results = await Promise.all([
      writer.mutation(api.profiles.claimHandle, { handle: "my-alias" }),
      writer.mutation(api.profiles.claimHandle, { handle: "my-alias" }),
    ]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(1);
  });
  test("concurrent claims by different owners cannot share an alias", async () => {
    const { t, writer, other } = setup();
    const results = await Promise.allSettled([
      writer.mutation(api.profiles.claimHandle, { handle: "shared-alias" }),
      other.mutation(api.profiles.claimHandle, { handle: "shared-alias" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(1);
  });
  test("preserves legacy multi-alias ownership and selects the oldest claim for the account view", async () => {
    // Vitest's edge runtime has a window shim; actual Convex has no browser window.
    vi.stubGlobal("window", undefined);
    const { t, writer } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("handles", {
        userId: "issuer|writer",
        handle: "later-alias",
        claimedAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("handles", {
        userId: "issuer|writer",
        handle: "first-alias",
        claimedAt: 1,
        updatedAt: 1,
      });
    });
    const profile = await writer.query(api.profiles.getMyHandle, {});
    expect(profile?.handle).toBe("first-alias");
    expect(profile?.ownedAliases).toEqual(["first-alias", "later-alias"]);
    await expect(
      writer.mutation(api.profiles.claimHandle, { handle: "third-alias" }),
    ).rejects.toThrow("included alias");
    await writer.mutation(api.profiles.updateProfile, {
      displayName: "Writer",
    });
    expect(
      (await t.query(api.profiles.getProfile, { handle: "first-alias" }))
        ?.displayName,
    ).toBe("Writer");
    expect(
      (await t.query(api.profiles.getProfile, { handle: "later-alias" }))
        ?.handle,
    ).toBe("later-alias");
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(2);
    await writer.mutation(api.published.publish, {
      folioId: "fixture",
      title: "Synthetic piece",
      content: "<p>Synthetic prose.</p>",
    });
    expect(
      (await t.run((ctx) => ctx.db.query("published").collect()))[0]
        ?.ownerHandle,
    ).toBe("first-alias");
    await t.run(async (ctx) => {
      const piece = await ctx.db.query("published").first();
      await ctx.db.patch(piece!._id, { ownerHandle: "later-alias" });
    });
    await writer.mutation(api.published.publish, {
      folioId: "fixture",
      title: "Synthetic piece",
      content: "<p>Updated synthetic prose.</p>",
    });
    expect(
      (await t.run((ctx) => ctx.db.query("published").collect()))[0]
        ?.ownerHandle,
    ).toBe("later-alias");
  });
  test("extra requests quote US$250 in wallet units and stay pending without granting ownership", async () => {
    const { t, writer, other } = setup();
    await writer.mutation(api.profiles.claimHandle, { handle: "my-alias" });
    const requests = await Promise.all([
      writer.mutation(api.profiles.requestAdditionalAlias, {
        handle: "extra-alias",
      }),
      writer.mutation(api.profiles.requestAdditionalAlias, {
        handle: "extra-alias",
      }),
    ]);
    expect(requests[0]?.requestId).toBe(requests[1]?.requestId);
    expect(requests[0]?.status).toBe("pending");
    expect(requests[0]?.priceMicrousd).toBe(250_000_000);
    expect(EXTRA_ALIAS_PRICE_MICROUSD / 1_000_000).toBe(250);
    expect(
      (await writer.query(api.profiles.getMyHandle, {}))
        ?.additionalAliasRequests,
    ).toEqual([
      {
        handle: "extra-alias",
        status: "pending",
        priceMicrousd: 250_000_000,
        currency: "USD",
      },
    ]);
    expect(await other.query(api.profiles.getMyHandle, {})).toBeNull();
    expect(
      await t.query(api.profiles.getProfile, { handle: "my-alias" }),
    ).not.toHaveProperty("additionalAliasRequests");
    expect(
      await t.run((ctx) => ctx.db.query("aliasRequests").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("handles").collect()),
    ).toHaveLength(1);
    // A pending request does not reserve the alias; approval must recheck it.
    expect(
      (
        await other.mutation(api.profiles.claimHandle, {
          handle: "extra-alias",
        })
      ).changed,
    ).toBe(true);
  });
  test("requests require an included alias and reject owned or taken names", async () => {
    const { t, writer, other } = setup();
    await expect(
      t.mutation(api.profiles.requestAdditionalAlias, {
        handle: "extra-alias",
      }),
    ).rejects.toThrow("Not signed in");
    await expect(
      writer.mutation(api.profiles.requestAdditionalAlias, {
        handle: "extra-alias",
      }),
    ).rejects.toThrow("included alias first");
    await writer.mutation(api.profiles.claimHandle, { handle: "my-alias" });
    await other.mutation(api.profiles.claimHandle, { handle: "other-alias" });
    await expect(
      writer.mutation(api.profiles.requestAdditionalAlias, {
        handle: "my-alias",
      }),
    ).rejects.toThrow("already own");
    await expect(
      writer.mutation(api.profiles.requestAdditionalAlias, {
        handle: "other-alias",
      }),
    ).rejects.toThrow("already taken");
  });
});
