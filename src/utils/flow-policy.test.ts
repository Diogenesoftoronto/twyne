import { expect, test } from "bun:test";
import { readFlow } from "./flow-state";
import {
  decideSurface,
  stackCards,
  type FlowItem,
  type SurfaceContext,
} from "./flow-items";

test("reaching for a conversation prevents entering focus and releases existing focus", () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({
    at: i * 1000,
    inserted: 5,
    deleted: 0,
  }));
  expect(readFlow(samples, 99000, "working").mode).toBe("flow");
  for (const mode of ["working", "settling", "flow"] as const)
    expect(
      readFlow(samples, 99000, mode, undefined, { reaching: true }).mode,
    ).toBe("working");
  expect(readFlow(samples, 110000, "flow").mode).toBe("flow");
  expect(readFlow(samples, 125000, "flow").mode).toBe("working");
});

test("quiet modes hold new cards; dismissal also removes a previously shown card", () => {
  const items: FlowItem[] = ["old", "new"].map((id) => ({
    id,
    kind: "comment",
    anchors: ["the passage"],
    title: id,
    body: id,
    createdAt: 0,
  }));
  const context: SurfaceContext = {
    mode: "settling",
    cursorText: "the passage",
    shown: new Set(["old"]),
    dismissed: new Set(),
    weight: () => 1,
    now: 0,
  };
  expect(decideSurface(items, context).visible.map((i) => i.id)).toEqual([
    "old",
  ]);
  expect(decideSurface(items, { ...context, mode: "flow" }).visible).toEqual(
    [],
  );
  expect(
    decideSurface(items, { ...context, dismissed: new Set(["old"]) }).visible,
  ).toEqual([]);
});

test("cards step around tools and expanded conversations", () => {
  const positions = stackCards(
    [
      { id: "a", top: 20, height: 120 },
      { id: "b", top: 30, height: 200 },
    ],
    [{ top: 0, height: 300 }],
  );
  expect(positions.a).toBeGreaterThanOrEqual(310);
  expect(positions.b).toBeGreaterThanOrEqual(positions.a + 130);
});
