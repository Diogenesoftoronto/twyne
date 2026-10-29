import type { BrowserContext, Page } from "@playwright/test";

/**
 * An in-memory stand-in for the Convex deployment's sync functions, shared by
 * every page in one browser context, so several tabs can sync against the
 * same account without a backend.
 *
 * It behaves like Convex where it matters for performance: a mutation bumps
 * the account's revision and every live query is re-sent to every subscribed
 * tab, with its whole result. It counts what crosses the wire so tests can put
 * a budget on it.
 */
export interface FakeSyncServer {
  /** Bytes sent to tabs by live queries (what a subscription re-sends). */
  liveBytes(): Promise<number>;
  /** Bytes returned by one-off queries (snapshots fetched on demand). */
  fetchedBytes: number;
  /** Whole-account snapshots fetched, per attached page, in attach order. */
  snapshotFetches: number[];
  pushes: number;
  revision(): number;
  /** Connect a page that has already loaded the editor. */
  attach(page: Page, userId?: string): Promise<void>;
}

interface Snapshot {
  syncRevision: number;
  folios: Array<Record<string, unknown>>;
  folioContent: Array<{ folioId: string; html: string; updatedAt: number }>;
  [key: string]: unknown;
}

export async function startFakeSyncServer(
  context: BrowserContext,
): Promise<FakeSyncServer> {
  const snapshot: Snapshot = {
    syncRevision: 0,
    briefs: [],
    legacyBrief: null,
    legacyBriefUpdatedAt: 0,
    folios: [],
    foliosUpdatedAt: 0,
    folioContent: [],
    customPersonas: null,
    customPersonasUpdatedAt: 0,
    personaNotes: [],
    personaReplies: [],
    rubricResults: [],
    bibliography: [],
    bibliographyUpdatedAt: 0,
  };
  const pages: Page[] = [];
  const server: FakeSyncServer = {
    fetchedBytes: 0,
    snapshotFetches: [],
    pushes: 0,
    revision: () => snapshot.syncRevision,
    async liveBytes() {
      const counts = await Promise.all(
        pages.map((page) =>
          page
            .evaluate(
              () =>
                (window as unknown as { __syncLiveBytes?: number })
                  .__syncLiveBytes ?? 0,
            )
            .catch(() => 0),
        ),
      );
      return counts.reduce((sum, n) => sum + n, 0);
    },
    async attach(page, userId = "sync-test-user") {
      pages.push(page);
      server.snapshotFetches.push(0);
      await page.evaluate(async (account) => {
        const path = "/src/utils/convex-sync.ts";
        const sync = await import(/* @vite-ignore */ path);
        const convexServer = "/node_modules/.vite/deps/convex_server.js";
        const { getFunctionName } = await import(
          /* @vite-ignore */ convexServer
        );
        const name = (ref: unknown) =>
          typeof ref === "string" ? ref : (getFunctionName(ref) as string);
        const target = window as unknown as {
          __syncLiveBytes: number;
          __syncDeliver: (wire: string, revision: number) => void;
          __syncCall: (
            kind: string,
            fn: string,
            args: string,
          ) => Promise<string>;
          __syncStatus: () => { kind: string };
        };
        const subscriptions: Array<{ fn: string; cb: (v: unknown) => void }> =
          [];
        target.__syncLiveBytes = 0;
        target.__syncDeliver = (wire, revision) => {
          for (const { fn, cb } of subscriptions) {
            if (fn === "sync:syncRevision") {
              target.__syncLiveBytes += String(revision).length;
              cb(revision);
            } else if (fn === "sync:pullAll") {
              target.__syncLiveBytes += wire.length;
              cb(JSON.parse(wire));
            }
          }
        };
        target.__syncStatus = () => sync.getSyncStatus();
        sync.setConvexSyncContext(
          {
            query: async (ref: unknown) =>
              JSON.parse(await target.__syncCall("query", name(ref), "{}")),
            mutation: async (ref: unknown, args: unknown) =>
              JSON.parse(
                await target.__syncCall(
                  "mutation",
                  name(ref),
                  JSON.stringify(args ?? {}),
                ),
              ),
            onUpdate: (
              ref: unknown,
              _args: unknown,
              cb: (v: unknown) => void,
            ) => {
              const entry = { fn: name(ref), cb };
              subscriptions.push(entry);
              return () =>
                subscriptions.splice(subscriptions.indexOf(entry), 1);
            },
          },
          account,
        );
      }, userId);
    },
  };

  const broadcast = () => {
    const wire = JSON.stringify(snapshot);
    for (const page of pages)
      void page
        .evaluate(
          ({ wire, revision }) =>
            (
              window as unknown as {
                __syncDeliver?: (wire: string, revision: number) => void;
              }
            ).__syncDeliver?.(wire, revision),
          { wire, revision: snapshot.syncRevision },
        )
        .catch(() => undefined);
  };

  await context.exposeBinding(
    "__syncCall",
    async (source, kind: string, fn: string, argsJson: string) => {
      if (kind === "query") {
        if (fn === "sync:pullAll") {
          const index = pages.indexOf(source.page);
          if (index >= 0) server.snapshotFetches[index]!++;
        }
        const wire =
          fn === "sync:syncRevision"
            ? String(snapshot.syncRevision)
            : fn === "sync:pullAll"
              ? JSON.stringify(snapshot)
              : "null";
        server.fetchedBytes += wire.length;
        return wire;
      }
      if (fn !== "sync:pushAll") return "null";
      const args = JSON.parse(argsJson) as {
        folios?: Snapshot["folios"];
        folioContent?: Array<{ folioId: string; html: string }>;
      };
      server.pushes++;
      for (const row of args.folioContent ?? []) {
        const next = { ...row, updatedAt: Date.now() };
        const index = snapshot.folioContent.findIndex(
          (existing) => existing.folioId === row.folioId,
        );
        if (index >= 0) snapshot.folioContent[index] = next;
        else snapshot.folioContent.push(next);
      }
      if (args.folios) {
        snapshot.folios = args.folios;
        snapshot.foliosUpdatedAt = Date.now();
      }
      snapshot.syncRevision++;
      setTimeout(broadcast, 25);
      return JSON.stringify({ ok: true, revision: snapshot.syncRevision });
    },
  );
  return server;
}
