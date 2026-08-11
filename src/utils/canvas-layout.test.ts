import { describe, expect, test } from "bun:test";

import { DEFAULT_LAYOUT, layoutCanvas, orderCluster, reserveSlot } from "./canvas-layout";
import type { CanvasNode } from "../types";

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

function boxes(nodes: CanvasNode[]) {
  return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
}

describe("orderCluster", () => {
  test("places each excerpt directly under its own source, in document order", () => {
    const out = orderCluster([
      node({ id: "e2", kind: "excerpt", parentId: "s1", order: 2 }),
      node({ id: "s2", createdAt: 2 }),
      node({ id: "e1", kind: "excerpt", parentId: "s1", order: 1 }),
      node({ id: "s1", createdAt: 1 }),
    ]);
    expect(out.map((n) => n.id)).toEqual(["s1", "e1", "e2", "s2"]);
  });

  test("keeps an excerpt whose parent is absent rather than dropping it", () => {
    const out = orderCluster([
      node({ id: "orphan", kind: "excerpt", parentId: "gone", order: 1 }),
      node({ id: "s1" }),
    ]);
    expect(out.map((n) => n.id).sort()).toEqual(["orphan", "s1"]);
  });

  test("reads brief, then attachments, then sources", () => {
    const out = orderCluster([
      node({ id: "src", kind: "source" }),
      node({ id: "att", kind: "attachment" }),
      node({ id: "brf", kind: "brief" }),
    ]);
    expect(out.map((n) => n.id)).toEqual(["brf", "att", "src"]);
  });

  test("is independent of input order", () => {
    const input = [
      node({ id: "b", createdAt: 5 }),
      node({ id: "a", createdAt: 5 }),
      node({ id: "c", createdAt: 1 }),
    ];
    const forward = orderCluster([...input]).map((n) => n.id);
    const reversed = orderCluster([...input].reverse()).map((n) => n.id);
    expect(forward).toEqual(reversed);
  });
});

describe("layoutCanvas", () => {
  test("is deterministic — same input, identical output", () => {
    const nodes = [
      node({ id: "a", cluster: "c1" }),
      node({ id: "b", cluster: "c2" }),
      node({ id: "c", cluster: "c1", kind: "excerpt", parentId: "a", order: 1 }),
    ];
    expect(boxes(layoutCanvas(nodes, []))).toEqual(boxes(layoutCanvas(nodes, [])));
  });

  test("never moves or resizes a pinned card", () => {
    const pinnedCard = node({ id: "p", pinned: true, x: 999, y: 777, w: 111, h: 222 });
    const out = layoutCanvas([pinnedCard, node({ id: "free" })]);
    const after = out.find((n) => n.id === "p")!;
    expect({ x: after.x, y: after.y, w: after.w, h: after.h }).toEqual({
      x: 999,
      y: 777,
      w: 111,
      h: 222,
    });
  });

  test("pushes a free card clear of a pinned card it would have overlapped", () => {
    // The pinned card sits exactly where the first free card would land.
    const pinnedCard = node({ id: "p", pinned: true, x: 0, y: 0, w: 320, h: 300 });
    const out = layoutCanvas([pinnedCard, node({ id: "free", h: 200 })]);
    const free = out.find((n) => n.id === "free")!;
    expect(free.y).toBeGreaterThanOrEqual(300);
  });

  test("does not overlap free cards with each other", () => {
    const nodes = Array.from({ length: 12 }, (_, i) =>
      node({ id: `n${i}`, cluster: i % 3 === 0 ? "a" : "b", h: 150 + i * 10, createdAt: i }),
    );
    const out = layoutCanvas(nodes, [{ id: "a", label: "A" }, { id: "b", label: "B" }]);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i];
        const q = out[j];
        const hit =
          p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
        expect(hit).toBe(false);
      }
    }
  });

  test("gives each cluster its own column", () => {
    const out = layoutCanvas(
      [node({ id: "a", cluster: "c1" }), node({ id: "b", cluster: "c2" })],
      [{ id: "c1", label: "One" }, { id: "c2", label: "Two" }],
    );
    const a = out.find((n) => n.id === "a")!;
    const b = out.find((n) => n.id === "b")!;
    expect(a.x).not.toEqual(b.x);
  });

  test("honours declared cluster order, and sorts undeclared ones for stability", () => {
    const nodes = [
      node({ id: "z", cluster: "zeta" }),
      node({ id: "m", cluster: "declared" }),
      node({ id: "a", cluster: "alpha" }),
    ];
    const out = layoutCanvas(nodes, [{ id: "declared", label: "D" }]);
    const x = (id: string) => out.find((n) => n.id === id)!.x;
    // Declared first, then undeclared alphabetically: alpha before zeta.
    expect(x("m")).toBeLessThan(x("a"));
    expect(x("a")).toBeLessThan(x("z"));
  });

  test("wraps a column that runs past the height limit", () => {
    const tall = Array.from({ length: 6 }, (_, i) =>
      node({ id: `t${i}`, cluster: "one", h: 500, createdAt: i }),
    );
    const out = layoutCanvas(tall, [{ id: "one", label: "One" }], {
      maxColumnHeight: 1200,
    });
    expect(new Set(out.map((n) => n.x)).size).toBeGreaterThan(1);
  });

  test("indents an excerpt under its source", () => {
    const out = layoutCanvas([
      node({ id: "s" }),
      node({ id: "e", kind: "excerpt", parentId: "s", order: 1 }),
    ]);
    const s = out.find((n) => n.id === "s")!;
    const e = out.find((n) => n.id === "e")!;
    expect(e.x).toBe(s.x + DEFAULT_LAYOUT.childIndent);
    expect(e.w).toBeLessThan(s.w);
  });

  test("reserves the declared box for a streaming card", () => {
    const out = layoutCanvas([node({ id: "s", streaming: true, h: 220 })]);
    expect(out[0].h).toBe(220);
  });

  test("returns nodes in the order given, so a positional diff stays valid", () => {
    const nodes = [node({ id: "x" }), node({ id: "y" }), node({ id: "z" })];
    expect(layoutCanvas(nodes).map((n) => n.id)).toEqual(["x", "y", "z"]);
  });

  test("does not mutate its input", () => {
    const nodes = [node({ id: "a", x: 5, y: 5 })];
    const snapshot = JSON.stringify(nodes);
    layoutCanvas(nodes);
    expect(JSON.stringify(nodes)).toBe(snapshot);
  });

  test("terminates with many pinned obstacles stacked in one column", () => {
    const pins = Array.from({ length: 20 }, (_, i) =>
      node({ id: `p${i}`, pinned: true, x: 0, y: i * 210, w: 320, h: 200 }),
    );
    const out = layoutCanvas([...pins, node({ id: "free", h: 200 })]);
    const free = out.find((n) => n.id === "free")!;
    // Cleared the whole stack rather than settling inside it.
    expect(free.y).toBeGreaterThanOrEqual(19 * 210 + 200);
  });
});

describe("reserveSlot", () => {
  test("narrows an excerpt to match its indent", () => {
    expect(reserveSlot({ kind: "excerpt" }).w).toBe(
      DEFAULT_LAYOUT.columnWidth - DEFAULT_LAYOUT.childIndent,
    );
  });

  test("gives a brief card a shorter default than a source card", () => {
    expect(reserveSlot({ kind: "brief" }).h).toBeLessThan(reserveSlot({ kind: "source" }).h);
  });
});
