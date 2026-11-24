import { describe, expect, test } from "bun:test";
import {
  hasBriefOpening,
  OPENING_MAX_LENGTH,
  saveBriefOpening,
  takeBriefOpening,
} from "./brief-opening";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    size: () => data.size,
  };
};

describe("brief opening hand-off", () => {
  test("carries the sentence once, trimmed", () => {
    const store = memory();
    expect(
      saveBriefOpening(store, "  An essay on the last bookshop.  ", 0),
    ).toBe(true);
    expect(hasBriefOpening(store, 10)).toBe(true);
    expect(takeBriefOpening(store, 10)).toBe("An essay on the last bookshop.");
    expect(takeBriefOpening(store, 10)).toBeNull();
    expect(store.size()).toBe(0);
  });

  test("an empty sentence carries nothing and clears an older one", () => {
    const store = memory();
    saveBriefOpening(store, "First idea", 0);
    expect(saveBriefOpening(store, "   ", 0)).toBe(false);
    expect(hasBriefOpening(store, 0)).toBe(false);
  });

  test("a stale or malformed opening is dropped", () => {
    const store = memory();
    saveBriefOpening(store, "Old idea", 0);
    expect(takeBriefOpening(store, 61 * 60 * 1000)).toBeNull();
    store.setItem("twyne.brief.opening", "{not json");
    expect(takeBriefOpening(store, 0)).toBeNull();
    expect(store.size()).toBe(0);
  });

  test("caps a very long answer", () => {
    const store = memory();
    saveBriefOpening(store, "x".repeat(OPENING_MAX_LENGTH + 50), 0);
    expect(takeBriefOpening(store, 0)?.length).toBe(OPENING_MAX_LENGTH);
  });
});
