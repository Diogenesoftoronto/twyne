import { describe, expect, test } from "bun:test";
import {
  hasBriefOpening,
  OPENING_MAX_LENGTH,
  saveBriefOpening,
  takeBriefOpening,
  tidyTitle,
  TITLE_MAX_LENGTH,
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
      saveBriefOpening(
        store,
        { text: "  An essay on the last bookshop.  " },
        0,
      ),
    ).toBe(true);
    expect(hasBriefOpening(store, 10)).toBe(true);
    expect(takeBriefOpening(store, 10)).toEqual({
      text: "An essay on the last bookshop.",
      title: null,
    });
    expect(takeBriefOpening(store, 10)).toBeNull();
    expect(store.size()).toBe(0);
  });

  test("carries the title with the sentence", () => {
    const store = memory();
    saveBriefOpening(
      store,
      { text: "A guide to rooftop bees.", title: "  The Rooftop\nHive " },
      0,
    );
    expect(takeBriefOpening(store, 0)).toEqual({
      text: "A guide to rooftop bees.",
      title: "The Rooftop Hive",
    });
  });

  test("a title alone is enough to begin", () => {
    const store = memory();
    expect(saveBriefOpening(store, { title: "Salt Roads" }, 0)).toBe(true);
    expect(hasBriefOpening(store, 0)).toBe(true);
    expect(takeBriefOpening(store, 0)).toEqual({
      text: null,
      title: "Salt Roads",
    });
  });

  test("nothing given carries nothing and clears an older opening", () => {
    const store = memory();
    saveBriefOpening(store, { text: "First idea", title: "First" }, 0);
    expect(saveBriefOpening(store, { text: "   ", title: " " }, 0)).toBe(false);
    expect(hasBriefOpening(store, 0)).toBe(false);
  });

  test("a stale or malformed opening is dropped", () => {
    const store = memory();
    saveBriefOpening(store, { text: "Old idea" }, 0);
    expect(takeBriefOpening(store, 61 * 60 * 1000)).toBeNull();
    store.setItem("twyne.brief.opening", "{not json");
    expect(takeBriefOpening(store, 0)).toBeNull();
    expect(store.size()).toBe(0);
  });

  test("an opening saved before titles existed still reads", () => {
    const store = memory();
    store.setItem(
      "twyne.brief.opening",
      JSON.stringify({ text: "An older answer", at: 0 }),
    );
    expect(takeBriefOpening(store, 0)).toEqual({
      text: "An older answer",
      title: null,
    });
  });

  test("caps a very long answer and a very long title", () => {
    const store = memory();
    saveBriefOpening(
      store,
      {
        text: "x".repeat(OPENING_MAX_LENGTH + 50),
        title: "t".repeat(TITLE_MAX_LENGTH + 50),
      },
      0,
    );
    const opening = takeBriefOpening(store, 0)!;
    expect(opening.text?.length).toBe(OPENING_MAX_LENGTH);
    expect(opening.title?.length).toBe(TITLE_MAX_LENGTH);
  });

  test("a title is one tidy line", () => {
    expect(tidyTitle("  The   Salt\n Roads ")).toBe("The Salt Roads");
    expect(tidyTitle(undefined)).toBe("");
  });
});
