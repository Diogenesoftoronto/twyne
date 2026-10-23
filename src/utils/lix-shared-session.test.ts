// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ConvexClient } from "convex/browser";
import type { FolioContentSnapshot, SharedLixSnapshot } from "./idb";
import type { SharedRecovery } from "./shared-reconciliation";

// These real SQLite/Blob checks require Vitest's jsdom environment and
// per-file module isolation; do not install their mocks in Bun's shared registry.
const supportsViteModules = typeof import.meta.glob === "function";
const describeBrowser = supportsViteModules ? describe : describe.skip;
const storage = {
  shared: new Map<string, SharedLixSnapshot>(),
  drafts: new Map<string, FolioContentSnapshot>(),
  privateBlob: null as Blob | null,
  remoteSaves: 0,
  recoveries: [] as SharedRecovery[],
  failRecovery: false,
};

if (supportsViteModules)
  vi.doMock("./idb", () => ({
    loadFolioContentSnapshotFromIdb: async (id: string) =>
      storage.drafts.get(id) ?? null,
    loadLixBlobFromIdb: async () => null,
    saveSharedRecoveryToIdb: async (recovery: SharedRecovery) => {
      if (storage.failRecovery) throw new Error("Recovery storage full");
      storage.recoveries.push(recovery);
    },
    saveLixBlobToIdb: async (blob: Blob) => {
      storage.privateBlob = blob;
    },
    loadSharedLixSnapshotFromIdb: async (id: string) =>
      storage.shared.get(id) ?? null,
    saveSharedLixSnapshotToIdb: async (
      id: string,
      snapshot: SharedLixSnapshot,
    ) => {
      storage.shared.set(id, {
        ...snapshot,
        blob: await readableBlob(snapshot.blob),
      });
    },
    saveFolioTypstToIdb: async (
      folioId: string,
      typstSource: string,
      html: string,
    ) => {
      storage.drafts.set(folioId, {
        folioId,
        typstSource,
        html,
        updatedAt: Date.now(),
      });
      storage.remoteSaves += 1;
    },
  }));

import { closeLix, openLixInMemory } from "@lix-js/sdk";
import { plugin as jsonPlugin } from "@lix-js/plugin-json";
const {
  closeSharedLix,
  enableSharedSync,
  getDraftBlocks,
  getLix,
  openShareableLix,
  openCachedSharedLix,
  persistToIdb,
  sharedSessionLixId,
  sharedLixBlob,
  syncDraftToLix,
  writeSharedDraft,
} = await import("./lix");
const { joinSharedLix, stopWatchingRemote, watchRemoteChanges } = await import(
  "./collaboration"
);

async function readableBlob(blob: Blob): Promise<Blob> {
  // jsdom's Blob lacks arrayBuffer(); read the bytes through FileReader.
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return new NodeBlob([new Uint8Array(bytes)]) as unknown as Blob;
}

async function keysIn(blob: Blob): Promise<string[]> {
  const lix = await openLixInMemory({
    blob: await readableBlob(blob),
    providePlugins: [jsonPlugin as unknown as any],
  });
  try {
    const rows = await lix.db.selectFrom("key_value").select("key").execute();
    const files = await lix.db.selectFrom("file").select("path").execute();
    return [...rows.map((r) => r.key), ...files.map((f) => f.path)];
  } finally {
    await closeLix({ lix });
  }
}

beforeEach(() => {
  storage.shared.clear();
  storage.drafts.clear();
  storage.remoteSaves = 0;
  storage.recoveries = [];
  storage.failRecovery = false;
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://sharing-fixture.invalid");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("External network disabled")),
  );
});

