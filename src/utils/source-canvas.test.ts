import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The Lix blob is a real IndexedDB-backed store; these tests only care about
 * the canvas logic layered on top, so the two file helpers are stubbed with an
 * in-memory map.
 */
const files = new Map<string, unknown>();
mock.module("./lix", () => ({
  readFileAsJson: async (path: string) => files.get(path) ?? null,
  writeFileAsJson: async (path: string, data: unknown) => {
    // Round-trip through JSON so the tests see exactly what a reload would.
    files.set(path, JSON.parse(JSON.stringify(data)));
  },
}));

const {
  applyMapping,
  clampInspector,
  clampZoom,
  deleteNode,
  emptyCanvas,
  loadSourceCanvas,
  saveSourceCanvas,
  seedCanvasFromFolio,
  sourceCanvasPath,
  upsertNode,
} = await import("./source-canvas");

import type { BibEntry } from "./bibliography";
import type { CanvasNode, SourceCanvas } from "../types";

function node(over: Partial<CanvasNode> & { id: string }): CanvasNode {
  return {
    folioId: "f1",
    kind: "source",
    x: 0,
    y: 0,
    w: 320,
    h: 200,
    title: over.id,
    createdAt: 0,
    ...over,
  };
}

function bib(id: string, over: Partial<BibEntry> = {}): BibEntry {
  return {
    id,
    folioId: "f1",
    title: `Source ${id}`,
    url: `https://example.com/${id}`,
    accessedAt: 0,
    ...over,
  } as BibEntry;
}

beforeEach(() => files.clear());

describe("load / save", () => {
  test("round-trips a board", async () => {
    const canvas: SourceCanvas = {
      ...emptyCanvas("f1"),
      nodes: [node({ id: "a", x: 10, y: 20 })],
      clusters: [{ id: "c1", label: "Theme" }],
    };
    await saveSourceCanvas(canvas);
    const back = await loadSourceCanvas("f1");
    expect(back.nodes).toHaveLength(1);
    expect(back.nodes[0].x).toBe(10);
    expect(back.clusters[0].label).toBe("Theme");
  });

  test("returns an empty board for a folio that has none", async () => {
    expect((await loadSourceCanvas("nope")).nodes).toEqual([]);
  });

  test("ignores a board belonging to a different folio", async () => {
    await saveSourceCanvas({ ...emptyCanvas("other"), nodes: [node({ id: "a" })] });
    expect((await loadSourceCanvas("f1")).nodes).toEqual([]);
  });

  test("restores each board independently across A to B to A navigation", async () => {
    await saveSourceCanvas({
      ...emptyCanvas("f1"),
      nodes: [node({ id: "a", folioId: "f1", x: 10 })],
    });
    await saveSourceCanvas({
      ...emptyCanvas("f2"),
      nodes: [node({ id: "b", folioId: "f2", x: 20 })],
    });
    expect((await loadSourceCanvas("f2")).nodes.map((item) => item.id)).toEqual(["b"]);
    expect((await loadSourceCanvas("f1")).nodes.map((item) => item.id)).toEqual(["a"]);
  });

  test("a late save from folio A cannot populate or overwrite folio B", async () => {
    await saveSourceCanvas({
      ...emptyCanvas("f2"),
      nodes: [node({ id: "b", folioId: "f2" })],
    });
    await saveSourceCanvas({
      ...emptyCanvas("f1"),
      nodes: [node({ id: "late-a", folioId: "f1" })],
    });
    expect((await loadSourceCanvas("f2")).nodes.map((item) => item.id)).toEqual(["b"]);
  });

  test("migrates a legacy board only to its declared owner", async () => {
    files.set("/source-canvas.json", {
      ...emptyCanvas("f1"),
      nodes: [node({ id: "legacy" })],
    });
    expect((await loadSourceCanvas("f2")).nodes).toEqual([]);
    expect((await loadSourceCanvas("f1")).nodes.map((item) => item.id)).toEqual(["legacy"]);
    expect(files.get(sourceCanvasPath("f1"))).toBeDefined();
    expect(files.get("/source-canvas.json")).toBeNull();
  });

  /**
   * The invariant that matters most: a reload mid-extraction must not leave a
   * half-composed card on disk with nothing running to finish it.
   */
  test("never persists a streaming card", async () => {
    await saveSourceCanvas({
      ...emptyCanvas("f1"),
      nodes: [node({ id: "done" }), node({ id: "mid", streaming: true })],
    });
    const back = await loadSourceCanvas("f1");
    expect(back.nodes.map((n) => n.id)).toEqual(["done"]);
  });

  test("prunes edges that pointed at a dropped streaming card", async () => {
    await saveSourceCanvas({
      ...emptyCanvas("f1"),
      nodes: [node({ id: "a" }), node({ id: "mid", streaming: true })],
      edges: [
        { id: "e1", from: "a", to: "mid", kind: "supports", origin: "model" },
      ],
    });
    expect((await loadSourceCanvas("f1")).edges).toEqual([]);
  });

  test("repairs a corrupt viewport rather than blanking the board", async () => {
    files.set(sourceCanvasPath("f1"), {
      version: 1,
      folioId: "f1",
      nodes: [node({ id: "a" })],
      viewport: { x: NaN, y: 0, zoom: 0 },
    });
    const back = await loadSourceCanvas("f1");
    expect(back.viewport.zoom).toBe(1);
    expect(back.viewport.x).toBe(0);
    expect(back.nodes).toHaveLength(1);
  });

  test("survives a blob with missing arrays", async () => {
    files.set(sourceCanvasPath("f1"), { version: 1, folioId: "f1" });
    const back = await loadSourceCanvas("f1");
    expect(back.nodes).toEqual([]);
    expect(back.edges).toEqual([]);
    expect(back.clusters).toEqual([]);
  });
});

