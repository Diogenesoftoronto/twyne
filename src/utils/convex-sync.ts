import { api } from "../../convex/_generated/api";
import type { ConvexClient } from "convex/browser";
import type {
  Folio,
  Persona,
  PersonaFeedback,
  RubricResult,
  ProjectBrief,
  PersonaReply,
  Suggestion,
  RoomSettings,
} from "../types";
import { DEFAULT_ROOM_SETTINGS } from "../types";
import {
  loadDraftHtmlFromIdb,
  loadFoliosFromIdb,
  loadPersonasFromIdb,
  loadFolioContentFromIdb,
  loadActiveFolioIdFromIdb,
  saveFoliosToIdb,
  saveFolioContentToIdb,
  savePersonasToIdb,
  saveDraftHtmlToIdb,
  clearIdbStore,
} from "./idb";
import { persistToIdb, readFileAsJson, writeFileAsJson, BRIEF_PATH } from "./lix";

/**
 * Browser ↔ Convex sync for the per-user data. The local IndexedDB
 * remains the source of truth for the current session; the server is
 * the source of truth across sessions and devices.
 *
 * The orchestrator tracks the current `userId` and runs the right
 * migration when it changes:
 *
 *   userId  null →  X  (sign-up)   : push everything local to the server
 *   userId  X  →  null (sign-out)  : keep local state, clear server ctx
 *   userId  X  →  Y  (account swap): if Y has remote data, pull it; else
 *                                    push X's local data to Y
 *   userId  same (re-auth)         : no-op (data already synced)
 *
 * Continuous sync is debounced — every time the local state changes,
 * `markDirty()` is called and a single `pushAll` fires at most every
 * 4 seconds. A final flush runs on `pagehide`.
 */

type ConvexSyncClient = Pick<ConvexClient, "query" | "mutation">;

interface SyncedSnapshot {
  brief: ProjectBrief | null;
  briefUpdatedAt: number;
  folios: Folio[];
  foliosUpdatedAt: number;
  folioContent: Array<{ folioId: string; html: string; updatedAt: number }>;
  customPersonas: Persona[] | null;
  customPersonasUpdatedAt: number;
  personaNotes: Array<{
    noteId: string;
    personaId: string;
    personaName: string;
    personaColor: string;
    type: "encouragement" | "suggestion" | "critique" | "perspective";
    feedback: string;
    anchor?: string;
    briefTitle?: string;
    createdAt: number;
  }>;
  personaReplies: Array<{
    replyId: string;
    noteId: string;
    author: string;
    authorKind: "user" | "persona";
    personaId?: string;
    text: string;
    createdAt: number;
  }>;
  rubricResult: RubricResult | null;
  rubricResultUpdatedAt: number;
}

interface SyncState {
  client: ConvexSyncClient | null;
  userId: string | null;
  /** Cached local snapshot, used to detect changes and build push payloads. */
  lastSnapshot: LocalSnapshot | null;
  /** Whether the active user has any remote state to merge from. */
  hydratedFromRemote: boolean;
  /** Last push that succeeded, epoch ms. Drives the "synced Xs ago" line. */
  lastSyncedAt: number | null;
  /** Last push that threw, epoch ms. Stays surfaced until the next success. */
  lastErrorAt: number | null;
  /** Last error message, paired with `lastErrorAt`. */
  lastErrorMessage: string | null;
  /** True while a push is in flight. */
  pushing: boolean;
}

interface LocalSnapshot {
  brief: ProjectBrief | null;
  folios: Folio[];
  folioContent: Array<{ folioId: string; html: string }>;
  customPersonas: Persona[] | null;
  personaNotes: PersonaFeedback[];
  personaReplies: PersonaReply[];
  rubricResult: RubricResult | null;
}

