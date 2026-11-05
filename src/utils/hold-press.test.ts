import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { beginHold, cancelHold, isHolding } from "./hold-press";

/** Just enough of an element for the platen: attributes and one style var. */
function fakeElement() {
  const attrs = new Map<string, string>();
  const vars = new Map<string, string>();
  return {
    attrs,
    vars,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    hasAttribute: (k: string) => attrs.has(k),
    style: { setProperty: (k: string, v: string) => void vars.set(k, v) },
  } as unknown as HTMLElement & {
    attrs: Map<string, string>;
    vars: Map<string, string>;
  };
}

let clock = 0;
let frames: Array<(now: number) => void> = [];
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;
const realNow = performance.now.bind(performance);

beforeEach(() => {
  clock = 0;
  frames = [];
  globalThis.requestAnimationFrame = ((cb: (now: number) => void) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {
    frames = [];
  }) as typeof cancelAnimationFrame;
  performance.now = () => clock;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
  performance.now = realNow;
});

/** Advance the clock and run the frames queued so far. */
function advance(ms: number) {
  clock += ms;
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(clock);
}

describe("hold press", () => {
  test("commits once, only when held for the whole duration", () => {
    const element = fakeElement();
    let commits = 0;
    beginHold(element, { durationMs: 900, onCommit: () => commits++ });
    expect(element.attrs.has("data-holding")).toBe(true);
    advance(450);
    expect(commits).toBe(0);
    const halfway = Number(element.vars.get("--press-progress"));
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(0.5); // eased: slow to start
    advance(500);
    expect(commits).toBe(1);
    expect(element.attrs.has("data-committed")).toBe(true);
    expect(isHolding(element)).toBe(false);
  });

  test("releasing early cancels and drains the ink", () => {
    const element = fakeElement();
    let commits = 0;
    beginHold(element, { durationMs: 900, onCommit: () => commits++ });
    advance(600);
    cancelHold(element);
    advance(600);
    expect(commits).toBe(0);
    expect(element.vars.get("--press-progress")).toBe("0");
    expect(element.attrs.has("data-holding")).toBe(false);
  });

  test("a click-length press nudges the hint; a real attempt does not", () => {
    const clicked = fakeElement();
    beginHold(clicked, { durationMs: 900, onCommit: () => {} });
    advance(80);
    cancelHold(clicked);
    expect(clicked.attrs.has("data-nudged")).toBe(true);

    const tried = fakeElement();
    beginHold(tried, { durationMs: 900, onCommit: () => {} });
    advance(500);
    cancelHold(tried);
    expect(tried.attrs.has("data-nudged")).toBe(false);
  });

  test("a second press while one runs is ignored", () => {
    const element = fakeElement();
    let commits = 0;
    beginHold(element, { durationMs: 300, onCommit: () => commits++ });
    beginHold(element, { durationMs: 300, onCommit: () => commits++ });
    advance(320);
    expect(commits).toBe(1);
  });
});
