import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_APPARATUS_SETTINGS,
  DEFAULT_WRITER_SETTINGS,
  type AiSettings,
  type ApparatusSettings,
  type ProjectBrief,
  type RubricResult,
  type WriterSettings,
} from "../types";
import type { BibEntry } from "./bibliography";
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
const SAMPLE_BIBLIOGRAPHY: BibEntry[] = [
  {
    id: "bib-1",
    folioId: "f1",
    title: "A Source Worth Keeping",
    url: "https://example.com/source",
    accessedAt: 10,
    createdAt: 10,
  },
];
const AI_SETTINGS_STORAGE_KEY = "twyne.ai-settings.current";
const WRITER_SETTINGS_STORAGE_KEY = "twyne.writer-settings.current";
const APPARATUS_SETTINGS_STORAGE_KEY = "twyne.apparatus-settings.current";
const BIBLIOGRAPHY_PATH = "/bibliography.json";
const lixFiles = new Map<string, unknown>();
const writtenLixFiles: Array<{ path: string; value: unknown }> = [];
let lixBlobFromIdb: Blob | null = null;

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
  if (!value || typeof value !== "object")
    return { ...DEFAULT_WRITER_SETTINGS };
  const v = value as Partial<WriterSettings>;
  return {
    interviewStyle:
      v.interviewStyle === "conversational" ? "conversational" : "form",
    profile: {
      displayName:
        typeof v.profile?.displayName === "string"
          ? v.profile.displayName
          : DEFAULT_WRITER_SETTINGS.profile.displayName,
      personalFacts:
        typeof v.profile?.personalFacts === "string"
          ? v.profile.personalFacts
          : DEFAULT_WRITER_SETTINGS.profile.personalFacts,
      feedbackStyle:
        v.profile?.feedbackStyle === "direct" ||
        v.profile?.feedbackStyle === "gentle"
          ? v.profile.feedbackStyle
          : DEFAULT_WRITER_SETTINGS.profile.feedbackStyle,
      feedbackNotes:
        typeof v.profile?.feedbackNotes === "string"
          ? v.profile.feedbackNotes
          : DEFAULT_WRITER_SETTINGS.profile.feedbackNotes,
    },
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
  loadAllBriefsFromIdb: async () => [],
  loadActiveFolioIdFromIdb: async () => "f1",
  loadFolioContentFromIdb: async () => SAMPLE_HTML,
  loadFolioContentSnapshotFromIdb: async () => ({
    folioId: "f1",
    html: SAMPLE_HTML,
    updatedAt: 2,
  }),
  loadPersonasFromIdb: async () => [],
  loadDraftHtmlFromIdb: async () => "",
  loadLixBlobFromIdb: async () => lixBlobFromIdb,
  // Write paths convex-sync imports but our tests never hit — safe no-ops.
  saveFoliosToIdb: async () => {},
  saveBriefToIdb: async () => {},
  saveFolioContentToIdb: async () => {},
  savePersonasToIdb: async () => {},
  saveDraftHtmlToIdb: async () => {},
  loadRubricResultFromIdb: async () => null,
  saveRubricResultToIdb: async () => {},
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
  readFileAsJson: async (path: string) => lixFiles.get(path) ?? null,
  writeFileAsJson: async (path: string, value: unknown) => {
    lixFiles.set(path, value);
    writtenLixFiles.push({ path, value });
  },
  persistToIdb: async () => {},
}));

const {
  setConvexSyncContext,
  clearConvexSyncContext,
  flushNow,
  syncToConvex,
  loadFromConvex,
  mergeBibliographyEntries,
} = await import("./convex-sync");

