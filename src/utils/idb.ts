/**
 * IndexedDB layer for Twyne. Browser-only — every public function
 * returns safe defaults (empty array / null) when `window` is undefined.
 *
 * Schema lives in a single `twyne` database. Object stores:
 *   - `folios`            : keyPath "id"
 *   - `folio-content`     : keyPath "folioId"  (html body of each folio)
 *   - `brief`             : keyPath "folioId"  (the project brief, per folio)
 *   - `comments`          : keyPath "id"       (user inline comments)
 *   - `personas`          : keyPath "id"       (writer's saved persona set)
 *   - `meta`              : keyPath "key"      (active folio id, etc.)
 *   - `ai-settings`       : keyPath "key"      (single "current" key)
 *   - `lix-blob`          : keyPath "key"      (single "current" key)
 *
 * The DB version is bumped in `openDb()` when a migration is required;
 * see the `migrate` callback for the upgrade body.
 */

import type {
  Folio,
  AiSettings,
  WriterSettings,
  ApparatusSettings,
  Persona,
  RubricResult,
  RoomAnalysis,
  ProjectBrief,
} from "../types";
import {
  DEFAULT_APPARATUS_SETTINGS,
  DEFAULT_WRITER_PROFILE,
  DEFAULT_WRITER_SETTINGS,
} from "../types";

const DB_NAME = "twyne";
/**
 * Bumped to 2 to add the `voice-notes` store. The upgrade handler creates
 * every store conditionally, so this is purely additive for existing writers:
 * nothing already in the database is touched.
 */
const DB_VERSION = 2;
const AI_SETTINGS_STORAGE_KEY = "twyne.ai-settings.current";
const WRITER_SETTINGS_STORAGE_KEY = "twyne.writer-settings.current";
const APPARATUS_SETTINGS_STORAGE_KEY = "twyne.apparatus-settings.current";
const WRITER_SETTINGS_META_KEY = "writer-settings";
const APPARATUS_SETTINGS_META_KEY = "apparatus-settings";

export interface FolioContentSnapshot {
  folioId: string;
  html: string;
  updatedAt: number;
}

interface BriefRecord {
  folioId: string;
  brief: unknown;
  updatedAt: number;
}

interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

/* ── Database lifecycle ─────────────────────────────────────────── */

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("folios")) {
        db.createObjectStore("folios", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("folio-content")) {
        db.createObjectStore("folio-content", { keyPath: "folioId" });
      }
      if (!db.objectStoreNames.contains("brief")) {
        db.createObjectStore("brief", { keyPath: "folioId" });
      }
      if (!db.objectStoreNames.contains("comments")) {
        db.createObjectStore("comments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("personas")) {
        db.createObjectStore("personas", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("ai-settings")) {
        db.createObjectStore("ai-settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("lix-blob")) {
        db.createObjectStore("lix-blob", { keyPath: "key" });
      }
      // v2: recorded voice notes, kept as Blobs alongside the transcripts
      // that live on the comments they are attached to.
      if (!db.objectStoreNames.contains("voice-notes")) {
        db.createObjectStore("voice-notes", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });

  // Reset the cached promise on failure so the next call can retry.
  _dbPromise.catch(() => {
    _dbPromise = null;
  });

  return _dbPromise;
}

function isBrowser(): boolean {
  return hasWindow() && hasIndexedDb();
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function getLocalStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} | null {
  if (typeof globalThis.localStorage !== "undefined") {
    return globalThis.localStorage;
  }
  if (hasWindow() && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return null;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function readLocalStorageJson<T>(key: string): T | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocalStorageJson(key: string, value: unknown): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function normalizeWriterSettings(value: unknown): WriterSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_WRITER_SETTINGS };
  }
  const v = value as Partial<WriterSettings>;
  const profile =
    v.profile && typeof v.profile === "object"
      ? (v.profile as Partial<WriterSettings["profile"]>)
      : {};
  return {
    interviewStyle:
      v.interviewStyle === "conversational" ? "conversational" : "form",
    profile: {
      displayName:
        typeof profile.displayName === "string"
          ? profile.displayName.slice(0, 120)
          : DEFAULT_WRITER_PROFILE.displayName,
      personalFacts:
        typeof profile.personalFacts === "string"
          ? profile.personalFacts.slice(0, 4000)
          : DEFAULT_WRITER_PROFILE.personalFacts,
      feedbackStyle:
        profile.feedbackStyle === "direct" || profile.feedbackStyle === "gentle"
          ? profile.feedbackStyle
          : DEFAULT_WRITER_PROFILE.feedbackStyle,
      feedbackNotes:
        typeof profile.feedbackNotes === "string"
          ? profile.feedbackNotes.slice(0, 2000)
          : DEFAULT_WRITER_PROFILE.feedbackNotes,
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

async function tx<T>(
  store: string | string[],
  mode: IDBTransactionMode,
  body: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result: T;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    Promise.resolve(body(t)).then((r) => {
      result = r;
    }, reject);
  });
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ── Folios ─────────────────────────────────────────────────────── */

export async function loadFoliosFromIdb(): Promise<Folio[]> {
  if (!isBrowser()) return [];
  try {
    const db = await openDb();
    return reqAsPromise<Folio[]>(
      db.transaction("folios").objectStore("folios").getAll(),
    );
  } catch {
    return [];
  }
}

export async function saveFoliosToIdb(folios: Folio[]): Promise<void> {
  if (!isBrowser()) return;
  try {
    await tx("folios", "readwrite", async (t) => {
      const store = t.objectStore("folios");
      for (const f of folios) store.put(f);
    });
  } catch {
    /* swallow — write failure shouldn't crash the writer */
  }
}

export async function deleteFolioFromIdb(id: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    await tx(["folios", "folio-content"], "readwrite", async (t) => {
      t.objectStore("folios").delete(id);
      t.objectStore("folio-content").delete(id);
    });
  } catch {
    /* ignore */
  }
}

/* ── Folio content (the HTML body) ──────────────────────────────── */

export async function loadFolioContentFromIdb(
  folioId: string,
): Promise<string> {
  return (await loadFolioContentSnapshotFromIdb(folioId))?.html ?? "";
}

/** Read both the manuscript and its local revision stamp for sync conflicts. */
export async function loadFolioContentSnapshotFromIdb(
  folioId: string,
): Promise<FolioContentSnapshot | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<FolioContentSnapshot | undefined>(
        db
          .transaction("folio-content")
          .objectStore("folio-content")
          .get(folioId),
      )) ?? null;
    return rec;
  } catch {
    return null;
  }
}

