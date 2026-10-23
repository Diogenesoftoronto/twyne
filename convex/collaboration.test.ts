/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const betterAuthTest = supportsViteModules
  ? (await import("@convex-dev/better-auth/test")).default
  : null;
const describeConvex = supportsViteModules ? describe : describe.skip;
const ownerId = "test-issuer|collaboration-owner";

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest?.register(t);
  return {
    t,
    owner: t.withIdentity({
      tokenIdentifier: ownerId,
      email: "owner@example.com",
    }),
  };
}

async function seedOwner(t: ReturnType<typeof convexTest>, lixId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("collaborators", {
      lixId,
      userId: ownerId,
      role: "owner",
      status: "accepted",
      invitedAt: 1,
      acceptedAt: 1,
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describeConvex("collaboration invitation delivery", () => {
  test("lists email-addressed invitations after the invitee signs in", async () => {
    const { t } = setup();
    const lixId = "pending-lix";
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["shared draft"]));
      await ctx.db.insert("sharedLixBlobs", {
        lixId,
        ownerId,
        folioId: "folio-1",
        folioName: "A shared draft",
        storageId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("collaborators", {
        lixId,
        userId: "invitee@example.com",
        role: "commenter",
        status: "pending",
        invitedBy: ownerId,
        invitedAt: 2,
      });
    });
    const invitee = t.withIdentity({
      tokenIdentifier: "test-issuer|invitee",
      email: "Invitee@Example.com",
    });

    expect(
      await invitee.query(api.collaboration.listPendingInvitations, {}),
    ).toEqual([
      {
        lixId,
        folioName: "A shared draft",
        role: "commenter",
        invitedAt: 2,
      },
    ]);

    expect(
      await invitee.mutation(api.collaboration.acceptInvitation, { lixId }),
    ).toEqual({ role: "commenter" });
    expect(
      await invitee.query(api.collaboration.listPendingInvitations, {}),
    ).toEqual([]);
    expect(await invitee.query(api.collaboration.listSharedWithMe, {})).toEqual(
      [
        {
          lixId,
          folioId: "folio-1",
          folioName: "A shared draft",
          role: "commenter",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    );
  });

  test("local development creates an invitation without claiming email delivery", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:5173");
    vi.stubEnv("RESEND_API_KEY", "");
    const { t, owner } = setup();
    await seedOwner(t, "local-lix");

    const result = await owner.action(api.collaboration.inviteCollaborator, {
      lixId: "local-lix",
      folioName: "Local draft",
      email: "editor@example.com",
      role: "editor",
    });

    expect(result).toEqual({
      alreadyInvited: false,
      role: "editor",
      emailDelivered: false,
    });
    const pending = await t.run((ctx) =>
      ctx.db
        .query("collaborators")
        .withIndex("by_lixId", (q) => q.eq("lixId", "local-lix"))
        .collect(),
    );
    expect(pending).toHaveLength(2);
    expect(pending.find((row) => row.status === "pending")?.userId).toBe(
      "editor@example.com",
    );
  });

  test("production configuration failure rolls the pending invitation back", async () => {
    vi.stubEnv("SITE_URL", "https://twyne.example");
    vi.stubEnv("RESEND_API_KEY", "");
    const { t, owner } = setup();
    await seedOwner(t, "production-lix");

    await expect(
      owner.action(api.collaboration.inviteCollaborator, {
        lixId: "production-lix",
        folioName: "Production draft",
        email: "editor@example.com",
        role: "commenter",
      }),
    ).rejects.toThrow("email delivery is not configured");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("collaborators")
        .withIndex("by_lixId", (q) => q.eq("lixId", "production-lix"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("owner");
  });
});

describeConvex("collaboration sharing and permissions", () => {
  async function seedShare(
    t: ReturnType<typeof convexTest>,
    lixId: string,
    folioId: string,
  ) {
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["blob"]));
      await ctx.db.insert("sharedLixBlobs", {
        lixId,
        ownerId,
        folioId,
        folioName: "Draft",
        storageId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await seedOwner(t, lixId);
  }

  test("a folio maps to one share and a used lixId cannot gain an owner", async () => {
    const { t } = setup();
    await seedShare(t, "lix-a", "folio-a");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["second"])),
    );

    expect(
      await t.mutation(internal.collaboration.createShareRecord, {
        lixId: "lix-b",
        ownerId,
        folioId: "folio-a",
        folioName: "Draft",
        storageId,
      }),
    ).toEqual({ created: false, lixId: "lix-a" });

    await expect(
      t.mutation(internal.collaboration.createShareRecord, {
        lixId: "lix-a",
        ownerId: "test-issuer|intruder",
        folioId: "folio-x",
        folioName: "Mine now",
        storageId,
      }),
    ).rejects.toThrow("already in use");

    const owners = await t.run((ctx) =>
      ctx.db
        .query("collaborators")
        .withIndex("by_lixId", (q) => q.eq("lixId", "lix-a"))
        .collect(),
    );
    expect(owners.map((row) => row.userId)).toEqual([ownerId]);
  });

  test("only the owner can invite, and a declined invite is reopened", async () => {
    const { t, owner } = setup();
    await seedShare(t, "lix-c", "folio-c");
    const stranger = t.withIdentity({
      tokenIdentifier: "test-issuer|stranger",
      email: "stranger@example.com",
    });

    await expect(
      t.mutation(internal.collaboration.createInvitation, {
        lixId: "lix-c",
        email: "x@example.com",
        role: "editor",
        invitedBy: "test-issuer|stranger",
      }),
    ).rejects.toThrow("Not a collaborator");

    const first = await t.mutation(internal.collaboration.createInvitation, {
      lixId: "lix-c",
      email: "Editor@Example.com",
      role: "editor",
      invitedBy: ownerId,
    });
    expect(first.alreadyInvited).toBe(false);

    const invitee = t.withIdentity({
      tokenIdentifier: "test-issuer|editor",
      email: "editor@example.com",
    });
    await invitee.mutation(api.collaboration.rejectInvitation, {
      lixId: "lix-c",
    });

    const again = await t.mutation(internal.collaboration.createInvitation, {
      lixId: "lix-c",
      email: "editor@example.com",
      role: "commenter",
      invitedBy: ownerId,
    });
    expect(again).toEqual({
      alreadyInvited: false,
      role: "commenter",
      invitationId: first.invitationId,
    });
    expect(
      await invitee.mutation(api.collaboration.acceptInvitation, {
        lixId: "lix-c",
      }),
    ).toEqual({ role: "commenter" });

    expect(
      await stranger.query(api.collaboration.getSharedLixMeta, {
        lixId: "lix-c",
      }),
    ).toBeNull();
    await expect(
      invitee.mutation(api.collaboration.updateRole, {
        lixId: "lix-c",
        userId: "test-issuer|editor",
        role: "editor",
      }),
    ).rejects.toThrow("Requires owner");
    expect(
      await owner.query(api.collaboration.getMyRole, { lixId: "lix-c" }),
    ).toEqual({ role: "owner" });
  });
});
