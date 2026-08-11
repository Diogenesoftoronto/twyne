import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

/**
 * The crash mirror is the one synchronous write left on the save path, and it
 * only runs when the tab is going away. It exists because an IndexedDB write
 * issued during `pagehide` is not guaranteed to commit.
 *
 * It replaced a global `twyne-document` key that was written on a timer while
 * the writer typed — blocking the main thread, and holding whichever folio
 * saved last regardless of which one the writer was in. These tests pin the
 * two properties that made that a bug: it is folio-scoped, and a mirror
 * belonging to another folio is never handed back.
 */

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

const localStorageShim = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
})();

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: localStorageShim },
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageShim,
});

const { writeCrashMirror, readCrashMirror, clearCrashMirror } = await import(
  "./anti-tabula-rasa"
);

afterAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
  releaseBrowserGlobalsLock();
});

describe("crash mirror", () => {
  beforeEach(() => {
    localStorageShim.clear();
  });

  test("round-trips the manuscript for its own folio", () => {
    writeCrashMirror("f1", "<p>unsaved words</p>");
    expect(readCrashMirror("f1")).toBe("<p>unsaved words</p>");
  });

  test("is not returned for a different folio", () => {
    // The old global key would hand Folio II's body back to Folio I.
    writeCrashMirror("f1", "<p>folio one</p>");
    expect(readCrashMirror("f2")).toBeNull();
  });

  test("is empty when nothing was stashed", () => {
    expect(readCrashMirror("f1")).toBeNull();
  });

  test("clears", () => {
    writeCrashMirror("f1", "<p>body</p>");
    clearCrashMirror();
    expect(readCrashMirror("f1")).toBeNull();
  });

  test("the newest departure wins", () => {
    writeCrashMirror("f1", "<p>first</p>");
    writeCrashMirror("f1", "<p>second</p>");
    expect(readCrashMirror("f1")).toBe("<p>second</p>");
  });

  test("ignores a missing folio id rather than writing a global entry", () => {
    writeCrashMirror("", "<p>orphan</p>");
    expect(readCrashMirror("")).toBeNull();
    expect(readCrashMirror("f1")).toBeNull();
  });

  test("survives a corrupt entry without throwing", () => {
    localStorageShim.setItem("twyne:draft-crash-mirror", "{not json");
    expect(readCrashMirror("f1")).toBeNull();
  });
});
