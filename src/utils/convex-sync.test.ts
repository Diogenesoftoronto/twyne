import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_APPARATUS_SETTINGS,
  DEFAULT_WRITER_SETTINGS,
  type AiSettings,
  type ApparatusSettings,
  type WriterSettings,
} from "../types";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

/**
 * These tests exercise the folio sync path — "gracefully sending information
 * through the folio" — without a real browser or Convex backend. We give the
 * module a minimal `window`, mock the IndexedDB + Lix layers it reads from, and
 * inject a fake Convex client to observe (or fail) the outgoing mutation.
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

// Minimal browser global so the local-first guard (`typeof window`) passes.
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: localStorageShim,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  },
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageShim,
});

const SAMPLE_FOLIOS = [
  { id: "f1", name: "Draft", type: "draft", createdAt: 1, updatedAt: 2 },
];
const SAMPLE_HTML = "<p>hello from the folio</p>";
const AI_SETTINGS_STORAGE_KEY = "twyne.ai-settings.current";
const WRITER_SETTINGS_STORAGE_KEY = "twyne.writer-settings.current";
const APPARATUS_SETTINGS_STORAGE_KEY = "twyne.apparatus-settings.current";

function readLocalStorageJson<T>(key: string): T | null {
  try {
    const raw = localStorageShim.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocalStorageJson(key: string, value: unknown): void {
  localStorageShim.setItem(key, JSON.stringify(value));
}

function normalizeWriterSettings(value: unknown): WriterSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_WRITER_SETTINGS };
  const v = value as Partial<WriterSettings>;
  return {
    interviewStyle:
      v.interviewStyle === "conversational" ? "conversational" : "form",
  };
}

function normalizeApparatusSettings(value: unknown): ApparatusSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_APPARATUS_SETTINGS };
  }
  const v = value as Partial<ApparatusSettings>;
  const maxResults =
    typeof v.tinyFishMaxResults === "number" &&
    Number.isFinite(v.tinyFishMaxResults)
      ? Math.round(v.tinyFishMaxResults)
      : DEFAULT_APPARATUS_SETTINGS.tinyFishMaxResults;
  return {
    defaultCitationStyle:
      v.defaultCitationStyle === "apa" ||
      v.defaultCitationStyle === "chicago" ||
      v.defaultCitationStyle === "mla"
        ? v.defaultCitationStyle
        : DEFAULT_APPARATUS_SETTINGS.defaultCitationStyle,
    aiEnhanceCitations: v.aiEnhanceCitations === true,
    flagMissingSources: v.flagMissingSources === true,
    researchProvider:
      v.researchProvider === "tinyfish" ||
      v.researchProvider === "model-web-search" ||
      v.researchProvider === "web-mcp"
        ? v.researchProvider
        : DEFAULT_APPARATUS_SETTINGS.researchProvider,
    tinyFishApiKey:
      typeof v.tinyFishApiKey === "string" ? v.tinyFishApiKey : "",
    tinyFishMaxResults: Math.max(1, Math.min(20, maxResults)),
    mcpEndpointUrl:
      typeof v.mcpEndpointUrl === "string" ? v.mcpEndpointUrl : "",
    mcpToolName:
      typeof v.mcpToolName === "string" && v.mcpToolName.trim()
        ? v.mcpToolName
        : DEFAULT_APPARATUS_SETTINGS.mcpToolName,
    mcpBearerToken:
      typeof v.mcpBearerToken === "string" ? v.mcpBearerToken : "",
  };
}

// Stub the local storage layers buildLocalSnapshot() reads from.
mock.module("./idb", () => ({
  // Read paths used by buildLocalSnapshot()
  loadFoliosFromIdb: async () => SAMPLE_FOLIOS,
  loadActiveFolioIdFromIdb: async () => "f1",
  loadFolioContentFromIdb: async () => SAMPLE_HTML,
  loadPersonasFromIdb: async () => [],
  loadDraftHtmlFromIdb: async () => "",
  loadLixBlobFromIdb: async () => null,
  // Write paths convex-sync imports but our tests never hit — safe no-ops.
  saveFoliosToIdb: async () => {},
  saveFolioContentToIdb: async () => {},
  savePersonasToIdb: async () => {},
  saveDraftHtmlToIdb: async () => {},
  clearIdbStore: async () => {},
  loadAiSettingsFromIdb: async () =>
    readLocalStorageJson<AiSettings>(AI_SETTINGS_STORAGE_KEY),
  saveAiSettingsToIdb: async (settings: AiSettings) => {
    writeLocalStorageJson(AI_SETTINGS_STORAGE_KEY, settings);
  },
  loadWriterSettingsFromIdb: async () =>
    normalizeWriterSettings(
      readLocalStorageJson<WriterSettings>(WRITER_SETTINGS_STORAGE_KEY),
    ),
  saveWriterSettingsToIdb: async (settings: WriterSettings) => {
    writeLocalStorageJson(WRITER_SETTINGS_STORAGE_KEY, settings);
  },
  loadApparatusSettingsFromIdb: async () =>
    normalizeApparatusSettings(
      readLocalStorageJson<ApparatusSettings>(APPARATUS_SETTINGS_STORAGE_KEY),
    ),
  saveApparatusSettingsToIdb: async (settings: ApparatusSettings) => {
    writeLocalStorageJson(APPARATUS_SETTINGS_STORAGE_KEY, settings);
  },
}));

mock.module("./lix", () => ({
  BRIEF_PATH: "/brief.json",
  readFileAsJson: async () => null,
  writeFileAsJson: async () => {},
  persistToIdb: async () => {},
}));

const { setConvexSyncContext, clearConvexSyncContext, flushNow } = await import(
  "./convex-sync"
);

interface RecordingClient {
  calls: Array<Record<string, unknown>>;
  query: (...args: unknown[]) => Promise<unknown>;
  mutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

function makeClient(opts: { fail?: boolean } = {}): RecordingClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    // No remote data → handleUserChanged takes the "seed the account" path.
    query: async () => null,
    mutation: async (_ref, args) => {
      calls.push(args);
      if (opts.fail) throw new Error("network down");
      return null;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  clearConvexSyncContext();
});

afterAll(() => {
  mock.restore();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, "localStorage");
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  }
  releaseBrowserGlobalsLock();
});

describe("folio sync (convex-sync)", () => {
  test("sends folios and their content through to the backend", async () => {
    const client = makeClient();
    setConvexSyncContext(client as never, "user-1");
    await tick(); // let the background sign-in push settle
    client.calls.length = 0; // isolate the explicit flush below

    await flushNow();

    expect(client.calls.length).toBe(1);
    const payload = client.calls[0];
    expect(payload.folios).toEqual(SAMPLE_FOLIOS);
    expect(payload.folioContent).toEqual([
      { folioId: "f1", html: SAMPLE_HTML },
    ]);
  });

  test("swallows a failing backend without throwing", async () => {
    const client = makeClient({ fail: true });
    setConvexSyncContext(client as never, "user-2");
    await tick();

    // The mutation throws, but the folio send must degrade gracefully.
    await expect(flushNow()).resolves.toBeUndefined();
  });

  test("is a safe no-op when signed out", async () => {
    clearConvexSyncContext();
    const client = makeClient();

    await flushNow();

    expect(client.calls.length).toBe(0);
  });
});
