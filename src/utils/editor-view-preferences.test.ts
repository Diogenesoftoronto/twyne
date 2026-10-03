import { describe, expect, test } from "bun:test";
import {
  EDITOR_VIEW_PREFERENCES_KEY,
  loadEditorViewPreferences,
  saveEditorViewPreferences,
} from "./editor-view-preferences";

describe("editor view preferences", () => {
  test("fresh and malformed preferences open a quiet writing desk", () => {
    for (const value of [
      null,
      "broken",
      "null",
      '{"zenMode":"false","compositorOpen":1}',
    ]) {
      expect(loadEditorViewPreferences({ getItem: () => value })).toEqual({
        zenMode: true,
        compositorOpen: false,
      });
    }
  });
  test("explicit choices survive reload without storing writing", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    saveEditorViewPreferences(storage, {
      zenMode: false,
      compositorOpen: true,
    });
    expect(loadEditorViewPreferences(storage)).toEqual({
      zenMode: false,
      compositorOpen: true,
    });
    expect([...values.keys()]).toEqual([EDITOR_VIEW_PREFERENCES_KEY]);
    expect(JSON.parse(values.get(EDITOR_VIEW_PREFERENCES_KEY)!)).toEqual({
      zenMode: false,
      compositorOpen: true,
    });
  });
  test("unavailable browser storage never blocks writing or opening tools", () => {
    expect(
      loadEditorViewPreferences({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({ zenMode: true, compositorOpen: false });
    expect(() =>
      saveEditorViewPreferences(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        { zenMode: false, compositorOpen: true },
      ),
    ).not.toThrow();
  });
});