const state: SyncState = {
  client: null,
  userId: null,
  lastSnapshot: null,
  hydratedFromRemote: false,
  lastSyncedAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  pushing: false,
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const PUSH_DEBOUNCE_MS = 4_000;
const SIGN_UP_PUSH_FLAG = "twyne:signed-up-once";

/* ── Status surface (Phase 4) ──────────────────────────────────────── */

/**
 * The state the editor's sync indicator and the "last saved"
 * line both read. Pure data — derived from the live `state`
 * plus a `navigator.onLine` check on every call. The orchestrator
 * fires `twyne:sync-status` on the window whenever any of the
 * underlying inputs change; consumers can either poll
 * `getSyncStatus()` or subscribe via `subscribeSyncStatus()`.
 */
export type SyncStatus =
  | { kind: "local-only" } // no userId — never signed in
  | { kind: "offline" } // navigator says we're offline
  | { kind: "pending"; queuedAt: number } // a push is scheduled
  | { kind: "syncing" } // a push is in flight
  | { kind: "synced"; lastSyncedAt: number }
  | { kind: "error"; lastErrorAt: number; message: string };

export function getSyncStatus(): SyncStatus {
  if (!state.userId) return { kind: "local-only" };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { kind: "offline" };
  }
  if (state.pushing) return { kind: "syncing" };
  if (pushTimer) return { kind: "pending", queuedAt: Date.now() };
  if (state.lastErrorAt && !state.lastSyncedAt) {
    return {
      kind: "error",
      lastErrorAt: state.lastErrorAt,
      message: state.lastErrorMessage ?? "Sync failed",
    };
  }
  if (state.lastSyncedAt) {
    return { kind: "synced", lastSyncedAt: state.lastSyncedAt };
  }
  // Signed in but no push has happened yet — the next markDirty
  // will move us to "pending" or "syncing".
  return { kind: "local-only" };
}

/** Fire the custom event the indicators listen for. */
function notifyStatusChange(): void {
  if (typeof window === "undefined") return;
  const status = getSyncStatus();
  window.dispatchEvent(
    new CustomEvent("twyne:sync-status", { detail: status }),
  );
}

/**
 * Subscribe to sync status changes. Returns an unsubscribe
 * function. The callback is invoked once immediately with the
 * current status, then again on every change.
 */
export function subscribeSyncStatus(
  cb: (status: SyncStatus) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  window.addEventListener("twyne:sync-status", handler);
  // Fire once with the current snapshot so consumers don't have
  // to re-read state on mount.
  cb(getSyncStatus());
  return () => window.removeEventListener("twyne:sync-status", handler);
}

/* ── Public surface ─────────────────────────────────────────────── */

export function setConvexSyncContext(client: ConvexSyncClient, userId: string) {
  state.client = client;
  const previousUserId = state.userId;
  state.userId = userId;
  state.hydratedFromRemote = false;

  // Fire and forget — we don't want the auth path to await the hydration.
  if (previousUserId !== userId) {
    void handleUserChanged(previousUserId, userId);
  }
}

export function clearConvexSyncContext() {
  state.client = null;
  state.userId = null;
  state.lastSnapshot = null;
  state.hydratedFromRemote = false;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/**
 * Mark local state as dirty. A debounced push will fire shortly after.
 * Safe to call frequently.
 */
export function markDirty(): void {
  if (!state.userId || !state.client) return;
  if (pushTimer) return; // already scheduled
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushLocalSnapshot();
  }, PUSH_DEBOUNCE_MS);
}

/** Force an immediate push, e.g. on pagehide. */
export async function flushNow(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushLocalSnapshot();
}

/* ── Lix (existing) sync — kept for the change-tracking workflow ── */

export async function syncToConvex(): Promise<void> {
  if (!state.client || !state.userId) return;
  await persistToIdb();
  const { loadLixBlobFromIdb } = await import("./idb");
  const blob = await loadLixBlobFromIdb();
  if (!blob) return;
  const buffer = await blob.arrayBuffer();
  await state.client.mutation(api.lixBlobs.upsert, {
    userId: state.userId,
    blob: buffer,
  });
}

export async function loadFromConvex(): Promise<Blob | null> {
  if (!state.client || !state.userId) return null;
  const entry = await state.client.query(api.lixBlobs.getByUserId, {
    userId: state.userId,
  });
  if (!entry?.blob) return null;
  return new Blob([entry.blob]);
}

/* ── Internal: build local snapshot, decide push vs pull ─────────── */

