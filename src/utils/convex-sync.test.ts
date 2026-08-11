import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { api } from "../../convex/_generated/api";
import {
  DEFAULT_APPARATUS_SETTINGS,
  DEFAULT_WRITER_SETTINGS,
  type AiSettings,
  type ApparatusSettings,
  type PersonaFeedback,
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
/** Mutable view of the folio store — tests shrink it to model a deletion. */
let foliosStore = [...SAMPLE_FOLIOS];
/** Mutable view of the active-folio pointer — cleared when its folio leaves. */
let activeFolioIdForTest: string | null = "f1";
const SAMPLE_HTML = "<p>hello from the folio</p>";
/** The draft as it currently stands locally. Tests move it to model typing. */
let folioHtml = SAMPLE_HTML;
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
const WRITING_ACTIVITY_FN = getFunctionName(api.writingActivity.recordActivity);
const lixFiles = new Map<string, unknown>();
const metaStore = new Map<string, unknown>();
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
  const rawMax =
    typeof v.maxResults === "number"
      ? v.maxResults
      : DEFAULT_APPARATUS_SETTINGS.maxResults;
  const maxResults = Number.isFinite(rawMax)
    ? Math.round(rawMax)
    : DEFAULT_APPARATUS_SETTINGS.maxResults;
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
      v.researchProvider === "search-api" ||
      v.researchProvider === "model-web-search" ||
      v.researchProvider === "web-mcp"
        ? v.researchProvider
        : DEFAULT_APPARATUS_SETTINGS.researchProvider,
    searchBackend: v.searchBackend
      ? { ...v.searchBackend }
      : { ...DEFAULT_APPARATUS_SETTINGS.searchBackend },
    maxResults: Math.max(1, Math.min(20, maxResults)),
    mcpServers: Array.isArray(v.mcpServers) ? [...v.mcpServers] : [],
  };
}

