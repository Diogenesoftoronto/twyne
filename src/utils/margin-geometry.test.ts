import { describe, expect, test } from "bun:test";
import {
  dockRight,
  marginGeometry,
  ROOM_CARD_WIDTH,
  TOOL_CARD_MAX,
} from "./margin-geometry";

describe("marginGeometry", () => {
  test("a wide right margin keeps the rail and the full tool card", () => {
    const g = marginGeometry(400, 300);
    expect(g.right).toBe("rail");
    expect(g.toolWidth).toBe(TOOL_CARD_MAX);
    expect(g.archiveFits).toBe(true);
    expect(g.shelfFits).toBe(true);
  });

  test("the tool card shrinks to the room card width before the rail gives up", () => {
    const g = marginGeometry(320, 0);
    expect(g.right).toBe("rail");
    expect(g.toolWidth).toBe(284);
    const edge = marginGeometry(304, 0);
    expect(edge.right).toBe("rail");
    expect(edge.toolWidth).toBe(ROOM_CARD_WIDTH);
  });

  test("both cards switch to the dock at the same width", () => {
    const g = marginGeometry(303, 0);
    expect(g.right).toBe("dock");
    expect(g.toolWidth).toBe(ROOM_CARD_WIDTH);
  });

  test("the left column needs its own room", () => {
    expect(marginGeometry(0, 247).archiveFits).toBe(false);
    expect(marginGeometry(0, 248).archiveFits).toBe(true);
    expect(marginGeometry(0, 203).shelfFits).toBe(false);
    expect(marginGeometry(0, 204).shelfFits).toBe(true);
  });
});

describe("dockRight", () => {
  test("follows the scroller's right edge", () => {
    expect(dockRight(1024, 600)).toBe(440);
  });
  test("never leaves the viewport", () => {
    expect(dockRight(1024, 1100)).toBe(16);
  });
});