async function buildLocalSnapshot(): Promise<LocalSnapshot> {
  const brief = (await readFileAsJson<ProjectBrief>(BRIEF_PATH)) ?? null;
  const folios = await loadFoliosFromIdb();
  const activeFolioId = await loadActiveFolioIdFromIdb();
  const ids = new Set<string>(folios.map((f) => f.id));
  if (activeFolioId) ids.add(activeFolioId);

  const folioContent: Array<{ folioId: string; html: string }> = [];
  for (const id of ids) {
    if (!id) continue;
    const html = await loadFolioContentFromIdb(id);
    folioContent.push({ folioId: id, html });
  }

  const customPersonas = (await loadPersonasFromIdb()) as Persona[];
  // Persona notes / replies are persisted in Lix too — they live with the
  // manuscript rather than in their own IDB keys.
  const notes =
    (await readFileAsJson<PersonaFeedback[]>("/persona-notes.json")) ?? [];
  const replies =
    (await readFileAsJson<PersonaReply[]>("/persona-replies.json")) ?? [];
  const rubric =
    (await readFileAsJson<RubricResult>("/rubric-result.json")) ?? null;

  return {
    brief,
    folios,
    folioContent,
    customPersonas,
    personaNotes: notes,
    personaReplies: replies,
    rubricResult: rubric,
  };
}

async function pushLocalSnapshot(): Promise<void> {
  if (!state.client || !state.userId) return;
  if (typeof window === "undefined") return;
  state.pushing = true;
  notifyStatusChange();
  try {
    const snap = await buildLocalSnapshot();
    state.lastSnapshot = snap;

    await state.client.mutation(api.sync.pushAll, {
      brief: snap.brief,
      folios: snap.folios,
      folioContent: snap.folioContent,
      customPersonas: snap.customPersonas ?? undefined,
      personaNotes: snap.personaNotes.map((n) => ({
        noteId: n.noteId ?? `pn-${n.personaId}-${n.timestamp}`,
        personaId: n.personaId,
        personaName: n.personaName,
        personaColor: n.personaColor,
        type: n.type,
        feedback: n.feedback,
        anchor: n.anchor,
        briefTitle: snap.brief?.answers.workingTitle,
        createdAt: n.timestamp,
      })),
      personaReplies: snap.personaReplies.map((r) => ({
        replyId: r.id,
        noteId: r.noteId,
        author: r.author,
        authorKind: r.authorKind,
        personaId: r.personaId,
        text: r.text,
        createdAt: r.timestamp,
      })),
      rubricResult: snap.rubricResult ?? undefined,
    });
    // Success: clear the error and stamp the synced time.
    state.lastSyncedAt = Date.now();
    state.lastErrorAt = null;
    state.lastErrorMessage = null;
  } catch (err) {
    // Convex calls may fail in dev where auth is mocked — swallow and continue.
    console.warn("[twyne:sync] pushAll failed:", err);
    state.lastErrorAt = Date.now();
    state.lastErrorMessage =
      (err as Error)?.message ?? "Sync failed — your changes are local only.";
  } finally {
    state.pushing = false;
    notifyStatusChange();
  }
}

/**
 * Wire the navigator's online/offline events to the sync
 * indicator. Idempotent — calling this twice has the same
 * effect as calling it once.
 */
let _networkListenersBound = false;
export function bindNetworkStatusEvents(): void {
  if (_networkListenersBound) return;
  if (typeof window === "undefined") return;
  _networkListenersBound = true;
  window.addEventListener("online", notifyStatusChange);
  window.addEventListener("offline", notifyStatusChange);
}

