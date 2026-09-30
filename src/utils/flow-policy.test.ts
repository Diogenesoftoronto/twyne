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

const wayIn: FlowItem = {
  id: "way-in:passage",
  kind: "way-in",
  title: "Say it plainly first",
  body: "The phrasing can come later.",
  anchors: ["the passage"],
  links: ["echo:earlier"],
  relevance: 0.6,
  createdAt: 0,
};
const stuckContext: SurfaceContext = {
  mode: "stuck",
  cursorText: "the passage",
  shown: new Set([wayIn.id]),
  dismissed: new Set(),
  weight: () => 1,
  now: 0,
};

test("a way in leads while stuck and brings its linked echo even when another item scores higher", () => {
  const comment: FlowItem = {
    ...wayIn,
    id: "comment:urgent",
    kind: "comment",
    relevance: 1,
  };
  const echo: FlowItem = {
    ...wayIn,
    id: "echo:earlier",
    kind: "echo",
    links: [],
  };
  const decision = decideSurface([comment, echo, wayIn], {
    ...stuckContext,
    weight: (kind) => (kind === "way-in" ? 0.2 : 1.8),
  });
  expect(decision.visible.map((item) => item.id)).toEqual([wayIn.id, echo.id]);
  expect(decision.held).toBe(1);
  expect(decision.reasons[comment.id]).toStartWith("held:");
});

test("a way in is held in every other mode, even if previously shown", () => {
  for (const mode of ["working", "settling", "flow", "away"] as const) {
    const decision = decideSurface([wayIn], { ...stuckContext, mode });
    expect(decision.visible).toEqual([]);
    expect(decision.held).toBe(1);
    expect(decision.reasons[wayIn.id]).toBe(
      "held: a way in is only offered while stuck",
    );
  }
});

test("dismissing a way in never resurfaces it for the passage or counts it as held", () => {
  const decision = decideSurface([wayIn], {
    ...stuckContext,
    dismissed: new Set([wayIn.id]),
  });
  expect(decision.visible).toEqual([]);
  expect(decision.held).toBe(0);
  expect(decision.reasons[wayIn.id]).toBe("dismissed");
});

test("a way in for a different passage waits while the writer is stuck elsewhere", () => {
  const decision = decideSurface([wayIn], {
    ...stuckContext,
    cursorText: "an unrelated scene",
  });
  expect(decision.visible).toEqual([]);
  expect(decision.held).toBe(1);
  expect(decision.reasons[wayIn.id]).toBe(
    "held: a way in belongs to another passage",
  );
});
