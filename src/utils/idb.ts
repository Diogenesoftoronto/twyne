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
} from "../types";
import { DEFAULT_APPARATUS_SETTINGS, DEFAULT_WRITER_SETTINGS } from "../types";

const DB_NAME = "twyne";
const DB_VERSION = 1;
const AI_SETTINGS_STORAGE_KEY = "twyne.ai-settings.current";
const WRITER_SETTINGS_STORAGE_KEY = "twyne.writer-settings.current";
const APPARATUS_SETTINGS_STORAGE_KEY = "twyne.apparatus-settings.current";
const WRITER_SETTINGS_META_KEY = "writer-settings";
const APPARATUS_SETTINGS_META_KEY = "apparatus-settings";

interface FolioContent {
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

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function readLocalStorageJson<T>(key: string): T | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocalStorageJson(key: string, value: unknown): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function normalizeWriterSettings(value: unknown): WriterSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_WRITER_SETTINGS };
  }
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
  return {
    defaultCitationStyle:
      v.defaultCitationStyle === "apa" ||
      v.defaultCitationStyle === "chicago" ||
      v.defaultCitationStyle === "mla"
        ? v.defaultCitationStyle
        : DEFAULT_APPARATUS_SETTINGS.defaultCitationStyle,
    aiEnhanceCitations: v.aiEnhanceCitations === true,
    flagMissingSources: v.flagMissingSources === true,
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
  if (!isBrowser()) return "";
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<FolioContent | undefined>(
        db
          .transaction("folio-content")
          .objectStore("folio-content")
          .get(folioId),
      )) ?? null;
    return rec?.html ?? "";
  } catch {
    return "";
  }
}

export async function saveFolioContentToIdb(
  folioId: string,
  html: string,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: FolioContent = { folioId, html, updatedAt: Date.now() };
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
): Promise<unknown | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<BriefRecord | undefined>(
        db.transaction("brief").objectStore("brief").get(folioId),
      )) ?? null;
    return rec?.brief ?? null;
  } catch {
    return null;
  }
}

export async function saveBriefToIdb(
  folioId: string,
  brief: unknown,
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
  if (!hasWindow()) return { ...DEFAULT_WRITER_SETTINGS };
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
  if (!hasWindow()) return;
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
  if (!hasWindow()) return { ...DEFAULT_APPARATUS_SETTINGS };
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
  if (!hasWindow()) return;
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

/* ── Rubric result (single record in `meta`, key="rubric-result") ── */

export async function loadRubricResultFromIdb(): Promise<RubricResult | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db.transaction("meta").objectStore("meta").get("rubric-result"),
      )) ?? null;
    if (!rec?.value || typeof rec.value !== "object") return null;
    return rec.value as RubricResult;
  } catch {
    return null;
  }
}

export async function saveRubricResultToIdb(
  result: RubricResult,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = {
      key: "rubric-result",
      value: result,
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

export async function loadRoomAnalysisFromIdb(): Promise<RoomAnalysis | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const rec =
      (await reqAsPromise<MetaRecord | undefined>(
        db.transaction("meta").objectStore("meta").get("room-analysis"),
      )) ?? null;
    if (!rec?.value || typeof rec.value !== "object") return null;
    return rec.value as RoomAnalysis;
  } catch {
    return null;
  }
}

export async function saveRoomAnalysisToIdb(
  analysis: RoomAnalysis,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const rec: MetaRecord = {
      key: "room-analysis",
      value: analysis,
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
  if (!hasWindow()) return null;
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

export async function saveAiSettingsToIdb(settings: AiSettings): Promise<void> {
  if (!hasWindow()) return;
  writeLocalStorageJson(AI_SETTINGS_STORAGE_KEY, settings);
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