afterEach(async () => {
  stopWatchingRemote();
  await closeSharedLix();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function saveDraft(folioId: string, text: string) {
  const draft = {
    folioId,
    html: `<p>${text}</p>`,
    typstSource: text,
    updatedAt: Date.now(),
  };
  storage.drafts.set(folioId, draft);
  return draft;
}

function ownerClient(folioId: string) {
  return {
    query: vi.fn().mockResolvedValue({ folioId, role: "owner" }),
  } as unknown as ConvexClient;
}

describeBrowser("shared session", () => {
  test("a share holds only the shared folio, and the local store is untouched", async () => {
    await syncDraftToLix("private-folio", '<p data-id="p1">secret</p>');
    // Seeded directly: jsdom's TextEncoder yields a cross-realm Uint8Array
    // that SQLite refuses to bind.
    await (
      await getLix()
    ).db
      .insertInto("file")
      .values({ path: "/bibliography.json", data: Uint8Array.from([91, 93]) })
      .execute();

    await openShareableLix("shared-folio");
    await syncDraftToLix("shared-folio", '<p data-id="s1">hello</p>');
    const keys = await keysIn(await sharedLixBlob());

    expect(keys.some((k) => k.includes("shared-folio"))).toBe(true);
    expect(keys.some((k) => k.includes("private-folio"))).toBe(false);
    expect(keys).not.toContain("/bibliography.json");

    const local = await getLix();
    const localShared = await local.db
      .selectFrom("key_value")
      .where("key", "like", "tw:draft:shared-folio:%")
      .select("key")
      .execute();
    expect(localShared).toEqual([]);
    expect((await getDraftBlocks("private-folio"))[0]?.html).toContain(
      "secret",
    );

    await closeSharedLix();
  });

  test("reopening reviews unsent changes before replacing the server baseline", async () => {
    const folioId = "offline-shared-folio";
    const baseline = saveDraft(folioId, "Server baseline");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(folioId, baseline.html);
    await enableSharedSync("https://sharing-fixture.invalid");
    const serverBlob = await readableBlob(await sharedLixBlob());
    const edited = saveDraft(folioId, "Unsent offline edit");
    await syncDraftToLix(folioId, edited.html);
    await persistToIdb();
    await closeSharedLix();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => serverBlob,
    } as Response);
    const review = vi.fn(async (request) => {
      expect(sharedSessionLixId()).toBeNull();
      expect(request.shared.html).toBe(baseline.html);
      expect(storage.recoveries.at(-1)?.local.html).toBe(edited.html);
      return request.local;
    });
    const joined = await joinSharedLix(ownerClient(folioId), lixId, { review });
    expect(joined?.html).toBe(edited.html);
    expect(review).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2); // Initial comparison and stale-copy check.
    let html = edited.html;
    const editor = {
      getHTML: () => html,
      commands: {
        setContent: (value: string) => {
          html = value;
        },
      },
    };
    watchRemoteChanges(editor as never, folioId);
    await vi.waitFor(() => expect(storage.remoteSaves).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(storage.drafts.get(folioId)?.html).toBe(edited.html),
    );
    expect(html).toBe(edited.html);
    const localKeys = await keysIn(storage.privateBlob!);
    expect(localKeys.some((key) => key.includes(folioId))).toBe(false);
  });

  test("recovers local edits saved before the shared mirror debounce ran", async () => {
    const folioId = "tail-shared-folio";
    const baseline = saveDraft(folioId, "Checkpoint");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(folioId, baseline.html);
    await enableSharedSync("https://sharing-fixture.invalid");
    const serverBlob = await readableBlob(await sharedLixBlob());
    const edited = saveDraft(folioId, "Typed just before leaving");
    // Close before syncDraftToLix sees this edit. Closing must not advance
    // the checkpoint past the content actually stored in the shared blob.
    await closeSharedLix();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => serverBlob,
    } as Response);
    expect(
      (
        await joinSharedLix(ownerClient(folioId), lixId, {
          review: async (request) => request.local,
        })
      )?.html,
    ).toBe(edited.html);
  });

  test("an unchanged old local snapshot cannot roll back a newer cached remote document", async () => {
    const folioId = "remote-ahead-folio";
    saveDraft(folioId, "Old local snapshot");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(
      folioId,
      "<p>New remote manuscript</p>",
      "New remote manuscript",
    );
    await enableSharedSync("https://sharing-fixture.invalid");
    await closeSharedLix();
    const cached = await openCachedSharedLix(lixId, folioId);
    expect(cached).not.toBeNull();
    try {
      expect((await getDraftBlocks(folioId, cached!))[0].html).toBe(
        "<p>New remote manuscript</p>",
      );
    } finally {
      await closeLix({ lix: cached! });
    }
  });

  test("an unavailable shared copy leaves offline changes untouched and sync paused", async () => {
    const folioId = "paused-offline";
    const local = saveDraft(folioId, "Offline work");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(folioId, local.html);
    await enableSharedSync("https://sharing-fixture.invalid");
    await closeSharedLix();
    const review = vi.fn(async (request) => {
      expect(request.shared).toBeNull();
      expect(request.local.html).toBe(local.html);
      expect(sharedSessionLixId()).toBeNull();
      return null;
    });
    expect(
      await joinSharedLix(ownerClient(folioId), lixId, { review }),
    ).toBeNull();
    expect(review).toHaveBeenCalledOnce();
    expect(storage.drafts.get(folioId)?.html).toBe(local.html);
    expect(storage.recoveries).toHaveLength(0);
    const reopened = await openCachedSharedLix(lixId, folioId);
    expect(reopened).not.toBeNull();
    await closeLix({ lix: reopened! });
  });

  test("a commenter cannot publish their device's copy through a review decision", async () => {
    const folioId = "commenter-copy";
    const baseline = saveDraft(folioId, "Shared manuscript");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(folioId, baseline.html);
    const blob = await readableBlob(await sharedLixBlob());
    await closeSharedLix();
    const local = saveDraft(folioId, "Device-only work");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => blob,
    } as Response);
    const client = {
      query: async () => ({ folioId, role: "commenter" }),
    } as unknown as ConvexClient;
    const joined = await joinSharedLix(client, lixId, {
      review: async () => local,
    });
    expect(joined?.html).toBe(baseline.html);
    expect((await getDraftBlocks(folioId))[0].html).toBe(baseline.html);
    expect(storage.recoveries.at(-1)?.local.html).toBe(local.html);
  });

  test("failed recovery storage prevents replacement and never enables sync", async () => {
    const folioId = "recovery-storage-full";
    const baseline = saveDraft(folioId, "Shared original");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(folioId, baseline.html);
    const blob = await readableBlob(await sharedLixBlob());
    await closeSharedLix();
    const local = saveDraft(folioId, "Precious device copy");
    storage.failRecovery = true;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => blob,
    } as Response);
    const review = vi.fn();
    await expect(
      joinSharedLix(ownerClient(folioId), lixId, { review }),
    ).rejects.toThrow("Recovery storage full");
    expect(review).not.toHaveBeenCalled();
    expect(sharedSessionLixId()).toBeNull();
    expect(storage.drafts.get(folioId)).toEqual(local);
  });

  test("a shared copy changed during review must be reviewed again", async () => {
    const folioId = "stale-shared-review";
    const baseline = saveDraft(folioId, "Original shared");
    const lixId = (await openShareableLix(folioId))!;
    await syncDraftToLix(folioId, baseline.html);
    const firstBlob = await readableBlob(await sharedLixBlob());
    const newer = {
      html: "<p>Changed by a collaborator</p>",
      typstSource: "Changed by a collaborator",
    };
    const server = await openLixInMemory({
      blob: firstBlob,
      providePlugins: [jsonPlugin as unknown as any],
      keyValues: [{ key: "lix_sync", value: "false" }],
    });
    await writeSharedDraft(server, folioId, newer);
    const { toBlob } = await import("@lix-js/sdk");
    const newerBlob = await readableBlob(await toBlob({ lix: server }));
    await closeLix({ lix: server });
    await closeSharedLix();
    saveDraft(folioId, "Local unsent work");
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => firstBlob,
      } as Response)
      .mockResolvedValue({ ok: true, blob: async () => newerBlob } as Response);
    const review = vi.fn(async (request) => {
      if (request.changedSinceReview) return request.shared;
      return request.local;
    });
    const joined = await joinSharedLix(ownerClient(folioId), lixId, { review });
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls[1][0].shared).toEqual(newer);
    expect(joined?.html).toBe(newer.html);
    expect(storage.recoveries.at(-1)?.local.html).toContain(
      "Local unsent work",
    );
  });

  test("a cancelled fetch cannot replace the next folio's shared session", async () => {
    let current = true;
    let respond!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const opening = joinSharedLix(ownerClient("slow-folio"), "slow-share", {
      isCurrent: () => current,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    current = false;
    const nextLixId = await openShareableLix("next-folio");
    await syncDraftToLix("next-folio", "<p>The next manuscript</p>");
    respond(new Response(new Blob(["unused response"])));
    expect(await opening).toBeNull();
    expect(sharedSessionLixId()).toBe(nextLixId);
    expect((await getDraftBlocks("next-folio"))[0].html).toBe(
      "<p>The next manuscript</p>",
    );
  });
});
