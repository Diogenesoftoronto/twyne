"use node";

/**
 * Lix server protocol relay — the bridge between browsers running Lix sync
 * and the shared Lix blobs stored in Convex file storage.
 *
 * When a Pro user shares a folio, its Lix blob is promoted to a server-hosted
 * instance (see convex/collaboration.ts `shareFolio`). The owner and invited
 * collaborators then open it with `lix_sync: true` and `initSyncProcess`
 * polls these endpoints every ~1-2 s, pushing local changes and pulling
 * remote ones. Lix's vector-clock + `mergeTheirState` engine handles the
 * merge.
 *
 * Each request lifecycle:
 *   1. Read the `storageId` from the `sharedLixBlobs` table (internal query).
 *   2. Download the blob via `ctx.storage.get(storageId)` (action-only API).
 *   3. `openLixInMemory` → run the server-protocol route → persist the
 *      modified blob via `ctx.storage.store()` → save the new `storageId`
 *      via an internal mutation (and delete the old file).
 *
 * Blobs live in Convex file storage (not `v.bytes()` in a table row) so they
 * are not subject to the typical row-size limits — a long document's Lix
 * state can be tens of KB to several hundred KB.
 */
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  openLixInMemory,
  toBlob,
  createServerProtocolHandler,
  type Lix,
} from "@lix-js/sdk";

/* ── The action: runs createServerProtocolHandler with ctx.storage ── */

export const handleLspRequest = internalAction({
  args: {
    path: v.string(),
    method: v.string(),
    body: v.optional(v.bytes()),
    lixId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Authorization: check the caller's role on the shared document before
    // letting the Lix SDK touch the blob.
    const role = await ctx.runQuery(
      internal.collaboration.getCollaboratorRole,
      {
        lixId: args.lixId,
        userId: args.userId,
      },
    );
    if (!role) {
      return {
        status: 403,
        headers: { "Content-Type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({ error: "Forbidden" })),
      };
    }
    // Commenters may download (get/pull) but may not push changes.
    const canWrite = role === "owner" || role === "editor";
    if (
      (args.path === "/lsp/push-v1" || args.path === "/lsp/new-v1") &&
      !canWrite
    ) {
      return {
        status: 403,
        headers: { "Content-Type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({ error: "Forbidden" })),
      };
    }

    // Serialize pushes per lixId so two concurrent push-v1 requests don't
    // both read the same base blob and clobber each other on write.
    const needsLock = args.path === "/lsp/push-v1";
    if (needsLock) {
      const acquired = await ctx.runMutation(internal.sharedLix.acquireLock, {
        lixId: args.lixId,
      });
      if (!acquired) {
        return {
          status: 409,
          headers: { "Content-Type": "application/json" },
          body: new TextEncoder().encode(
            JSON.stringify({ error: "Conflict: another push is in progress" }),
          ),
        };
      }
    }

    try {
      // Build a minimal LspEnvironment backed by Convex file storage.
      // The environment is request-scoped: openLix caches the in-memory state
      // for the duration of the handler, then closeLix persists it.
      const openInstances = new Map<
        string,
        { lix: Lix; id: string; storageId: string }
      >();

      const environment = {
        get: async () => undefined,
        set: async () => {},
        has: async () => false,
        delete: async () => {},

        hasLix: async ({ id }: { id: string }) => {
          return await ctx.runQuery(internal.sharedLix.has, { lixId: id });
        },

        getLix: async ({ id }: { id: string }) => {
          const row = await ctx.runQuery(internal.sharedLix.get, {
            lixId: id,
          });
          if (!row?.storageId) return undefined;
          const blob = await ctx.storage.get(row.storageId);
          return blob ?? undefined;
        },

        setLix: async ({
          id,
          blob,
          ownerId,
          folioId,
          folioName,
        }: {
          id: string;
          blob: Blob;
          ownerId?: string;
          folioId?: string;
          folioName?: string;
        }) => {
          const storageId = await ctx.storage.store(blob);
          if (ownerId && folioId && folioName) {
            await ctx.runMutation(internal.sharedLix.set, {
              lixId: id,
              ownerId,
              folioId,
              folioName,
              storageId,
            });
          } else {
            // Update existing row's storageId; delete the old file.
            const oldStorageId = await ctx.runMutation(
              internal.sharedLix.updateStorageId,
              { lixId: id, storageId },
            );
            if (oldStorageId && oldStorageId !== storageId) {
              try {
                await ctx.storage.delete(oldStorageId);
              } catch {
                // Best-effort cleanup; the old file will be orphaned but
                // that's not a correctness issue.
              }
            }
          }
        },

        openLix: async ({ id }: { id: string }) => {
          const blob = await environment.getLix({ id });
          if (!blob) throw new Error(`Lix ${id} not found`);
          const lix = await openLixInMemory({
            blob,
            keyValues: [
              { key: "lix_sync" as any, value: "false" as any } as any,
            ],
          });
          const row = await ctx.runQuery(internal.sharedLix.get, {
            lixId: id,
          });
          const storageId = row?.storageId ?? "";
          const connectionId = `${id}-${Date.now()}-${Math.random()}`;
          openInstances.set(connectionId, { lix, id, storageId });
          return { lix, id, connectionId };
        },

        closeLix: async ({
          id,
          connectionId,
        }: {
          id: string;
          connectionId: string;
        }) => {
          const entry = openInstances.get(connectionId);
          if (entry) {
            const blob = await toBlob({ lix: entry.lix });
            const newStorageId = await ctx.storage.store(blob);
            const oldStorageId = await ctx.runMutation(
              internal.sharedLix.updateStorageId,
              { lixId: id, storageId: newStorageId },
            );
            if (oldStorageId && oldStorageId !== newStorageId) {
              try {
                await ctx.storage.delete(oldStorageId);
              } catch {}
            }
          }
          openInstances.delete(connectionId);
        },
      };

      const handler = await createServerProtocolHandler({
        environment: environment as any,
      });

      // Reconstruct a Request from the forwarded path + body.
      const url = `https://convex.local${args.path}`;
      const init: RequestInit = {
        method: args.method,
      };
      if (args.body && args.body.byteLength > 0) {
        init.body = new Blob([args.body]);
      }
      const request = new Request(url, init);

      const response = await handler(request);

      const headers: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        headers[key] = val;
      });

      const respBody = response.body
        ? new Uint8Array(await response.arrayBuffer())
        : null;

      return {
        status: response.status,
        headers,
        body: respBody,
      };
    } finally {
      if (needsLock) {
        await ctx.runMutation(internal.sharedLix.releaseLock, {
          lixId: args.lixId,
        });
      }
    }
  },
});