export async function saveFolioContentToIdb(
  folioId: string,
  html: string,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: FolioContentSnapshot = {
      folioId,
      html,
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("folio-content", "readwrite")
        .objectStore("folio-content")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

export async function loadDraftHtmlFromIdb(folioId: string): Promise<string> {
  return loadFolioContentFromIdb(folioId);
}

export async function saveDraftHtmlToIdb(
  folioId: string,
  html: string,
): Promise<void> {
  return saveFolioContentToIdb(folioId, html);
}

/* ── Briefs (per folio) ─────────────────────────────────────────── */

export async function loadBriefFromIdb(
  folioId: string,
): Promise<ProjectBrief | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<BriefRecord | undefined>(
        db.transaction("brief").objectStore("brief").get(folioId),
      )) ?? null;
    return (rec?.brief as ProjectBrief | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveBriefToIdb(
  folioId: string,
  brief: ProjectBrief,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: BriefRecord = { folioId, brief, updatedAt: Date.now() };
    await reqAsPromise(
      (await openDb())
        .transaction("brief", "readwrite")
        .objectStore("brief")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

export async function loadAllBriefsFromIdb(): Promise<
  Array<{ folioId: string; brief: ProjectBrief; updatedAt: number }>
> {
  if (!isBrowser()) return [];
  try {
    const db = await openDb();
    const records = await reqAsPromise<BriefRecord[]>(
      db.transaction("brief").objectStore("brief").getAll(),
    );
    return records
      .filter((record): record is BriefRecord & { brief: ProjectBrief } =>
        Boolean(record.folioId && record.brief),
      )
      .map((record) => ({
        folioId: record.folioId,
        brief: record.brief,
        updatedAt: record.updatedAt,
      }));
  } catch {
    return [];
  }
}

export async function deleteBriefFromIdb(folioId: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    await reqAsPromise(
      (await openDb())
        .transaction("brief", "readwrite")
        .objectStore("brief")
        .delete(folioId),
    );
  } catch {
    /* ignore */
  }
}

/* ── Active folio id (single record) ────────────────────────────── */

export async function loadActiveFolioIdFromIdb(): Promise<string | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db.transaction("meta").objectStore("meta").get("active-folio-id"),
      )) ?? null;
    return typeof rec?.value === "string" ? rec.value : null;
  } catch {
    return null;
  }
}