describe("clamps", () => {
  test("keeps zoom inside a usable range", () => {
    expect(clampZoom(0)).toBe(0.15);
    expect(clampZoom(99)).toBe(2);
    expect(clampZoom(0.5)).toBe(0.5);
  });

  test("keeps the inspector from being dragged shut or off screen", () => {
    expect(clampInspector(10)).toBe(260);
    expect(clampInspector(5000)).toBe(760);
  });
});

describe("upsert / delete", () => {
  test("updates in place rather than appending a duplicate", async () => {
    let c = await upsertNode(emptyCanvas("f1"), node({ id: "a", x: 1 }));
    c = await upsertNode(c, node({ id: "a", x: 2 }));
    expect(c.nodes).toHaveLength(1);
    expect(c.nodes[0].x).toBe(2);
  });

  test("deleting a source takes its excerpts with it", async () => {
    const c = await deleteNode(
      {
        ...emptyCanvas("f1"),
        nodes: [
          node({ id: "s" }),
          node({ id: "e1", kind: "excerpt", parentId: "s" }),
          node({ id: "e2", kind: "excerpt", parentId: "s" }),
          node({ id: "other" }),
        ],
      },
      "s",
    );
    expect(c.nodes.map((n) => n.id)).toEqual(["other"]);
  });

  test("deleting a card removes every edge that touched it", async () => {
    const c = await deleteNode(
      {
        ...emptyCanvas("f1"),
        nodes: [node({ id: "a" }), node({ id: "b" })],
        edges: [
          { id: "e1", from: "a", to: "b", kind: "supports", origin: "model" },
          { id: "e2", from: "b", to: "a", kind: "extends", origin: "writer" },
        ],
      },
      "a",
    );
    expect(c.edges).toEqual([]);
  });
});