async function handleUserChanged(
  previousUserId: string | null,
  newUserId: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!state.client) return;

  // Always start by building a fresh local snapshot — that's what we'll
  // push if the server is empty.
  const local = await buildLocalSnapshot();
  state.lastSnapshot = local;

  // Read the flag before we do anything else. The flag is set on first
  // push of local data, so subsequent sign-ins know not to push again.
  const didSignUpHere =
    window.localStorage.getItem(SIGN_UP_PUSH_FLAG) === newUserId;

  let remote: SyncedSnapshot | null = null;
  try {
    remote = (await state.client.query(api.sync.pullAll, {})) as SyncedSnapshot;
  } catch (err) {
    console.warn("[twyne:sync] pullAll failed:", err);
  }

  if (!remote) {
    // Push whatever we have locally; this is the sign-up path.
    await pushLocalSnapshot();
    window.localStorage.setItem(SIGN_UP_PUSH_FLAG, newUserId);
    state.hydratedFromRemote = true;
    return;
  }

  // Merge: for each top-level slice, take whichever side is newer by
  // `updatedAt`. Newer-wins is the simplest sane policy without a CRDT.
  const hasRemoteData =
    remote.brief !== null ||
    remote.folios.length > 0 ||
    remote.folioContent.length > 0 ||
    remote.customPersonas !== null ||
    remote.personaNotes.length > 0 ||
    remote.rubricResult !== null;

  if (!hasRemoteData && !didSignUpHere) {
    // Empty account — push what we have to seed it.
    await pushLocalSnapshot();
    window.localStorage.setItem(SIGN_UP_PUSH_FLAG, newUserId);
    state.hydratedFromRemote = true;
    return;
  }

  if (hasRemoteData) {
    await mergeFromRemote(local, remote);
  }

  state.hydratedFromRemote = true;
  // After hydration, push any local deltas back up.
  void pushLocalSnapshot();
}

async function mergeFromRemote(
  local: LocalSnapshot,
  remote: SyncedSnapshot,
): Promise<void> {
  // Brief — newer-wins by updatedAt.
  if (
    remote.brief &&
    (local.brief === null || remote.briefUpdatedAt > (local.brief.updatedAt ?? 0))
  ) {
    await writeFileAsJson(BRIEF_PATH, remote.brief);
  }

  // Folios — newer-wins.
  if (remote.foliosUpdatedAt > lastFoliosUpdate(local.folios)) {
    await saveFoliosToIdb(remote.folios);
  }

  // Folio content — per-folio, newer-wins.
  for (const fc of remote.folioContent) {
    const localEntry = local.folioContent.find((l) => l.folioId === fc.folioId);
    const localStamp = localEntry
      ? (await loadFolioContentFromIdb(fc.folioId)).length // best-effort
      : "";
    if (localEntry === undefined || localStamp === "") {
      await saveFolioContentToIdb(fc.folioId, fc.html);
    }
  }

  // Custom personas — newer-wins.
  if (
    remote.customPersonas &&
    (local.customPersonas === null ||
      remote.customPersonasUpdatedAt >
        lastPersonasUpdate(local.customPersonas))
  ) {
    await savePersonasToIdb(remote.customPersonas);
  }

  // Persona notes — union by noteId; later timestamp wins.
  if (remote.personaNotes.length > 0) {
    await writeFileAsJson("/persona-notes.json", remote.personaNotes);
  }
  if (remote.personaReplies.length > 0) {
    await writeFileAsJson("/persona-replies.json", remote.personaReplies);
  }

  // Rubric — newer-wins.
  if (
    remote.rubricResult &&
    (local.rubricResult === null ||
      remote.rubricResultUpdatedAt > (local.rubricResult.timestamp ?? 0))
  ) {
    await writeFileAsJson("/rubric-result.json", remote.rubricResult);
  }
}