export async function saveActiveFolioIdToIdb(id: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = {
      key: "active-folio-id",
      value: id,
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

/* ── Personas ───────────────────────────────────────────────────── */

export async function loadPersonasFromIdb(): Promise<Persona[]> {
  if (!isBrowser()) return [];
  try {
    const db = await openDb();
    return reqAsPromise<Persona[]>(
      db.transaction("personas").objectStore("personas").getAll(),
    );
  } catch {
    return [];
  }
}

export async function savePersonasToIdb(personas: Persona[]): Promise<void> {
  if (!isBrowser()) return;
  try {
    await tx("personas", "readwrite", async (t) => {
      const store = t.objectStore("personas");
      store.clear();
      for (const p of personas) store.put(p);
    });
  } catch {
    /* ignore */
  }
}

/* ── AI settings (single record, key="current") ─────────────────── */

/* ── Writer settings (single record, key="current") ───────────── */

export async function loadWriterSettingsFromIdb(): Promise<WriterSettings> {
  if (!getLocalStorage() && !hasIndexedDb())
    return { ...DEFAULT_WRITER_SETTINGS };
  const local = readLocalStorageJson<unknown>(WRITER_SETTINGS_STORAGE_KEY);
  if (local) return normalizeWriterSettings(local);
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      const rec =
        (await reqAsPromise<MetaRecord | undefined>(
          db
            .transaction("meta")
            .objectStore("meta")
            .get(WRITER_SETTINGS_META_KEY),
        )) ?? null;
      if (rec?.value) {
        return normalizeWriterSettings(rec.value);
      }
    } catch {
      /* fall through to localStorage */
    }
  }
  return { ...DEFAULT_WRITER_SETTINGS };
}

export async function saveWriterSettingsToIdb(
  settings: WriterSettings,
): Promise<void> {
  if (!getLocalStorage() && !hasIndexedDb()) return;
  const normalized = normalizeWriterSettings(settings);
  writeLocalStorageJson(WRITER_SETTINGS_STORAGE_KEY, normalized);
  if (!hasIndexedDb()) return;
  try {
    const rec: MetaRecord = {
      key: WRITER_SETTINGS_META_KEY,
      value: normalized,
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

export async function loadApparatusSettingsFromIdb(): Promise<ApparatusSettings> {
  if (!getLocalStorage() && !hasIndexedDb()) {
    return { ...DEFAULT_APPARATUS_SETTINGS };
  }
  const local = readLocalStorageJson<unknown>(APPARATUS_SETTINGS_STORAGE_KEY);
  if (local) return normalizeApparatusSettings(local);
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      const rec =
        (await reqAsPromise<MetaRecord | undefined>(
          db
            .transaction("meta")
            .objectStore("meta")
            .get(APPARATUS_SETTINGS_META_KEY),
        )) ?? null;
      if (rec?.value) {
        return normalizeApparatusSettings(rec.value);
      }
    } catch {
      /* fall through to localStorage */
    }
  }
  return { ...DEFAULT_APPARATUS_SETTINGS };
}

export async function saveApparatusSettingsToIdb(
  settings: ApparatusSettings,
): Promise<void> {
  if (!getLocalStorage() && !hasIndexedDb()) return;
  const normalized = normalizeApparatusSettings(settings);
  writeLocalStorageJson(APPARATUS_SETTINGS_STORAGE_KEY, normalized);
  if (!hasIndexedDb()) return;
  try {
    const rec: MetaRecord = {
      key: APPARATUS_SETTINGS_META_KEY,
      value: normalized,
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

function folioMetaKey(base: string, folioId?: string | null): string {
  return folioId ? `${base}:${folioId}` : base;
}

export async function loadRubricResultFromIdb(
  folioId?: string | null,
): Promise<RubricResult | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db
          .transaction("meta")
          .objectStore("meta")
          .get(folioMetaKey("rubric-result", folioId)),
      )) ?? null;
    if (!rec?.value || typeof rec.value !== "object") return null;
    return rec.value as RubricResult;
  } catch {
    return null;
  }
}

export async function saveRubricResultToIdb(
  result: RubricResult,
  folioId?: string | null,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = {
      key: folioMetaKey("rubric-result", folioId),
      value: { ...result, ...(folioId ? { folioId } : {}) },
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

export async function loadRoomAnalysisFromIdb(
  folioId?: string | null,
): Promise<RoomAnalysis | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db
          .transaction("meta")
          .objectStore("meta")
          .get(folioMetaKey("room-analysis", folioId)),
      )) ?? null;
    if (!rec?.value || typeof rec.value !== "object") return null;
    return rec.value as RoomAnalysis;
  } catch {
    return null;
  }
}

export async function saveRoomAnalysisToIdb(
  analysis: RoomAnalysis,
  folioId?: string | null,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = {
      key: folioMetaKey("room-analysis", folioId),
      value: { ...analysis, ...(folioId ? { folioId } : {}) },
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

/* ── Generic meta access (arbitrary key/value in `meta`) ──────── */

/** Read any value previously stored in the `meta` store, or null. */
export async function loadMetaFromIdb<T = unknown>(
  key: string,
): Promise<T | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db.transaction("meta").objectStore("meta").get(key),
      )) ?? null;
    if (rec?.value === undefined || rec?.value === null) return null;
    return rec.value as T;
  } catch {
    return null;
  }
}

