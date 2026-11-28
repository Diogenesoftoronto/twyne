import { describe, expect, test } from "bun:test";
import {
  applyCursors,
  CURSOR_BOOTSTRAP_SCRIPT,
  CURSOR_STORAGE_KEY,
  normalizeCursorPreference,
} from "./cursors";

describe("cursor preference", () => {
  test("anything unrecognised is the house set", () => {
    expect(normalizeCursorPreference("system")).toBe("system");
    expect(normalizeCursorPreference("house")).toBe("house");
    expect(normalizeCursorPreference("large")).toBe("house");
    expect(normalizeCursorPreference(null)).toBe("house");
  });

  test("the choice is stamped where the stylesheet reads it", () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) =>
        void attributes.set(name, value),
    } as unknown as HTMLElement;
    applyCursors("system", root);
    expect(attributes.get("data-cursors")).toBe("system");
  });

  test("the bootstrap reads the same key and stamps the same attribute", () => {
    expect(CURSOR_BOOTSTRAP_SCRIPT).toContain(CURSOR_STORAGE_KEY);
    expect(CURSOR_BOOTSTRAP_SCRIPT).toContain("data-cursors");
    // It must run as written: a syntax error here would break every page.
    const stamped = new Map<string, string>();
    const run = new Function(
      "localStorage",
      "document",
      CURSOR_BOOTSTRAP_SCRIPT,
    );
    run(
      { getItem: () => "system" },
      {
        documentElement: {
          setAttribute: (name: string, value: string) =>
            void stamped.set(name, value),
        },
      },
    );
    expect(stamped.get("data-cursors")).toBe("system");
    run(
      { getItem: () => "nonsense" },
      {
        documentElement: {
          setAttribute: (name: string, value: string) =>
            void stamped.set(name, value),
        },
      },
    );
    expect(stamped.get("data-cursors")).toBe("house");
  });
});
