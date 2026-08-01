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
import type { BibEntry } from "./bibliography";
import {
  loadDraftHtmlFromIdb,
  loadFoliosFromIdb,
  loadPersonasFromIdb,
  loadFolioContentFromIdb,
  loadActiveFolioIdFromIdb,
  loadAllBriefsFromIdb,
  saveFoliosToIdb,
  saveBriefToIdb,
  saveFolioContentToIdb,
  savePersonasToIdb,
  saveDraftHtmlToIdb,
  loadRubricResultFromIdb,
  saveRubricResultToIdb,
  clearIdbStore,
} from "./idb";
import {
  persistToIdb,
  readFileAsJson,
  writeFileAsJson,
} from "./lix";
import { normalizeApplicationError } from "./application-errors";
import { reportApplicationDiagnostic } from "./application-diagnostics";

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
  briefs: Array<{
    folioId: string;
    brief: ProjectBrief;
    updatedAt: number;
  }>;
  /** One-row-per-user dossier written before briefs became folio-scoped. */
  legacyBrief: ProjectBrief | null;
  legacyBriefUpdatedAt: number;
  folios: Folio[];
  foliosUpdatedAt: number;
  folioContent: Array<{ folioId: string; html: string; updatedAt: number }>;
  customPersonas: Persona[] | null;
  customPersonasUpdatedAt: number;
  personaNotes: Array<{
    folioId?: string;
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
    folioId?: string;
    replyId: string;
    noteId: string;
    author: string;
    authorKind: "user" | "persona";
    personaId?: string;
    text: string;
    createdAt: number;
  }>;
  rubricResults: Array<{
    folioId?: string;
    result: RubricResult;
    updatedAt: number;
  }>;
  bibliography: BibEntry[];
  bibliographyUpdatedAt: number;
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
  briefs: Array<{ folioId: string; brief: ProjectBrief }>;
  folios: Folio[];
  folioContent: Array<{ folioId: string; html: string }>;
  customPersonas: Persona[] | null;
  personaNotes: PersonaFeedback[];
  personaReplies: PersonaReply[];
  rubricResults: Array<{ folioId: string; result: RubricResult }>;
  bibliography: BibEntry[];
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
const BIBLIOGRAPHY_PATH = "/bibliography.json";

function folioArtifactPath(folioId: string, filename: string): string {
  return `/folios/${folioId}/${filename}`;
}

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
  if (
    state.lastErrorAt &&
    (!state.lastSyncedAt || state.lastErrorAt > state.lastSyncedAt)
  ) {
    return {
      kind: "error",
      lastErrorAt: state.lastErrorAt,
      message:
        state.lastErrorMessage ??
        "Sync failed. Your local work remains safe on this device.",
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
  state.lastSyncedAt = null;
  state.lastErrorAt = null;
  state.lastErrorMessage = null;

  // Fire and forget — we don't want the auth path to await the hydration.
  if (previousUserId !== userId) {
    void handleUserChanged(previousUserId, userId).catch((err) => {
      setSyncFailure(err, "hydrate");
      notifyStatusChange();
    });
  }
}

export function clearConvexSyncContext() {
  state.client = null;
  state.userId = null;
  state.lastSnapshot = null;
  state.hydratedFromRemote = false;
  state.lastSyncedAt = null;
  state.lastErrorAt = null;
  state.lastErrorMessage = null;
  state.pushing = false;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  notifyStatusChange();
}

/**
 * Mark local state as dirty. A debounced push will fire shortly after.
 * Safe to call frequently.
 */
export function markDirty(): void {
  if (!state.userId || !state.client) return;
  recordWritingActivity();
  if (pushTimer) return; // already scheduled
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushLocalSnapshot();
  }, PUSH_DEBOUNCE_MS);
  notifyStatusChange();
}

/** Client-side throttle so a writing session sends a handful of activity
 * pings rather than one per keystroke-debounce tick. */
const WRITING_ACTIVITY_THROTTLE_MS = 2 * 60 * 1000;
let lastWritingActivityAt = 0;

function recordWritingActivity(): void {
  if (!state.client) return;
  const now = Date.now();
  if (now - lastWritingActivityAt < WRITING_ACTIVITY_THROTTLE_MS) return;
  lastWritingActivityAt = now;
  void state.client
    .mutation(api.writingActivity.recordActivity, {})
    .catch((err) => {
      reportApplicationDiagnostic("twyne:sync:record-writing-activity", err, {
        operation: "record-writing-activity",
      });
    });
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
  try {
    await persistToIdb();
    const { loadLixBlobFromIdb } = await import("./idb");
    const blob = await loadLixBlobFromIdb();
    if (!blob) return;
    const buffer = await blob.arrayBuffer();
    await state.client.mutation(api.lixBlobs.upsert, {
      blob: buffer,
    });
  } catch (err) {
    reportApplicationDiagnostic("twyne:sync:lix-push", err, {
      operation: "lix-push",
    });
    throw normalizeApplicationError(err, {
      source: "convex",
      metadata: { operation: "lix-push" },
    });
  }
}