// Stub the local storage layers buildLocalSnapshot() reads from.
mock.module("./idb", () => ({
  // Read paths used by buildLocalSnapshot()
  loadFoliosFromIdb: async () => foliosStore,
  loadAllBriefsFromIdb: async () => [],
  loadActiveFolioIdFromIdb: async () => activeFolioIdForTest,
  loadFolioContentFromIdb: async () => folioHtml,
  loadFolioContentSnapshotFromIdb: async () => ({
    folioId: "f1",
    html: folioHtml,
    updatedAt: 2,
  }),
  loadPersonasFromIdb: async () => [],
  loadDraftHtmlFromIdb: async () => "",
  loadLixBlobFromIdb: async () => lixBlobFromIdb,
  // Write paths convex-sync imports but our tests never hit — safe no-ops.
  saveFoliosToIdb: async (folios: typeof SAMPLE_FOLIOS) => {
    foliosStore = [...folios];
  },
  deleteFolioFromIdb: async (id: string) => {
    foliosStore = foliosStore.filter((folio) => folio.id !== id);
  },
  saveBriefToIdb: async () => {},
  deleteBriefFromIdb: async () => {},
  saveFolioContentToIdb: async (_folioId: string, html: string) => {
    folioHtml = html;
  },
  deleteFolioContentFromIdb: async () => {
    folioHtml = "";
  },
  savePersonasToIdb: async () => {},
  saveDraftHtmlToIdb: async () => {},
  loadRubricResultFromIdb: async () => null,
  saveRubricResultToIdb: async () => {},
  deleteRubricResultFromIdb: async () => {},
  saveActiveFolioIdToIdb: async (id: string) => {
    activeFolioIdForTest = id;
  },
  clearActiveFolioIdFromIdb: async () => {
    activeFolioIdForTest = null;
  },
  clearIdbStore: async () => {},
  loadMetaFromIdb: async <T>(key: string) =>
    (metaStore.get(key) as T | undefined) ?? null,
  saveMetaToIdb: async (key: string, value: unknown) => {
    metaStore.set(key, value);
  },
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
  markDirty,
  syncToConvex,
  loadFromConvex,
  mergeBibliographyEntries,
} = await import("./convex-sync");

interface RecordingClient {
  mutationCalls: Array<Record<string, unknown>>;
  queryCalls: Array<Record<string, unknown>>;
  query: (...args: unknown[]) => Promise<unknown>;
  mutation: (
    ref: Parameters<typeof getFunctionName>[0],
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

function emptyRemoteSnapshot(): SyncedSnapshot {
  return {
    syncRevision: 0,
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
  syncRevision: number;
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
    mutation: async (ref, args) => {
      // `recordWritingActivity` fires an unrelated telemetry ping through the
      // same client. It is throttled to once every two minutes, so whether it
      // lands inside a given test depends on which test ran first — recording
      // it here made the sync assertions order-dependent. Only sync mutations
      // are interesting to these tests.
      //
      // Compared by name because `api` is a Proxy that mints a fresh object on
      // every property access, so `ref === api.x.y` is never true.
      if (getFunctionName(ref) !== WRITING_ACTIVITY_FN) {
        mutationCalls.push(args);
      }
      if (opts.fail) throw new Error("network down");
      return null;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  clearConvexSyncContext();
  lixFiles.clear();
  metaStore.clear();
  writtenLixFiles.length = 0;
  localStorageShim.clear();
  lixBlobFromIdb = null;
  folioHtml = SAMPLE_HTML;
  foliosStore = [...SAMPLE_FOLIOS];
  activeFolioIdForTest = "f1";
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
    await tick(); // the sign-in push is the one that carries everything

    expect(client.mutationCalls.length).toBe(1);
    const payload = client.mutationCalls[0];
    expect(payload.folios).toEqual(SAMPLE_FOLIOS);
    expect(payload.folioContent).toEqual([
      { folioId: "f1", html: SAMPLE_HTML },
    ]);
  });

  test("a flush with nothing changed never reaches the server", async () => {
    const client = makeClient();
    setConvexSyncContext(client as never, "user-unchanged");
    await tick();
    expect(client.mutationCalls.length).toBe(1);

    // The old behaviour: every four seconds of typing rewrote every folio,
    // every note and every reply, whether or not any of them had moved.
    await flushNow();
    await flushNow();

    expect(client.mutationCalls.length).toBe(1);
  });

  test("a changed draft is sent without the folios that did not change", async () => {
    const client = makeClient();
    setConvexSyncContext(client as never, "user-typing");
    await tick();

    folioHtml = "<p>hello from the folio, revised</p>";
    await flushNow();

    expect(client.mutationCalls.length).toBe(2);
    const payload = client.mutationCalls[1];
    expect(payload.folioContent).toEqual([
      { folioId: "f1", html: "<p>hello from the folio, revised</p>" },
    ]);
    // Untouched sections are absent rather than empty: `pushAll` leaves a
    // missing argument alone, and that is what makes a partial push safe.
    expect(payload.folios).toBeUndefined();
    expect(payload.bibliography).toBeUndefined();
    expect(payload.personaNotes).toBeUndefined();
  });

  test("a push that failed is carried by the next one, not forgotten", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let failing = true;
    const client = {
      query: async () => null,
      mutation: async (_ref: unknown, args: Record<string, unknown>) => {
        calls.push(args);
        if (failing) throw new Error("network down");
        return null;
      },
    };

    setConvexSyncContext(client as never, "user-offline");
    await tick();
    expect(calls.length).toBe(1);

    // The server never acknowledged that payload, so the next push has to
    // assume it holds nothing — diffing against an unlanded push is how a
    // draft goes missing.
    failing = false;
    folioHtml = "<p>written while the network was down</p>";
    await flushNow();

    expect(calls.length).toBe(2);
    expect(calls[1].folios).toEqual(SAMPLE_FOLIOS);
    expect(calls[1].folioContent).toEqual([
      { folioId: "f1", html: "<p>written while the network was down</p>" },
    ]);
  });

  test("a stale device pulls, merges, and retries against the latest revision", async () => {
    const mutationCalls: Array<Record<string, unknown>> = [];
    const queryResults = [
      {
        ...emptyRemoteSnapshot(),
        syncRevision: 1,
        folios: SAMPLE_FOLIOS,
        foliosUpdatedAt: 2,
        folioContent: [
          { folioId: "f1", html: SAMPLE_HTML, updatedAt: 2 },
        ],
      },
      {
        ...emptyRemoteSnapshot(),
        syncRevision: 3,
        folios: SAMPLE_FOLIOS,
        foliosUpdatedAt: 2,
        folioContent: [
          { folioId: "f1", html: SAMPLE_HTML, updatedAt: 2 },
        ],
      },
    ];
    let syncMutation = 0;
    const client = {
      query: async () => queryResults.shift() ?? emptyRemoteSnapshot(),
      mutation: async (
        ref: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>,
      ) => {
        if (getFunctionName(ref) === WRITING_ACTIVITY_FN) return null;
        mutationCalls.push(args);
        syncMutation += 1;
        if (syncMutation === 1) return { revision: 2 };
        if (syncMutation === 2) {
          throw { data: { code: "SYNC_CONFLICT" } };
        }
        return { revision: 4 };
      },
    };

    setConvexSyncContext(client as never, "user-stale-device");
    await tick();
    await tick();
    expect(mutationCalls[0].expectedRevision).toBe(1);

    folioHtml = "<p>the local revision survives reconciliation</p>";
    markDirty(["folioContent"]);
    await flushNow();
    await tick();
    await tick();

    expect(mutationCalls[1].expectedRevision).toBe(2);
    expect(mutationCalls[2].expectedRevision).toBe(3);
    expect(mutationCalls[2].folioContent).toEqual([
      {
        folioId: "f1",
        html: "<p>the local revision survives reconciliation</p>",
      },
    ]);
  });

  test("a clean device applies reactive remote edits without echoing them back", async () => {
    const subscription: {
      onRemote: ((snapshot: SyncedSnapshot) => void) | null;
    } = { onRemote: null };
    const mutationCalls: Array<Record<string, unknown>> = [];
    const initial = {
      ...emptyRemoteSnapshot(),
      syncRevision: 1,
      folios: SAMPLE_FOLIOS,
      foliosUpdatedAt: 2,
      folioContent: [{ folioId: "f1", html: SAMPLE_HTML, updatedAt: 2 }],
    };
    const client = {
      query: async () => initial,
      mutation: async (
        ref: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>,
      ) => {
        if (getFunctionName(ref) === WRITING_ACTIVITY_FN) return null;
        mutationCalls.push(args);
        return { revision: 2 };
      },
      onUpdate: (
        _ref: unknown,
        _args: unknown,
        callback: (snapshot: SyncedSnapshot) => void,
      ) => {
        subscription.onRemote = callback;
        return () => {
          subscription.onRemote = null;
        };
      },
    };

    setConvexSyncContext(client as never, "user-reactive");
    await tick();
    await tick();
    expect(subscription.onRemote).not.toBeNull();
    const callsBeforeRemote = mutationCalls.length;

    const remoteHtml = "<p>edited on the other device</p>";
    subscription.onRemote?.({
      ...initial,
      syncRevision: 3,
      folioContent: [{ folioId: "f1", html: remoteHtml, updatedAt: 3 }],
    });
    await tick();
    await tick();

    expect(folioHtml).toBe(remoteHtml);
    await flushNow();
    expect(mutationCalls).toHaveLength(callsBeforeRemote);

    subscription.onRemote?.({
      ...emptyRemoteSnapshot(),
      syncRevision: 4,
    });
    await tick();
    await tick();
    expect(foliosStore).toEqual([]);
    expect(activeFolioIdForTest).toBeNull();
    expect(folioHtml).toBe("");
    await flushNow();
    expect(mutationCalls).toHaveLength(callsBeforeRemote);
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

  test("a locally deleted persona note is removed on the server, not re-sent", async () => {
    // Seed a persona note through the lix layer so the first push carries it.
    const note: PersonaFeedback = {
      folioId: "f1",
      noteId: "pn-f1",
      personaId: "p1",
      personaName: "Reader",
      personaColor: "blue",
      type: "critique",
      feedback: "This passage needs a source.",
      timestamp: 1,
    };
    lixFiles.set("/folios/f1/persona-notes.json", [note]);

    const client = makeClient();
    setConvexSyncContext(client as never, "user-delete");
    await tick();
    expect(client.mutationCalls.length).toBe(1);
    expect(client.mutationCalls[0].personaNotes).toContainEqual(
      expect.objectContaining({ noteId: "pn-f1" }),
    );
    expect(client.mutationCalls[0].removedPersonaNoteIds).toBeUndefined();

    // The writer clears the note. The next push must tell the server the note
    // is gone — otherwise pullAll would resurrect it as a ghost.
    lixFiles.set("/folios/f1/persona-notes.json", []);
    markDirty(["personaNotes"]);
    await flushNow();

    expect(client.mutationCalls.length).toBe(2);
    const payload = client.mutationCalls[1];
    expect(payload.personaNotes).toBeUndefined();
    expect(payload.removedPersonaNoteIds).toEqual(["pn-f1"]);
  });

  test("a folio removed from the archive drops its scoped rows, not the whole cache", async () => {
    const client = makeClient();
    setConvexSyncContext(client as never, "user-folio-delete");
    await tick();
    // First push establishes the acknowledged baseline: folio f1 with content.
    expect(client.mutationCalls[0].folios).toEqual(SAMPLE_FOLIOS);
    expect(client.mutationCalls[0].folioContent).toEqual([
      { folioId: "f1", html: SAMPLE_HTML },
    ]);

    // The folio leaves the archive. Only folios is marked dirty — a ruthless
    // deletion UI wouldn't bother pointing at each folio-scoped section.
    foliosStore = [];
    activeFolioIdForTest = null;
    markDirty(["folios"]);
    await flushNow();

    // The folio's own row went up whole (the folios section is whole when it
    // is sent at all), and its scoped rows were dropped as removed. The f1
    // manuscript must not ride along as if it still belonged to a folio.
    expect(client.mutationCalls[1].folios).toEqual([]);
    expect(client.mutationCalls[1].folioContent).toBeUndefined();
    expect(client.mutationCalls[1].removedFolioContentIds).toEqual(["f1"]);
  });
});