/** Write any JSON-serialisable value into the `meta` store under `key`. */
export async function saveMetaToIdb(
  key: string,
  value: unknown,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = { key, value, updatedAt: Date.now() };
    await reqAsPromise(
      (await openDb())
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

/* ── AI settings (single record, key="current") ──────────────── */

export async function loadAiSettingsFromIdb(): Promise<AiSettings | null> {
  if (!getLocalStorage() && !hasIndexedDb()) return null;
  const local = readLocalStorageJson<AiSettings>(AI_SETTINGS_STORAGE_KEY);
  if (local) return local;
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      const rec =
        (await reqAsPromise<MetaRecord | undefined>(
          db
            .transaction("ai-settings")
            .objectStore("ai-settings")
            .get("current"),
        )) ?? null;
      const value = (rec?.value as AiSettings | undefined) ?? null;
      if (value) return value;
    } catch {
      // Fall through to localStorage.
    }
  }
  return null;
}

/**
 * Announce that the AI settings changed.
 *
 * The orchestrator memoises the settings for the life of the page, so a key
 * added on the Settings route was invisible to every feature until a reload —
 * which is how a writer with a perfectly good OpenAI key ended up on the
 * hosted path being told they were not signed in. An event rather than a
 * direct call because `ai-orchestrator` already imports this module.
 */
function announceAiSettingsSaved(): void {
  if (typeof window === "undefined") return;
  if (typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("twyne:ai-settings-saved"));
}

export async function saveAiSettingsToIdb(settings: AiSettings): Promise<void> {
  if (!getLocalStorage() && !hasIndexedDb()) return;
  writeLocalStorageJson(AI_SETTINGS_STORAGE_KEY, settings);
  announceAiSettingsSaved();
  if (!hasIndexedDb()) return;
  try {
    const rec: MetaRecord = {
      key: "current",
      value: settings,
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("ai-settings", "readwrite")
        .objectStore("ai-settings")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

/* ── Lix blob (the versioned draft store) ───────────────────────── */

/* ── Voice notes (recorded audio, kept beside its transcript) ───── */

interface VoiceNoteRecord {
  id: string;
  blob: Blob;
  updatedAt: number;
}

export async function saveVoiceNoteBlob(id: string, blob: Blob): Promise<void> {
  if (!isBrowser()) return;
  const rec: VoiceNoteRecord = { id, blob, updatedAt: Date.now() };
  await tx("voice-notes", "readwrite", (t) => {
    t.objectStore("voice-notes").put(rec);
  });
}

export async function loadVoiceNoteBlob(id: string): Promise<Blob | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec = await reqAsPromise<VoiceNoteRecord | undefined>(
      db.transaction("voice-notes").objectStore("voice-notes").get(id),
    );
    return rec?.blob instanceof Blob ? rec.blob : null;
  } catch {
    return null;
  }
}

export async function deleteVoiceNoteBlob(id: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    await tx("voice-notes", "readwrite", (t) => {
      t.objectStore("voice-notes").delete(id);
    });
  } catch {
    // The transcript is the record of consequence; a stranded blob is not
    // worth failing a delete over.
  }
}

export async function loadLixBlobFromIdb(): Promise<Blob | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db.transaction("lix-blob").objectStore("lix-blob").get("current"),
      )) ?? null;
    const v = rec?.value;
    if (v instanceof Blob) return v;
    if (v instanceof ArrayBuffer) return new Blob([v]);
    if (v instanceof Uint8Array) return new Blob([v]);
    return null;
  } catch {
    return null;
  }
}

export async function saveLixBlobToIdb(blob: Blob): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = {
      key: "current",
      value: blob,
      updatedAt: Date.now(),
    };
    await reqAsPromise(
      (await openDb())
        .transaction("lix-blob", "readwrite")
        .objectStore("lix-blob")
        .put(rec),
    );
  } catch {
    /* ignore */
  }
}

/* ── Comments (inline user comments) ─────────────────────────────── */

export async function loadCommentsFromIdb(): Promise<unknown[]> {
  if (!isBrowser()) return [];
  try {
    const db = await openDb();
    return reqAsPromise<unknown[]>(
      db.transaction("comments").objectStore("comments").getAll(),
    );
  } catch {
    return [];
  }
}

export async function saveCommentsToIdb(comments: unknown[]): Promise<void> {
  if (!isBrowser()) return;
  try {
    await tx("comments", "readwrite", async (t) => {
      const store = t.objectStore("comments");
      store.clear();
      for (const c of comments) store.put(c);
    });
  } catch {
    /* ignore */
  }
}

/* ── Wipe (debug + privacy) ─────────────────────────────────────── */

export async function clearIdbStore(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    const stores = Array.from(db.objectStoreNames);
    await tx(stores, "readwrite", async (t) => {
      for (const name of stores) t.objectStore(name).clear();
    });
  } catch {
    /* ignore */
  }
}
