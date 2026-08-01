import { describe, expect, test } from "bun:test";

describe("folio dossier wiring", () => {
  test("new folios are preserved and routed into a fresh dossier", async () => {
    const source = await Bun.file("src/routes/editor/index.tsx").text();
    expect(source).toContain("const createFolio = $(");
    expect(source).toContain("const nextFolios = [...store.folios, newFolio]");
    expect(source).toContain("store.brief = null");
    expect(source).toContain("stopBackgroundRoom()");
    expect(source).toContain("stopBackgroundResearch()");
    expect(source).toContain("/dossier/create/?folio=");
    expect(source).not.toContain("await clearIdbStore()");
  });

  test("switching folios switches the dossier too", async () => {
    const source = await Bun.file("src/routes/editor/index.tsx").text();
    expect(source).toContain("const activateFolio = $(");
    expect(source).toContain("loadProjectBriefForFolio(folio.id)");
    expect(source).toContain("store.brief = brief");
    expect(source).toContain("await activateFolio(folio)");
  });

  test("editorial panels and background services are keyed by active folio", async () => {
    const source = await Bun.file("src/routes/editor/index.tsx").text();
    expect(source).toContain("key={`editor-${store.activeFolioId");
    expect(source).toContain("key={`personas-${store.activeFolioId}`}");
    expect(source).toContain("key={`rubric-${store.activeFolioId}`}");
    expect(source).toContain("key={`comments-${store.activeFolioId");
    expect(source).toContain("key={`citations-${store.activeFolioId");
    expect(source).toContain("track(() => store.activeFolioId)");
    expect(source).toContain("startBackgroundRoom({");
    expect(source).toContain("folioId,");
  });

  test("dossier create and refine save against the selected folio", async () => {
    const create = await Bun.file(
      "src/routes/dossier/create/index.tsx",
    ).text();
    const refine = await Bun.file(
      "src/routes/dossier/refine/index.tsx",
    ).text();
    expect(create).toContain("saveProjectBriefForFolio(folioId, brief)");
    expect(refine).toContain("loadProjectBriefForFolio(store.folioId)");
    expect(refine).toContain(
      "saveProjectBriefForFolio(store.folioId, next)",
    );
  });

  test("sync carries a collection of per-folio dossiers", async () => {
    const client = await Bun.file("src/utils/convex-sync.ts").text();
    const server = await Bun.file("convex/sync.ts").text();
    const schema = await Bun.file("convex/schema.ts").text();
    expect(client).toContain("loadAllBriefsFromIdb");
    expect(client).toContain("briefs: snap.briefs");
    expect(server).toContain("briefs: v.optional(");
    expect(schema).toContain('.index("by_userId_folioId", ["userId", "folioId"])');
  });

  test("room notes, replies, analysis, rubric, and suggestions use folio scope", async () => {
    const client = await Bun.file("src/utils/convex-sync.ts").text();
    const server = await Bun.file("convex/sync.ts").text();
    const schema = await Bun.file("convex/schema.ts").text();
    const idb = await Bun.file("src/utils/idb.ts").text();

    expect(client).toContain("folioArtifactPath(folioId");
    expect(client).toContain("rubricResults: snap.rubricResults");
    expect(server).toContain("folioId: v.string()");
    expect(server).toContain("rubricResults: v.optional(");
    expect(schema).toContain("by_userId_folioId");
    expect(idb).toContain('folioMetaKey("room-analysis", folioId)');
    expect(idb).toContain('folioMetaKey("rubric-result", folioId)');
  });
});
