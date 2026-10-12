/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  deskAcknowledgeRef,
  deskEnabledRef,
  deskPrepareRef,
  deskStatusRef,
} from "../src/utils/public-desk-sync";
const supported = typeof import.meta.glob === "function";
const modules = supported ? import.meta.glob("./**/*.ts") : {};
const suite = supported ? describe : describe.skip;
async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "writer",
    tokenIdentifier: "issuer|writer",
  });
  const other = t.withIdentity({
    subject: "other",
    tokenIdentifier: "issuer|other",
  });
  await owner.mutation(api.profiles.claimHandle, { handle: "writer" });
  await t.run((ctx) =>
    ctx.db.insert("providerIdentities", {
      productSubject: "writer",
      did: "did:plc:writer",
      verificationMethod: "notorganic_pkce",
      sessionVersion: 1,
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return { t, owner, other };
}
suite("public desk consent and identity", () => {
  test("requires authentication, explicit opt-in, and server-verified DID", async () => {
    const { t, owner, other } = await setup();
    await expect(t.mutation(deskEnabledRef, { enabled: true })).rejects.toThrow(
      "Not signed in",
    );
    expect(await owner.mutation(deskPrepareRef, {})).toBeNull();
    await other.mutation(api.profiles.claimHandle, { handle: "other-writer" });
    await expect(
      other.mutation(deskEnabledRef, { enabled: true }),
    ).rejects.toThrow("verify your PDS");
    await owner.mutation(deskEnabledRef, { enabled: true });
    const job = await owner.mutation(deskPrepareRef, {});
    expect(job?.did).toBe("did:plc:writer");
    expect(JSON.parse(job!.recordJson!).stats).toEqual({});
    expect(await other.mutation(deskPrepareRef, {})).toBeNull();
  });
  test("projects only opted-in totals and never draft content, titles, or identifiers", async () => {
    const { owner, t } = await setup();
    await owner.mutation(api.profiles.updatePublicStats, {
      writingHeatmap: false,
      daysWritten30: true,
      streak: "off",
      publicPieceCount: false,
      folioCount: false,
    });
    await t.run((ctx) =>
      ctx.db.insert("writingActivity", {
        userId: "issuer|writer",
        day: new Date().toISOString().slice(0, 10),
        count: 42,
        updatedAt: Date.now(),
      }),
    );
    await owner.mutation(deskEnabledRef, { enabled: true });
    const job = await owner.mutation(deskPrepareRef, {});
    expect(JSON.parse(job!.recordJson!).stats).toEqual({ daysWritten30: 1 });
    expect(Object.keys(JSON.parse(job!.recordJson!))).toEqual([
      "$type",
      "version",
      "handle",
      "url",
      "updatedAt",
      "stats",
    ]);
    expect(JSON.stringify(job)).not.toContain("issuer|writer");
  });
  test("stable retries, stale completion rejection, and durable removal", async () => {
    const { owner } = await setup();
    await owner.mutation(deskEnabledRef, { enabled: true });
    const first = (await owner.mutation(deskPrepareRef, {}))!;
    expect(await owner.mutation(deskPrepareRef, {})).toEqual(first);
    await owner.mutation(deskEnabledRef, { enabled: true });
    expect(await owner.mutation(deskPrepareRef, {})).toEqual(first);
    await owner.mutation(deskAcknowledgeRef, { revision: first.revision });
    expect((await owner.query(deskStatusRef, {})).pending).toBe(false);
    await owner.mutation(deskEnabledRef, { enabled: false });
    expect(
      await owner.mutation(deskAcknowledgeRef, { revision: first.revision }),
    ).toBe(false);
    const removal = (await owner.mutation(deskPrepareRef, {}))!;
    expect(removal.recordJson).toBeNull();
    expect(removal.pending).toBe(true);
    expect(removal.did).toBe(first.did);
    await owner.mutation(deskEnabledRef, { enabled: false });
    expect(await owner.mutation(deskPrepareRef, {})).toEqual(removal);
    await owner.mutation(deskAcknowledgeRef, { revision: removal.revision });
    expect((await owner.query(deskStatusRef, {})).pending).toBe(false);
  });
  test("stat consent change invalidates old acknowledgements and snapshots", async () => {
    const { owner } = await setup();
    await owner.mutation(deskEnabledRef, { enabled: true });
    const first = (await owner.mutation(deskPrepareRef, {}))!;
    await owner.mutation(api.profiles.updatePublicStats, {
      writingHeatmap: false,
      daysWritten30: false,
      streak: "off",
      publicPieceCount: true,
      folioCount: false,
    });
    expect(
      await owner.mutation(deskAcknowledgeRef, { revision: first.revision }),
    ).toBe(false);
    const next = (await owner.mutation(deskPrepareRef, {}))!;
    expect(JSON.parse(next.recordJson!).stats).toEqual({
      publicPieceCount: 0,
      publicPieceCountTruncated: false,
    });
    expect(next.revision).toBeGreaterThan(first.revision);
  });
  test("a changed linked DID cannot republish until the old desk is removed, but can request removal", async () => {
    const { owner, t } = await setup();
    await owner.mutation(deskEnabledRef, { enabled: true });
    await owner.mutation(deskPrepareRef, {});
    await t.run(async (ctx) => {
      const link = await ctx.db.query("providerIdentities").first();
      await ctx.db.patch(link!._id, { did: "did:plc:new" });
    });
    await expect(
      owner.mutation(deskEnabledRef, { enabled: true }),
    ).rejects.toThrow("previous PDS");
    await owner.mutation(deskEnabledRef, { enabled: false });
    const removal = (await owner.mutation(deskPrepareRef, {}))!;
    expect(removal).toMatchObject({
      did: "did:plc:writer",
      recordJson: null,
      pending: true,
    });
    await owner.mutation(deskAcknowledgeRef, { revision: removal.revision });
    await owner.mutation(deskEnabledRef, { enabled: true });
    expect((await owner.mutation(deskPrepareRef, {}))?.did).toBe("did:plc:new");
  });
  test("missing verified link fails closed to removal from the old DID", async () => {
    const { owner, t } = await setup();
    await owner.mutation(deskEnabledRef, { enabled: true });
    await owner.mutation(deskPrepareRef, {});
    await t.run(async (ctx) => {
      const link = await ctx.db.query("providerIdentities").first();
      await ctx.db.delete(link!._id);
    });
    const job = await owner.mutation(deskPrepareRef, {});
    expect(job).toMatchObject({
      did: "did:plc:writer",
      recordJson: null,
      pending: true,
    });
  });
});
