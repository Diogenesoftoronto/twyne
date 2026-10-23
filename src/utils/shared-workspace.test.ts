// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConvexClient } from "convex/browser";

// The isolated transport mocks belong to Vitest, not Bun's shared module registry.
const supportsViteModules = typeof import.meta.glob === "function";
const describeBrowser = supportsViteModules ? describe : describe.skip;
if (supportsViteModules)
  vi.doMock("./collaboration", () => ({ joinSharedLix: vi.fn() }));
if (supportsViteModules)
  vi.doMock("./idb", () => ({
    saveFolioContentToIdb: vi.fn().mockResolvedValue(undefined),
  }));
if (supportsViteModules)
  vi.doMock("./lix", () => ({
    syncDraftToLix: vi.fn().mockResolvedValue(undefined),
  }));

const { joinSharedLix } = await import("./collaboration");
const { saveFolioContentToIdb } = await import("./idb");
const { syncDraftToLix } = await import("./lix");
const { openOwnedSharedWorkspace, stopOwnedSharedWorkspace } = await import(
  "./shared-workspace"
);

function workspace() {
  return {
    activeFolioId: "folio-a",
    folioKey: 0,
    editorSeed: "<p>Original share snapshot</p>",
    sharedLixId: "share-a" as string | null,
    sharedRole: "owner" as "owner" | "editor" | "commenter" | null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(joinSharedLix).mockResolvedValue({
    folioId: "folio-a",
    role: "owner",
    html: "<p>Remote draft</p>",
  });
});

describeBrowser("shared workspace transitions", () => {
  test("stopping sharing seeds the remounted editor and disk from the live manuscript", async () => {
    const store = workspace();
    await stopOwnedSharedWorkspace(
      store,
      "folio-a",
      () => "<p>Edits made after sharing</p>",
    );
    expect(store).toMatchObject({
      sharedLixId: null,
      sharedRole: null,
      editorSeed: "<p>Edits made after sharing</p>",
    });
    expect(saveFolioContentToIdb).toHaveBeenCalledWith(
      "folio-a",
      store.editorSeed,
    );
  });

  test("a late unshare cannot clear another folio or a collaborator's document", async () => {
    const store = workspace();
    store.activeFolioId = "folio-b";
    await stopOwnedSharedWorkspace(store, "folio-a", () => "wrong draft");
    store.activeFolioId = "folio-a";
    store.sharedRole = "editor";
    await stopOwnedSharedWorkspace(store, "folio-a", () => "wrong draft");
    expect(store.sharedLixId).toBe("share-a");
    expect(saveFolioContentToIdb).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "a delayed open cannot attach to another workspace (returning to the original folio: %s)",
    async (returnToOriginal) => {
      const store = workspace();
      let complete!: (value: Awaited<ReturnType<typeof joinSharedLix>>) => void;
      vi.mocked(joinSharedLix).mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const opening = openOwnedSharedWorkspace({
        client: {} as ConvexClient,
        workspace: store,
        folioId: "folio-a",
        lixId: "share-a",
        getLiveDraft: () => store.editorSeed,
        useLiveDraft: false,
        isCurrent: () => true,
      });
      store.activeFolioId = returnToOriginal ? "folio-a" : "folio-b";
      store.folioKey += returnToOriginal ? 2 : 1;
      store.editorSeed = "<p>Current workspace</p>";
      store.sharedLixId = "current-share";
      const expected = { ...store };
      complete({
        folioId: "folio-a",
        role: "owner",
        html: "<p>Old response</p>",
      });
      expect(await opening).toBe(false);
      expect(store).toEqual(expected);
      expect(vi.mocked(joinSharedLix).mock.calls[0][2]?.isCurrent?.()).toBe(
        false,
      );
    },
  );

  test("preserves typing during both the open request and the final mirror", async () => {
    const store = workspace();
    let live = "<p>Before opening</p>";
    vi.mocked(joinSharedLix).mockImplementation(async () => {
      live = "<p>Typed during opening</p>";
      return {
        folioId: "folio-a",
        role: "owner",
        html: "<p>Server snapshot</p>",
      };
    });
    vi.mocked(syncDraftToLix).mockImplementationOnce(async () => {
      live = "<p>Typed during persistence</p>";
    });
    expect(
      await openOwnedSharedWorkspace({
        client: {} as ConvexClient,
        workspace: store,
        folioId: "folio-a",
        lixId: "share-a",
        getLiveDraft: () => live,
        useLiveDraft: false,
        isCurrent: () => true,
      }),
    ).toBe(true);
    expect(store.editorSeed).toBe("<p>Typed during persistence</p>");
    expect(syncDraftToLix).toHaveBeenLastCalledWith(
      "folio-a",
      store.editorSeed,
    );
  });

  test("a reviewed shared choice cannot be replaced by the pre-review live draft", async () => {
    const store = workspace();
    const local = "<p>Unsent device copy</p>";
    vi.mocked(joinSharedLix).mockResolvedValue({
      folioId: "folio-a",
      role: "owner",
      html: "<p>Reviewed result</p>",
      reviewedLocal: { html: local },
    });
    expect(
      await openOwnedSharedWorkspace({
        client: {} as ConvexClient,
        workspace: store,
        folioId: "folio-a",
        lixId: "share-a",
        getLiveDraft: () => local,
        useLiveDraft: true,
        isCurrent: () => true,
      }),
    ).toBe(true);
    expect(store.editorSeed).toBe("<p>Reviewed result</p>");
    expect(syncDraftToLix).not.toHaveBeenCalled();
  });
});