describe("seedCanvasFromFolio", () => {
  test("adds a card for each source, attachment, and answered brief field", () => {
    const c = seedCanvasFromFolio(emptyCanvas("f1"), {
      folioId: "f1",
      bibliography: [bib("s1"), bib("s2")],
      attachments: [
        { id: "a1", kind: "link", title: "A link", url: "https://x.test", why: "", addedAt: 0 },
      ],
      briefAnswers: [
        ["premise", "The piece argues X."],
        ["audience", "   "],
      ],
    });
    expect(c.nodes.map((n) => n.id).sort()).toEqual(
      ["att:a1", "brief:premise", "src:s1", "src:s2"].sort(),
    );
  });

  test("is idempotent", () => {
    const input = { folioId: "f1", bibliography: [bib("s1")] };
    const once = seedCanvasFromFolio(emptyCanvas("f1"), input);
    const twice = seedCanvasFromFolio(once, input);
    expect(twice).toBe(once); // unchanged, and returns the same object
  });

  test("never disturbs an existing card's position or annotation", () => {
    const seeded = seedCanvasFromFolio(
      {
        ...emptyCanvas("f1"),
        nodes: [
          node({
            id: "src:s1",
            sourceId: "s1",
            x: 500,
            y: 600,
            pinned: true,
            annotation: { relevance: "kept" },
          }),
        ],
      },
      { folioId: "f1", bibliography: [bib("s1"), bib("s2")] },
    );
    const kept = seeded.nodes.find((n) => n.id === "src:s1")!;
    expect({ x: kept.x, y: kept.y, pinned: kept.pinned }).toEqual({
      x: 500,
      y: 600,
      pinned: true,
    });
    expect(kept.annotation?.relevance).toBe("kept");
  });

  test("drops cards whose source has been deleted, including its excerpts", () => {
    const c = seedCanvasFromFolio(
      {
        ...emptyCanvas("f1"),
        nodes: [
          node({ id: "src:gone", sourceId: "gone" }),
          node({ id: "ex:gone", kind: "excerpt", sourceId: "gone", parentId: "src:gone" }),
          node({ id: "src:s1", sourceId: "s1" }),
        ],
      },
      { folioId: "f1", bibliography: [bib("s1")] },
    );
    expect(c.nodes.map((n) => n.id)).toEqual(["src:s1"]);
  });

  test("keeps the writer's own note card, which no source owns", () => {
    const c = seedCanvasFromFolio(
      { ...emptyCanvas("f1"), nodes: [node({ id: "n1", kind: "note" })] },
      { folioId: "f1", bibliography: [] },
    );
    expect(c.nodes.map((n) => n.id)).toEqual(["n1"]);
  });

  test("drops a brief card once its answer is cleared", () => {
    const c = seedCanvasFromFolio(
      { ...emptyCanvas("f1"), nodes: [node({ id: "brief:premise", kind: "brief", briefField: "premise" })] },
      { folioId: "f1", bibliography: [], briefAnswers: [["premise", ""]] },
    );
    expect(c.nodes).toEqual([]);
  });
});

describe("applyMapping", () => {
  const base: SourceCanvas = {
    ...emptyCanvas("f1"),
    nodes: [node({ id: "a" }), node({ id: "b", pinned: true })],
  };

  test("attaches annotations and clusters", () => {
    const c = applyMapping(base, {
      annotations: { a: { relevance: "supports the thesis", stance: "supports" } },
      clusterOf: { a: "c1", b: "c1" },
      clusters: [{ id: "c1", label: "Mechanism" }],
    });
    expect(c.nodes[0].annotation?.stance).toBe("supports");
    expect(c.nodes[0].cluster).toBe("c1");
    expect(c.clusters[0].label).toBe("Mechanism");
  });

  test("re-clusters a pinned card — pinning fixes position, not theme", () => {
    const c = applyMapping(base, { clusterOf: { b: "c2" } });
    const b = c.nodes.find((n) => n.id === "b")!;
    expect(b.cluster).toBe("c2");
    expect(b.pinned).toBe(true);
  });

  test("keeps the writer's edges and replaces only the model's", () => {
    const withEdges: SourceCanvas = {
      ...base,
      edges: [
        { id: "w1", from: "a", to: "b", kind: "manual", origin: "writer" },
        { id: "m1", from: "b", to: "a", kind: "supports", origin: "model" },
      ],
    };
    const c = applyMapping(withEdges, {
      edges: [{ id: "m2", from: "a", to: "b", kind: "contradicts", origin: "model" }],
    });
    expect(c.edges.map((e) => e.id).sort()).toEqual(["m2", "w1"]);
  });

  test("discards edges to unknown cards and self-edges", () => {
    const c = applyMapping(base, {
      edges: [
        { id: "bad1", from: "a", to: "ghost", kind: "supports", origin: "model" },
        { id: "bad2", from: "a", to: "a", kind: "supports", origin: "model" },
        { id: "ok", from: "a", to: "b", kind: "supports", origin: "model" },
      ],
    });
    expect(c.edges.map((e) => e.id)).toEqual(["ok"]);
  });

  test("records when it ran", () => {
    expect(applyMapping(base, {}, 1234).lastMappedAt).toBe(1234);
  });
});