interface RecordingClient {
  mutationCalls: Array<Record<string, unknown>>;
  queryCalls: Array<Record<string, unknown>>;
  query: (...args: unknown[]) => Promise<unknown>;
  mutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

function emptyRemoteSnapshot(): SyncedSnapshot {
  return {
    briefs: [],
    legacyBrief: null,
    legacyBriefUpdatedAt: 0,
    folios: [],
    foliosUpdatedAt: 0,
    folioContent: [],
    customPersonas: null,
    customPersonasUpdatedAt: 0,
    personaNotes: [],
    personaReplies: [],
    rubricResults: [],
    bibliography: [],
    bibliographyUpdatedAt: 0,
  };
}

interface SyncedSnapshot {
  briefs: Array<{
    folioId: string;
    brief: ProjectBrief;
    updatedAt: number;
  }>;
  legacyBrief: ProjectBrief | null;
  legacyBriefUpdatedAt: number;
  folios: typeof SAMPLE_FOLIOS;
  foliosUpdatedAt: number;
  folioContent: Array<{ folioId: string; html: string; updatedAt: number }>;
  customPersonas: unknown[] | null;
  customPersonasUpdatedAt: number;
  personaNotes: unknown[];
  personaReplies: unknown[];
  rubricResults: Array<{
    folioId?: string;
    result: RubricResult;
    updatedAt: number;
  }>;
  bibliography: BibEntry[];
  bibliographyUpdatedAt: number;
}

function makeClient(
  opts: {
    fail?: boolean;
    queryResult?: unknown;
    queryResults?: unknown[];
  } = {},
): RecordingClient {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const queryCalls: Array<Record<string, unknown>> = [];
  const queryResults = [...(opts.queryResults ?? [])];
  return {
    mutationCalls,
    queryCalls,
    query: async (_ref, args) => {
      queryCalls.push((args ?? {}) as Record<string, unknown>);
      return queryResults.length > 0
        ? queryResults.shift()
        : (opts.queryResult ?? null);
    },
    mutation: async (_ref, args) => {
      mutationCalls.push(args);
      if (opts.fail) throw new Error("network down");
      return null;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  clearConvexSyncContext();
  lixFiles.clear();
  writtenLixFiles.length = 0;
  localStorageShim.clear();
  lixBlobFromIdb = null;
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
    client.mutationCalls.length = 0; // isolate the explicit flush below

    await flushNow();

    expect(client.mutationCalls.length).toBe(1);
    const payload = client.mutationCalls[0];
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

    expect(client.mutationCalls.length).toBe(0);
  });

  test("sends bibliography entries in the normal pushAll payload", async () => {
    lixFiles.set(BIBLIOGRAPHY_PATH, SAMPLE_BIBLIOGRAPHY);
    const client = makeClient();
    setConvexSyncContext(client as never, "user-3");
    await tick();
    client.mutationCalls.length = 0;

    await flushNow();

    expect(client.mutationCalls[0].bibliography).toEqual(SAMPLE_BIBLIOGRAPHY);
  });

  test("merges pulled bibliography entries into local Lix state", async () => {
    const local: BibEntry = {
      ...SAMPLE_BIBLIOGRAPHY[0],
      id: "local-only",
      title: "Local source",
    };
    const remote: BibEntry = {
      ...SAMPLE_BIBLIOGRAPHY[0],
      id: "remote-only",
      title: "Remote source",
    };
    lixFiles.set(BIBLIOGRAPHY_PATH, [local]);
    const client = makeClient({
      queryResult: {
        ...emptyRemoteSnapshot(),
        bibliography: [remote],
        bibliographyUpdatedAt: 20,
      },
    });

    setConvexSyncContext(client as never, "user-4");
    await tick();

    expect(lixFiles.get(BIBLIOGRAPHY_PATH)).toEqual([local, remote]);
    expect(writtenLixFiles).toContainEqual({
      path: BIBLIOGRAPHY_PATH,
      value: [local, remote],
    });
  });

  test("uses remote bibliography entries when they are newer for the same id", () => {
    const older = { ...SAMPLE_BIBLIOGRAPHY[0], title: "Older", createdAt: 1 };
    const newer = { ...SAMPLE_BIBLIOGRAPHY[0], title: "Newer", createdAt: 2 };

    expect(mergeBibliographyEntries([older], [newer])).toEqual([newer]);
  });

  test("does not send caller-supplied user ids to lix blob functions", async () => {
    const blob = new Blob(["lix"]);
    lixBlobFromIdb = blob;
    const client = makeClient({
      queryResults: [emptyRemoteSnapshot(), { blob: await blob.arrayBuffer() }],
    });
    setConvexSyncContext(client as never, "user-5");
    await tick();
    client.mutationCalls.length = 0;
    client.queryCalls.length = 0;

    await syncToConvex();
    await loadFromConvex();

    expect(client.mutationCalls.at(-1)).toEqual({
      blob: expect.any(ArrayBuffer),
    });
    expect(client.queryCalls.at(-1)).toEqual({});
  });
});