function lastFoliosUpdate(folios: Folio[]): number {
  return folios.reduce((m, f) => Math.max(m, f.updatedAt ?? 0), 0);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function lastPersonasUpdate(personas: Persona[]): number {
  // Personas don't have an updatedAt — fall back to file mtime via a fresh read.
  return Date.now();
}

/* ── Public: explicit helpers for panels to use ─────────────────── */

/**
 * Save a persona feedback note. Persists locally and queues a push.
 */
export async function savePersonaNoteLocally(
  note: PersonaFeedback,
  brief: ProjectBrief | null,
): Promise<void> {
  if (typeof window === "undefined") return;
  const current =
    (await readFileAsJson<PersonaFeedback[]>("/persona-notes.json")) ?? [];
  const noteId = note.noteId ?? `pn-${note.personaId}-${note.timestamp}`;
  const filtered = current.filter((n) => (n.noteId ?? "") !== noteId);
  const stored: PersonaFeedback = {
    ...note,
    noteId,
    briefTitle: brief?.answers.workingTitle,
  };
  filtered.push(stored);
  await writeFileAsJson("/persona-notes.json", filtered);
  markDirty();
}

export async function loadPersonaNotesLocally(): Promise<PersonaFeedback[]> {
  if (typeof window === "undefined") return [];
  return (
    (await readFileAsJson<PersonaFeedback[]>("/persona-notes.json")) ?? []
  );
}

export async function clearPersonaNotesLocally(): Promise<void> {
  if (typeof window === "undefined") return;
  await writeFileAsJson("/persona-notes.json", []);
  markDirty();
}

export async function addPersonaReplyLocally(reply: PersonaReply): Promise<void> {
  if (typeof window === "undefined") return;
  const current =
    (await readFileAsJson<PersonaReply[]>("/persona-replies.json")) ?? [];
  current.push(reply);
  await writeFileAsJson("/persona-replies.json", current);
  markDirty();
}

export async function loadPersonaRepliesLocally(): Promise<PersonaReply[]> {
  if (typeof window === "undefined") return [];
  return (await readFileAsJson<PersonaReply[]>("/persona-replies.json")) ?? [];
}

export async function saveRubricLocally(result: RubricResult): Promise<void> {
  if (typeof window === "undefined") return;
  await writeFileAsJson("/rubric-result.json", result);
  markDirty();
}

export async function loadRubricLocally(): Promise<RubricResult | null> {
  if (typeof window === "undefined") return null;
  return (await readFileAsJson<RubricResult>("/rubric-result.json")) ?? null;
}

/* ── Suggestions (editorial change proposals) ── */

const SUGGESTIONS_PATH = "/suggestions.json";

export async function saveSuggestionLocally(suggestion: Suggestion): Promise<void> {
  if (typeof window === "undefined") return;
  const current = (await readFileAsJson<Suggestion[]>(SUGGESTIONS_PATH)) ?? [];
  const filtered = current.filter((s) => s.id !== suggestion.id);
  filtered.push(suggestion);
  await writeFileAsJson(SUGGESTIONS_PATH, filtered);
  markDirty();
}

export async function loadSuggestionsLocally(): Promise<Suggestion[]> {
  if (typeof window === "undefined") return [];
  return (await readFileAsJson<Suggestion[]>(SUGGESTIONS_PATH)) ?? [];
}

export async function updateSuggestionStatusLocally(
  id: string,
  status: Suggestion["status"],
): Promise<void> {
  if (typeof window === "undefined") return;
  const current = (await readFileAsJson<Suggestion[]>(SUGGESTIONS_PATH)) ?? [];
  const next = current.map((s) => (s.id === id ? { ...s, status } : s));
  await writeFileAsJson(SUGGESTIONS_PATH, next);
  markDirty();
}

/* ── Room settings (tunable assistance) ── */

const ROOM_SETTINGS_PATH = "/room-settings.json";

export async function saveRoomSettingsLocally(settings: RoomSettings): Promise<void> {
  if (typeof window === "undefined") return;
  await writeFileAsJson(ROOM_SETTINGS_PATH, settings);
  markDirty();
}

export async function loadRoomSettingsLocally(): Promise<RoomSettings> {
  if (typeof window === "undefined") return DEFAULT_ROOM_SETTINGS;
  return (
    (await readFileAsJson<RoomSettings>(ROOM_SETTINGS_PATH)) ?? DEFAULT_ROOM_SETTINGS
  );
}

/**
 * Convenience: the persona panel can ask the orchestrator to "strike the
 * room" (clear the notes). Local + queued push.
 */
export async function strikeRoomLocally(): Promise<void> {
  if (typeof window === "undefined") return;
  await writeFileAsJson("/persona-notes.json", []);
  await writeFileAsJson("/persona-replies.json", []);
  if (state.client && state.userId) {
    try {
      const notes = (await readFileAsJson<PersonaFeedback[]>(
        "/persona-notes.json",
      )) ?? [];
      for (const n of notes) {
        if (n.noteId) {
          await state.client.mutation(api.sync.removePersonaNote, {
            noteId: n.noteId,
          });
        }
      }
    } catch {
      // ignore
    }
  }
  markDirty();
}

/** Reset all local state. Used on sign-out if the user wants a clean slate. */
export async function nukeLocalState(): Promise<void> {
  await clearIdbStore();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
}

/** Re-export for consumers that already imported these. */
export { loadDraftHtmlFromIdb, saveDraftHtmlToIdb };