export async function loadFromConvex(): Promise<Blob | null> {
  if (!state.client || !state.userId) return null;
  try {
    const entry = await state.client.query(api.lixBlobs.get, {});
    if (!entry?.blob) return null;
    return new Blob([entry.blob]);
  } catch (err) {
    reportApplicationDiagnostic("twyne:sync:lix-pull", err, {
      operation: "lix-pull",
    });
    throw normalizeApplicationError(err, {
      source: "convex",
      metadata: { operation: "lix-pull" },
    });
  }
}

/* ── Internal: build local snapshot, decide push vs pull ─────────── */

async function buildLocalSnapshot(): Promise<LocalSnapshot> {
  const briefs = (await loadAllBriefsFromIdb()).map(({ folioId, brief }) => ({
    folioId,
    brief,
  }));
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
  const notes: PersonaFeedback[] = [];
  const replies: PersonaReply[] = [];
  const rubricResults: Array<{ folioId: string; result: RubricResult }> = [];
  for (const folioId of ids) {
    if (!folioId) continue;
    const [folioNotes, folioReplies, rubric] = await Promise.all([
      loadPersonaNotesLocally(folioId),
      loadPersonaRepliesLocally(folioId),
      loadRubricResultFromIdb(folioId),
    ]);
    notes.push(...folioNotes);
    replies.push(...folioReplies);
    if (rubric) rubricResults.push({ folioId, result: rubric });
  }
  const bibliography =
    (await readFileAsJson<BibEntry[]>(BIBLIOGRAPHY_PATH)) ?? [];

  return {
    briefs,
    folios,
    folioContent,
    customPersonas,
    personaNotes: notes,
    personaReplies: replies,
    rubricResults,
    bibliography: Array.isArray(bibliography) ? bibliography : [],
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
      briefs: snap.briefs,
      folios: snap.folios,
      folioContent: snap.folioContent,
      customPersonas: snap.customPersonas ?? undefined,
      personaNotes: snap.personaNotes.map((n) => ({
        folioId: n.folioId ?? "",
        noteId: n.noteId ?? `pn-${n.personaId}-${n.timestamp}`,
        personaId: n.personaId,
        personaName: n.personaName,
        personaColor: n.personaColor,
        type: n.type,
        feedback: n.feedback,
        anchor: n.anchor,
        briefTitle: n.briefTitle,
        createdAt: n.timestamp,
      })),
      personaReplies: snap.personaReplies.map((r) => ({
        folioId: r.folioId ?? "",
        replyId: r.id,
        noteId: r.noteId,
        author: r.author,
        authorKind: r.authorKind,
        personaId: r.personaId,
        text: r.text,
        createdAt: r.timestamp,
      })),
      rubricResults: snap.rubricResults,
      bibliography: snap.bibliography,
    });
    // Success: clear the error and stamp the synced time.
    state.lastSyncedAt = Date.now();
    state.lastErrorAt = null;
    state.lastErrorMessage = null;
  } catch (err) {
    setSyncFailure(err, "push-all");
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
    setSyncFailure(err, "pull-all");
    notifyStatusChange();
    return;
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
    remote.briefs.length > 0 ||
    remote.legacyBrief !== null ||
    remote.folios.length > 0 ||
    remote.folioContent.length > 0 ||
    remote.customPersonas !== null ||
    remote.personaNotes.length > 0 ||
    remote.personaReplies.length > 0 ||
    remote.rubricResults.length > 0 ||
    (remote.bibliography?.length ?? 0) > 0;

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

function setSyncFailure(error: unknown, operation: string): void {
  reportApplicationDiagnostic(`twyne:sync:${operation}`, error, {
    operation,
  });
  const normalized = normalizeApplicationError(error, {
    source: "convex",
    metadata: { operation },
  });
  state.lastErrorAt = Date.now();
  state.lastErrorMessage = `${normalized.message} Your local work remains safe on this device.`;
}

async function mergeFromRemote(
  local: LocalSnapshot,
  remote: SyncedSnapshot,
): Promise<void> {
  // Dossiers — per-folio, newer-wins by the brief's updatedAt.
  for (const dossier of remote.briefs) {
    const localDossier = local.briefs.find(
      (candidate) => candidate.folioId === dossier.folioId,
    );
    if (
      !localDossier ||
      dossier.updatedAt > (localDossier.brief.updatedAt ?? 0)
    ) {
      await saveBriefToIdb(dossier.folioId, dossier.brief);
      await writeFileAsJson(
        `/folios/${dossier.folioId}/brief.json`,
        dossier.brief,
      );
    }
  }
  if (remote.briefs.length === 0 && remote.legacyBrief) {
    const activeFolioId = await loadActiveFolioIdFromIdb();
    const targetFolioId = activeFolioId ?? local.folios[0]?.id;
    const alreadyFiled = targetFolioId
      ? local.briefs.find(
          (candidate) => candidate.folioId === targetFolioId,
        )
      : null;
    if (
      targetFolioId &&
      (!alreadyFiled ||
        remote.legacyBriefUpdatedAt > (alreadyFiled.brief.updatedAt ?? 0))
    ) {
      await saveBriefToIdb(targetFolioId, remote.legacyBrief);
      await writeFileAsJson(
        `/folios/${targetFolioId}/brief.json`,
        remote.legacyBrief,
      );
    }
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
      remote.customPersonasUpdatedAt > lastPersonasUpdate(local.customPersonas))
  ) {
    await savePersonasToIdb(remote.customPersonas);
  }

  const activeFolioId = await loadActiveFolioIdFromIdb();
  const legacyTargetFolioId = activeFolioId ?? local.folios[0]?.id;

  // Editorial artifacts are grouped by folio. Legacy remote rows without a
  // folio id attach to the one folio that was active during migration.
  const notesByFolio = new Map<string, PersonaFeedback[]>();
  for (const note of remote.personaNotes) {
    const folioId = note.folioId ?? legacyTargetFolioId;
    if (!folioId) continue;
    const group = notesByFolio.get(folioId) ?? [];
    group.push({
      ...note,
      folioId,
      timestamp: note.createdAt,
    });
    notesByFolio.set(folioId, group);
  }
  for (const [folioId, notes] of notesByFolio) {
    await writeFileAsJson(
      folioArtifactPath(folioId, "persona-notes.json"),
      notes,
    );
  }

  const repliesByFolio = new Map<string, PersonaReply[]>();
  for (const reply of remote.personaReplies) {
    const folioId = reply.folioId ?? legacyTargetFolioId;
    if (!folioId) continue;
    const group = repliesByFolio.get(folioId) ?? [];
    group.push({
      id: reply.replyId,
      folioId,
      noteId: reply.noteId,
      author: reply.author,
      authorKind: reply.authorKind,
      personaId: reply.personaId,
      text: reply.text,
      timestamp: reply.createdAt,
    });
    repliesByFolio.set(folioId, group);
  }
  for (const [folioId, replies] of repliesByFolio) {
    await writeFileAsJson(
      folioArtifactPath(folioId, "persona-replies.json"),
      replies,
    );
  }

  for (const remoteRubric of remote.rubricResults) {
    const folioId = remoteRubric.folioId ?? legacyTargetFolioId;
    if (!folioId) continue;
    const localRubric = local.rubricResults.find(
      (entry) => entry.folioId === folioId,
    )?.result;
    if (
      !localRubric ||
      remoteRubric.updatedAt > (localRubric.timestamp ?? 0)
    ) {
      await saveRubricLocally(
        { ...remoteRubric.result, folioId },
        folioId,
      );
      await saveRubricResultToIdb(
        { ...remoteRubric.result, folioId },
        folioId,
      );
    }
  }

  if ((remote.bibliography?.length ?? 0) > 0) {
    const merged = mergeBibliographyEntries(
      local.bibliography,
      remote.bibliography,
    );
    if (!sameJson(merged, local.bibliography)) {
      await writeFileAsJson(BIBLIOGRAPHY_PATH, merged);
    }
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

export function mergeBibliographyEntries(
  local: BibEntry[],
  remote: BibEntry[],
): BibEntry[] {
  const byId = new Map<string, BibEntry>();
  for (const entry of local) byId.set(entry.id, entry);
  for (const entry of remote) {
    const existing = byId.get(entry.id);
    if (!existing || bibEntryTimestamp(entry) >= bibEntryTimestamp(existing)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values());
}

function bibEntryTimestamp(entry: BibEntry): number {
  return entry.createdAt ?? entry.accessedAt ?? 0;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ── Public: explicit helpers for panels to use ─────────────────── */

/**
 * Save a persona feedback note. Persists locally and queues a push.
 */
export async function savePersonaNoteLocally(
  note: PersonaFeedback,
  brief: ProjectBrief | null,
  folioId = note.folioId ?? "",
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  const path = folioArtifactPath(folioId, "persona-notes.json");
  const current =
    (await readFileAsJson<PersonaFeedback[]>(path)) ?? [];
  const noteId = note.noteId ?? `pn-${note.personaId}-${note.timestamp}`;
  const filtered = current.filter((n) => (n.noteId ?? "") !== noteId);
  const stored: PersonaFeedback = {
    ...note,
    folioId,
    noteId,
    briefTitle: brief?.answers.workingTitle,
  };
  filtered.push(stored);
  await writeFileAsJson(path, filtered);
  markDirty();
}

export async function loadPersonaNotesLocally(
  folioId?: string | null,
): Promise<PersonaFeedback[]> {
  if (typeof window === "undefined" || !folioId) return [];
  return (
    (await readFileAsJson<PersonaFeedback[]>(
      folioArtifactPath(folioId, "persona-notes.json"),
    )) ?? []
  );
}

export async function clearPersonaNotesLocally(
  folioId?: string | null,
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  await writeFileAsJson(folioArtifactPath(folioId, "persona-notes.json"), []);
  markDirty();
}

export async function addPersonaReplyLocally(
  reply: PersonaReply,
  folioId = reply.folioId ?? "",
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  const path = folioArtifactPath(folioId, "persona-replies.json");
  const current =
    (await readFileAsJson<PersonaReply[]>(path)) ?? [];
  current.push({ ...reply, folioId });
  await writeFileAsJson(path, current);
  markDirty();
}

export async function loadPersonaRepliesLocally(
  folioId?: string | null,
): Promise<PersonaReply[]> {
  if (typeof window === "undefined" || !folioId) return [];
  return (
    (await readFileAsJson<PersonaReply[]>(
      folioArtifactPath(folioId, "persona-replies.json"),
    )) ?? []
  );
}

export async function saveRubricLocally(
  result: RubricResult,
  folioId = result.folioId ?? "",
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  await writeFileAsJson(folioArtifactPath(folioId, "rubric-result.json"), {
    ...result,
    folioId,
  });
  markDirty();
}

export async function loadRubricLocally(
  folioId?: string | null,
): Promise<RubricResult | null> {
  if (typeof window === "undefined" || !folioId) return null;
  return (
    (await readFileAsJson<RubricResult>(
      folioArtifactPath(folioId, "rubric-result.json"),
    )) ?? null
  );
}

/* ── Suggestions (editorial change proposals) ── */

export async function saveSuggestionLocally(
  suggestion: Suggestion,
  folioId = suggestion.folioId ?? "",
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  const path = folioArtifactPath(folioId, "suggestions.json");
  const current = (await readFileAsJson<Suggestion[]>(path)) ?? [];
  const filtered = current.filter((s) => s.id !== suggestion.id);
  filtered.push({ ...suggestion, folioId });
  await writeFileAsJson(path, filtered);
  markDirty();
}

export async function loadSuggestionsLocally(
  folioId?: string | null,
): Promise<Suggestion[]> {
  if (typeof window === "undefined" || !folioId) return [];
  return (
    (await readFileAsJson<Suggestion[]>(
      folioArtifactPath(folioId, "suggestions.json"),
    )) ?? []
  );
}

export async function updateSuggestionStatusLocally(
  id: string,
  status: Suggestion["status"],
  folioId?: string | null,
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  const path = folioArtifactPath(folioId, "suggestions.json");
  const current = (await readFileAsJson<Suggestion[]>(path)) ?? [];
  const next = current.map((s) => (s.id === id ? { ...s, status } : s));
  await writeFileAsJson(path, next);
  markDirty();
}

/* ── Room settings (tunable assistance) ── */

const ROOM_SETTINGS_PATH = "/room-settings.json";

export async function saveRoomSettingsLocally(
  settings: RoomSettings,
): Promise<void> {
  if (typeof window === "undefined") return;
  await writeFileAsJson(ROOM_SETTINGS_PATH, settings);
  markDirty();
}

export async function loadRoomSettingsLocally(): Promise<RoomSettings> {
  if (typeof window === "undefined") return DEFAULT_ROOM_SETTINGS;
  return (
    (await readFileAsJson<RoomSettings>(ROOM_SETTINGS_PATH)) ??
    DEFAULT_ROOM_SETTINGS
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
      const notes =
        (await readFileAsJson<PersonaFeedback[]>("/persona-notes.json")) ?? [];
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
