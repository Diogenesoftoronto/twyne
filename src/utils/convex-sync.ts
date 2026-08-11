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
  loadFolioContentSnapshotFromIdb,
  loadActiveFolioIdFromIdb,
  loadAllBriefsFromIdb,
  saveFoliosToIdb,
  deleteFolioFromIdb,
  saveBriefToIdb,
  deleteBriefFromIdb,
  saveFolioContentToIdb,
  deleteFolioContentFromIdb,
  savePersonasToIdb,
  saveDraftHtmlToIdb,
  loadRubricResultFromIdb,
  saveRubricResultToIdb,
  deleteRubricResultFromIdb,
  saveActiveFolioIdToIdb,
  clearActiveFolioIdFromIdb,
  clearIdbStore,
} from "./idb";
import { persistToIdb, readFileAsJson, writeFileAsJson } from "./lix";
import { normalizeApplicationError } from "./application-errors";
import { reportApplicationDiagnostic } from "./application-diagnostics";
import { createRevisionTask } from "./revision-history";

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

type ConvexSyncClient = Pick<ConvexClient, "query" | "mutation" | "onUpdate">;

interface SyncedSnapshot {
  syncRevision: number;
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
    traceId?: string;
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
  /**
   * The payload the server is known to hold, as last acknowledged.
   *
   * Every push is diffed against this, so a keystroke in one folio does not
   * rewrite the drafts of the others. It is set only after `pushAll` returns:
   * a push that threw left the server behind, and the next one has to carry
   * everything since the last success rather than only what changed after it.
   * Null means "assume the server has nothing", which is the honest starting
   * position on sign-in and the one that seeds an empty account.
   */
  lastPushed: PushPayload | null;
  /** Optimistic-concurrency revision returned by the last pull or push. */
  remoteRevision: number | null;
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
  /** The locally-known snapshot, recency-per-section. Sections are only
   * rebuilt when they go dirty, so a keystroke in one folio never re-reads
   * the manuscript of every other folio. Null until the first build. */
  lastSnapshot: LocalSnapshot | null;
  /**
   * Winner set of sections that changed since the last push. `markDirty`
   * without arguments marks every section (the safe default); callers that
   * know exactly what moved — the editor's content flush, say — mark only
   * the section they touched.
   */
  dirtySections: Set<PushSection>;
}

interface LocalSnapshot {
  briefs: Array<{ folioId: string; brief: ProjectBrief }>;
  folios: Folio[];
  folioContent: Array<{ folioId: string; html: string; updatedAt: number }>;
  customPersonas: Persona[] | null;
  personaNotes: PersonaFeedback[];
  personaReplies: PersonaReply[];
  rubricResults: Array<{ folioId: string; result: RubricResult }>;
  bibliography: BibEntry[];
}

/** A top-level slice of the snapshot that can go dirty and be rebuilt alone. */
type PushSection = keyof LocalSnapshot;

const ALL_PUSH_SECTIONS: readonly PushSection[] = [
  "briefs",
  "folios",
  "folioContent",
  "customPersonas",
  "personaNotes",
  "personaReplies",
  "rubricResults",
  "bibliography",
];

/**
 * A local snapshot in the shape `sync.pushAll` accepts.
 *
 * Kept separate from {@link LocalSnapshot} because this is the thing worth
 * remembering between pushes: comparing what we are about to send against what
 * we last sent is only meaningful if both are in the same shape. Fields the
 * mapping drops — a folio's local `updatedAt`, say — would otherwise report a
 * change on every save that the server never sees.
 */
type PushPayload = ReturnType<typeof buildPushPayload>;

/**
 * The subset of a payload actually worth sending. Every section is optional
 * because `pushAll` leaves a missing argument alone — which is what makes a
 * partial push safe rather than a partial overwrite.
 *
 * The row-upserted sections also carry a removal list: rows the server was
 * last told about but the snapshot no longer contains. `pushAll` deletes
 * exactly those, which is the channel by which a deleted note, reply, brief
 * or manuscript stops pinging back as a ghost on the next sign-in.
 */
type PushChanges = {
  [K in keyof PushPayload]?: NonNullable<PushPayload[K]>;
} & {
  expectedRevision?: number;
  removedBriefFolioIds?: string[];
  removedFolioContentIds?: string[];
  removedPersonaNoteIds?: string[];
  removedPersonaReplyIds?: string[];
  removedRubricFolioIds?: string[];
};

const state: SyncState = {
  client: null,
  userId: null,
  lastPushed: null,
  remoteRevision: null,
  hydratedFromRemote: false,
  lastSyncedAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  pushing: false,
  lastSnapshot: null,
  dirtySections: new Set<PushSection>(ALL_PUSH_SECTIONS),
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Set when a push is requested while one is already in flight. */
let pushAgainWhenDone = false;
let remoteUnsubscribe: (() => void) | null = null;
let remoteApplyChain: Promise<void> = Promise.resolve();
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
  remoteUnsubscribe?.();
  remoteUnsubscribe = null;
  state.client = client;
  const previousUserId = state.userId;
  state.userId = userId;
  state.hydratedFromRemote = false;
  state.lastSyncedAt = null;
  state.lastErrorAt = null;
  state.lastErrorMessage = null;
  // A different user's local state may be sitting in IndexedDB still (account
  // swap); never reuse their cached snapshot or ratify their dirty sections,
  // and never diff against a payload that was acknowledged for someone else.
  state.lastSnapshot = null;
  state.lastPushed = null;
  state.remoteRevision = null;
  for (const section of ALL_PUSH_SECTIONS) state.dirtySections.add(section);

  // Fire and forget — we don't want the auth path to await the hydration.
  if (previousUserId !== userId) {
    void handleUserChanged(previousUserId, userId)
      .then(() => {
        if (state.client === client && state.userId === userId) {
          startRemoteSubscription(client, userId);
        }
      })
      .catch((err) => {
        setSyncFailure(err, "hydrate");
        notifyStatusChange();
      });
  } else {
    startRemoteSubscription(client, userId);
  }
}

export function clearConvexSyncContext() {
  remoteUnsubscribe?.();
  remoteUnsubscribe = null;
  state.client = null;
  state.userId = null;
  state.lastPushed = null;
  state.remoteRevision = null;
  state.hydratedFromRemote = false;
  state.lastSyncedAt = null;
  state.lastErrorAt = null;
  state.lastErrorMessage = null;
  state.pushing = false;
  pushAgainWhenDone = false;
  state.lastSnapshot = null;
  for (const section of ALL_PUSH_SECTIONS) state.dirtySections.add(section);
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  notifyStatusChange();
}

/**
 * Mark local state as dirty. A debounced push will fire shortly after.
 * Safe to call frequently.
 *
 * Passing one or more {@link PushSection}s limits the next rebuild to those
 * slices of IndexedDB; omitting them marks every section (the safe default —
 * callers that can't say exactly what moved should keep using it).
 */
export function markDirty(sections?: Iterable<PushSection>): void {
  if (!state.userId || !state.client) return;
  recordWritingActivity();
  if (sections) {
    for (const section of sections) state.dirtySections.add(section);
  } else {
    for (const section of ALL_PUSH_SECTIONS) state.dirtySections.add(section);
  }
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
  // A flush signals the tab is going away — never trust the dirty cache to
  // cover it. Rebuild every section so a change whose `markDirty` raced the
  // teardown is still reconciled against the server.
  for (const section of ALL_PUSH_SECTIONS) state.dirtySections.add(section);
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

/**
 * Load one section of the local snapshot from IndexedDB/Lix. Sections are
 * rebuilt independently so a keystroke in one folio never re-reads the
 * manuscripts (or notes, replies, rubric results) of every other folio.
 */
async function loadSnapshotSection(
  section: PushSection,
  folioIds: Set<string>,
): Promise<LocalSnapshot[PushSection]> {
  switch (section) {
    case "briefs":
      return (await loadAllBriefsFromIdb()).map(({ folioId, brief }) => ({
        folioId,
        brief,
      }));
    case "folios":
      return loadFoliosFromIdb();
    case "folioContent": {
      const rows: LocalSnapshot["folioContent"] = [];
      for (const id of folioIds) {
        if (!id) continue;
        const content = await loadFolioContentSnapshotFromIdb(id);
        rows.push({
          folioId: id,
          html: content?.html ?? "",
          updatedAt: content?.updatedAt ?? 0,
        });
      }
      return rows;
    }
    case "customPersonas":
      return (await loadPersonasFromIdb()) as Persona[];
    case "personaNotes": {
      const notes: PersonaFeedback[] = [];
      for (const id of folioIds) {
        if (!id) continue;
        notes.push(...(await loadPersonaNotesLocally(id)));
      }
      return notes;
    }
    case "personaReplies": {
      const replies: PersonaReply[] = [];
      for (const id of folioIds) {
        if (!id) continue;
        replies.push(...(await loadPersonaRepliesLocally(id)));
      }
      return replies;
    }
    case "rubricResults": {
      const rubricResults: LocalSnapshot["rubricResults"] = [];
      for (const id of folioIds) {
        if (!id) continue;
        const rubric = await loadRubricResultFromIdb(id);
        if (rubric) rubricResults.push({ folioId: id, result: rubric });
      }
      return rubricResults;
    }
    case "bibliography": {
      const bibliography =
        (await readFileAsJson<BibEntry[]>(BIBLIOGRAPHY_PATH)) ?? [];
      return Array.isArray(bibliography) ? bibliography : [];
    }
  }
}

/** Load the folio ids that scope the per-folio sections. */
async function loadFolioIds(): Promise<Set<string>> {
  const folios = await loadFoliosFromIdb();
  const activeFolioId = await loadActiveFolioIdFromIdb();
  const ids = new Set<string>(folios.map((f) => f.id));
  if (activeFolioId) ids.add(activeFolioId);
  return ids;
}

/**
 * Build a snapshot from IndexedDB/Lix.
 *
 * `sections` selects which slices are freshly read; every other slice is
 * carried over from `state.lastSnapshot`. A null cache forces a full build
 * (the honest starting position on sign-in).
 */
async function buildLocalSnapshot(
  sections?: Iterable<PushSection>,
): Promise<LocalSnapshot> {
  const wanted = new Set(sections ?? ALL_PUSH_SECTIONS);
  const previous = state.lastSnapshot;
  const cached = previous ?? {
    briefs: [],
    folios: [],
    folioContent: [],
    customPersonas: null,
    personaNotes: [],
    personaReplies: [],
    rubricResults: [],
    bibliography: [],
  };

  const next: LocalSnapshot = { ...cached };
  const folioIds = await loadFolioIds();
  // A carried-over section may reference folios that no longer exist (the
  // cache is only invalidated for the sections that moved). Orphaned rows must
  // not ride along: they are exactly the ghosts a later pull would resurrect.
  // Rows with no folio at all are legacy/global and stay.
  next.briefs = next.briefs.filter((b) => {
    const folioId = b.folioId ?? "";
    return folioId === "" || folioIds.has(folioId);
  });
  next.folioContent = next.folioContent.filter((c) => {
    const folioId = c.folioId ?? "";
    return folioId === "" || folioIds.has(folioId);
  });
  next.personaNotes = next.personaNotes.filter((n) => {
    const folioId = n.folioId ?? "";
    return folioId === "" || folioIds.has(folioId);
  });
  next.personaReplies = next.personaReplies.filter((r) => {
    const folioId = r.folioId ?? "";
    return folioId === "" || folioIds.has(folioId);
  });
  next.rubricResults = next.rubricResults.filter((r) => {
    const folioId = r.folioId ?? "";
    return folioId === "" || folioIds.has(folioId);
  });
  for (const section of wanted) {
    const value = await loadSnapshotSection(section, folioIds);
    switch (section) {
      case "briefs":
        next.briefs = value as LocalSnapshot["briefs"];
        break;
      case "folios":
        next.folios = value as LocalSnapshot["folios"];
        break;
      case "folioContent":
        next.folioContent = value as LocalSnapshot["folioContent"];
        break;
      case "customPersonas":
        next.customPersonas = value as LocalSnapshot["customPersonas"];
        break;
      case "personaNotes":
        next.personaNotes = value as LocalSnapshot["personaNotes"];
        break;
      case "personaReplies":
        next.personaReplies = value as LocalSnapshot["personaReplies"];
        break;
      case "rubricResults":
        next.rubricResults = value as LocalSnapshot["rubricResults"];
        break;
      case "bibliography":
        next.bibliography = value as LocalSnapshot["bibliography"];
        break;
    }
  }
  return next;
}

/** Everything the server could be told, in the shape it accepts. */
function buildPushPayload(snap: LocalSnapshot) {
  return {
    briefs: snap.briefs,
    folios: snap.folios,
    folioContent: snap.folioContent.map(({ folioId, html }) => ({
      folioId,
      html,
    })),
    customPersonas: snap.customPersonas,
    personaNotes: snap.personaNotes.map((n) => ({
      folioId: n.folioId ?? "",
      noteId: n.noteId ?? `pn-${n.personaId}-${n.timestamp}`,
      personaId: n.personaId,
      personaName: n.personaName,
      personaColor: n.personaColor,
      type: n.type,
      feedback: n.feedback,
      traceId: n.traceId,
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
  };
}

/**
 * Compared by serialization rather than by reference or by `updatedAt`.
 *
 * The rows come from IndexedDB and are rebuilt the same way every time, so
 * key order is stable and this is reliable in the direction that matters: two
 * different values never compare equal. The worst a false difference can do is
 * send a row that did not need sending, which is what the old code did to
 * every row on every push.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Rows whose content differs from the last acknowledged push. */
function changedRows<T>(
  next: T[],
  previous: T[] | undefined,
  identify: (row: T) => string,
): T[] {
  if (!previous) return next;
  const before = new Map(
    previous.map((row) => [identify(row), serialize(row)]),
  );
  return next.filter((row) => before.get(identify(row)) !== serialize(row));
}

/**
 * Rows present in the last acknowledged push but missing from the next
 * snapshot. These were deleted locally and have to be told to leave the server
 * too — a section that only ever upserts would otherwise keep them forever.
 */
function removedRows<T>(
  next: T[],
  previous: T[] | undefined,
  identify: (row: T) => string,
): string[] {
  if (!previous) return [];
  const keys = new Set(next.map(identify));
  return previous
    .filter((row) => !keys.has(identify(row)))
    .map((row) => identify(row));
}

/**
 * Sections the server replaces wholesale go up entire or not at all; sections
 * it upserts row by row go up as only the rows that moved. `undefined` means
 * "leave this alone", which is how `pushAll` reads a missing argument.
 *
 * Returns null when there is nothing to say.
 */
function diffPushPayload(
  next: PushPayload,
  previous: PushPayload | null,
): PushChanges | null {
  const briefs = changedRows(next.briefs, previous?.briefs, (b) => b.folioId);
  const folioContent = changedRows(
    next.folioContent,
    previous?.folioContent,
    (c) => c.folioId,
  );
  const personaNotes = changedRows(
    next.personaNotes,
    previous?.personaNotes,
    (n) => n.noteId,
  );
  const personaReplies = changedRows(
    next.personaReplies,
    previous?.personaReplies,
    (r) => r.replyId,
  );
  const rubricResults = changedRows(
    next.rubricResults,
    previous?.rubricResults,
    (r) => r.folioId,
  );
  const removedBriefFolioIds = removedRows(
    next.briefs,
    previous?.briefs,
    (b) => b.folioId,
  );
  const removedFolioContentIds = removedRows(
    next.folioContent,
    previous?.folioContent,
    (c) => c.folioId,
  );
  const removedPersonaNoteIds = removedRows(
    next.personaNotes,
    previous?.personaNotes,
    (n) => n.noteId,
  );
  const removedPersonaReplyIds = removedRows(
    next.personaReplies,
    previous?.personaReplies,
    (r) => r.replyId,
  );
  const removedRubricFolioIds = removedRows(
    next.rubricResults,
    previous?.rubricResults,
    (r) => r.folioId,
  );
  const foliosMoved = serialize(next.folios) !== serialize(previous?.folios);
  const personasMoved =
    serialize(next.customPersonas) !== serialize(previous?.customPersonas);
  const bibliographyMoved =
    serialize(next.bibliography) !== serialize(previous?.bibliography);

  const nothingMoved =
    briefs.length === 0 &&
    folioContent.length === 0 &&
    personaNotes.length === 0 &&
    personaReplies.length === 0 &&
    rubricResults.length === 0 &&
    removedBriefFolioIds.length === 0 &&
    removedFolioContentIds.length === 0 &&
    removedPersonaNoteIds.length === 0 &&
    removedPersonaReplyIds.length === 0 &&
    removedRubricFolioIds.length === 0 &&
    !foliosMoved &&
    !personasMoved &&
    !bibliographyMoved;
  if (nothingMoved) return null;

  return {
    briefs: briefs.length ? briefs : undefined,
    folios: foliosMoved ? next.folios : undefined,
    folioContent: folioContent.length ? folioContent : undefined,
    customPersonas:
      personasMoved && next.customPersonas ? next.customPersonas : undefined,
    personaNotes: personaNotes.length ? personaNotes : undefined,
    personaReplies: personaReplies.length ? personaReplies : undefined,
    rubricResults: rubricResults.length ? rubricResults : undefined,
    bibliography: bibliographyMoved ? next.bibliography : undefined,
    removedBriefFolioIds: removedBriefFolioIds.length
      ? removedBriefFolioIds
      : undefined,
    removedFolioContentIds: removedFolioContentIds.length
      ? removedFolioContentIds
      : undefined,
    removedPersonaNoteIds: removedPersonaNoteIds.length
      ? removedPersonaNoteIds
      : undefined,
    removedPersonaReplyIds: removedPersonaReplyIds.length
      ? removedPersonaReplyIds
      : undefined,
    removedRubricFolioIds: removedRubricFolioIds.length
      ? removedRubricFolioIds
      : undefined,
  };
}

async function pushLocalSnapshot(): Promise<void> {
  if (!state.client || !state.userId) return;
  if (typeof window === "undefined") return;
  // Never run two pushes concurrently. `pushTimer` is cleared before the async
  // body runs, so a `markDirty` mid-push can arm a second one — and both would
  // diff against the same `state.lastPushed`, with whichever mutation resolved
  // last winning the write-back. A slow earlier push could then re-ratify a
  // payload a later push had already superseded, and every subsequent diff
  // would consider the difference already sent. Queue instead.
  if (state.pushing) {
    pushAgainWhenDone = true;
    return;
  }
  state.pushing = true;
  notifyStatusChange();
  const dirty = state.dirtySections;
  state.dirtySections = new Set<PushSection>();
  try {
    // Rebuild only the sections that moved since the last push. The diff
    // against `lastPushed` is still against the full payload, so a clean
    // section reports "unchanged" and gets skipped on the wire.
    const snapshot = await buildLocalSnapshot(dirty);
    const payload = buildPushPayload(snapshot);
    const changes = diffPushPayload(payload, state.lastPushed);
    if (changes) {
      const result = await state.client.mutation(api.sync.pushAll, {
        ...changes,
        expectedRevision: state.remoteRevision ?? undefined,
      });
      // Only now is the server known to hold this. A push that threw leaves
      // `lastPushed` where it was, so the next one carries the whole gap.
      state.lastPushed = payload;
      if (result && typeof result.revision === "number") {
        state.remoteRevision = result.revision;
      }
    }
    state.lastSnapshot = snapshot;
    // Success: clear the error and stamp the synced time.
    state.lastSyncedAt = Date.now();
    state.lastErrorAt = null;
    state.lastErrorMessage = null;
  } catch (err) {
    if (isSyncConflict(err)) {
      await reconcileSyncConflict();
      pushAgainWhenDone = true;
      return;
    }
    // The snapshots may not have reached the server — keep those sections
    // dirty so the next push rebuilds rather than skips exactly them.
    if (dirty) {
      for (const section of dirty) state.dirtySections.add(section);
    }
    setSyncFailure(err, "push-all");
  } finally {
    state.pushing = false;
    notifyStatusChange();
    if (pushAgainWhenDone) {
      pushAgainWhenDone = false;
      void pushLocalSnapshot();
    }
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
  //
  // Deliberately does not prime `lastPushed`: nothing here has reached the
  // server yet, and claiming otherwise would let the diff conclude there is
  // nothing to send on exactly the path that seeds an empty account.
  const local = await buildLocalSnapshot();

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
  state.remoteRevision = remote.syncRevision;

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

function startRemoteSubscription(
  client: ConvexSyncClient,
  userId: string,
): void {
  if (typeof client.onUpdate !== "function") return;
  remoteUnsubscribe?.();
  remoteUnsubscribe = client.onUpdate(
    api.sync.pullAll,
    {},
    (snapshot) => {
      if (!snapshot || state.client !== client || state.userId !== userId) {
        return;
      }
      remoteApplyChain = remoteApplyChain
        .then(() => handleRemoteSnapshot(snapshot as SyncedSnapshot))
        .catch((err) => {
          setSyncFailure(err, "remote-update");
          notifyStatusChange();
        });
    },
    (err) => {
      if (state.client !== client || state.userId !== userId) return;
      setSyncFailure(err, "remote-subscription");
      notifyStatusChange();
    },
  );
}

async function handleRemoteSnapshot(remote: SyncedSnapshot): Promise<void> {
  if (remote.syncRevision <= (state.remoteRevision ?? -1)) return;

  // Unsent local work remains authoritative. Keeping the older revision here
  // deliberately makes the pending push conflict, which enters the tested
  // pull, merge, and retry path instead of silently accepting remote changes.
  if (state.pushing || state.dirtySections.size > 0) return;

  const local = await buildLocalSnapshot();
  await replaceFromRemote(local, remote);
  const replaced = await buildLocalSnapshot();
  state.remoteRevision = remote.syncRevision;
  state.lastSnapshot = replaced;
  state.lastPushed = buildPushPayload(replaced);
  state.lastSyncedAt = Date.now();
  state.lastErrorAt = null;
  state.lastErrorMessage = null;
  window.dispatchEvent(
    new CustomEvent("twyne:remote-sync", {
      detail: { revision: remote.syncRevision, reason: "subscription" },
    }),
  );
  notifyStatusChange();
}

/** Replace a clean local cache with the authoritative remote snapshot. Unlike
 * sign-in conflict merging, this path mirrors deletions as well as additions. */
async function replaceFromRemote(
  local: LocalSnapshot,
  remote: SyncedSnapshot,
): Promise<void> {
  const remoteFolioIds = new Set(remote.folios.map((folio) => folio.id));
  for (const folio of local.folios) {
    if (!remoteFolioIds.has(folio.id)) await deleteFolioFromIdb(folio.id);
  }
  await saveFoliosToIdb(remote.folios);

  const remoteBriefIds = new Set(remote.briefs.map((entry) => entry.folioId));
  for (const entry of local.briefs) {
    if (!remoteBriefIds.has(entry.folioId)) {
      await deleteBriefFromIdb(entry.folioId);
    }
  }
  for (const entry of remote.briefs) {
    await saveBriefToIdb(entry.folioId, entry.brief);
    await writeFileAsJson(`/folios/${entry.folioId}/brief.json`, entry.brief);
  }

  const remoteContentIds = new Set(
    remote.folioContent.map((entry) => entry.folioId),
  );
  for (const entry of local.folioContent) {
    if (!remoteContentIds.has(entry.folioId)) {
      await deleteFolioContentFromIdb(entry.folioId);
    }
  }
  for (const entry of remote.folioContent) {
    await saveFolioContentToIdb(entry.folioId, entry.html);
  }

  await savePersonasToIdb(remote.customPersonas ?? []);

  const notesByFolio = new Map<string, PersonaFeedback[]>();
  for (const folio of local.folios) notesByFolio.set(folio.id, []);
  for (const note of remote.personaNotes) {
    const folioId = note.folioId;
    if (!folioId) continue;
    notesByFolio.set(folioId, [
      ...(notesByFolio.get(folioId) ?? []),
      { ...note, folioId, timestamp: note.createdAt },
    ]);
  }
  for (const [folioId, notes] of notesByFolio) {
    await writeFileAsJson(folioArtifactPath(folioId, "persona-notes.json"), notes);
  }

  const repliesByFolio = new Map<string, PersonaReply[]>();
  for (const folio of local.folios) repliesByFolio.set(folio.id, []);
  for (const reply of remote.personaReplies) {
    const folioId = reply.folioId;
    if (!folioId) continue;
    repliesByFolio.set(folioId, [
      ...(repliesByFolio.get(folioId) ?? []),
      {
        id: reply.replyId,
        folioId,
        noteId: reply.noteId,
        author: reply.author,
        authorKind: reply.authorKind,
        personaId: reply.personaId,
        text: reply.text,
        timestamp: reply.createdAt,
      },
    ]);
  }
  for (const [folioId, replies] of repliesByFolio) {
    await writeFileAsJson(
      folioArtifactPath(folioId, "persona-replies.json"),
      replies,
    );
  }

  const remoteRubricIds = new Set(
    remote.rubricResults.flatMap((entry) =>
      entry.folioId ? [entry.folioId] : [],
    ),
  );
  for (const entry of local.rubricResults) {
    if (!remoteRubricIds.has(entry.folioId)) {
      await deleteRubricResultFromIdb(entry.folioId);
      await writeFileAsJson(
        folioArtifactPath(entry.folioId, "rubric-result.json"),
        null,
      );
    }
  }
  for (const entry of remote.rubricResults) {
    if (!entry.folioId) continue;
    const result = { ...entry.result, folioId: entry.folioId };
    await saveRubricResultToIdb(result, entry.folioId);
    await writeFileAsJson(
      folioArtifactPath(entry.folioId, "rubric-result.json"),
      result,
    );
  }

  await writeFileAsJson(BIBLIOGRAPHY_PATH, remote.bibliography ?? []);

  const activeFolioId = await loadActiveFolioIdFromIdb();
  if (!activeFolioId || !remoteFolioIds.has(activeFolioId)) {
    if (remote.folios[0]) {
      await saveActiveFolioIdToIdb(remote.folios[0].id);
    } else {
      await clearActiveFolioIdFromIdb();
    }
  }
  await persistToIdb();
}

function isSyncConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    data?: { code?: unknown };
    message?: unknown;
  };
  return (
    candidate.data?.code === "SYNC_CONFLICT" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("SYNC_CONFLICT"))
  );
}

/**
 * A stale device never retries its rejected payload blindly. Pull the current
 * server snapshot, merge it with the still-authoritative local session, then
 * queue one full optimistic push against the revision just observed.
 */
async function reconcileSyncConflict(): Promise<void> {
  if (!state.client || !state.userId) return;
  const local = await buildLocalSnapshot();
  const remote = (await state.client.query(
    api.sync.pullAll,
    {},
  )) as SyncedSnapshot;
  await mergeFromRemote(local, remote);
  state.remoteRevision = remote.syncRevision;
  state.lastPushed = null;
  state.lastSnapshot = null;
  for (const section of ALL_PUSH_SECTIONS) state.dirtySections.add(section);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("twyne:remote-sync", {
        detail: { revision: remote.syncRevision, reason: "conflict" },
      }),
    );
  }
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
      ? local.briefs.find((candidate) => candidate.folioId === targetFolioId)
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
    if (!localEntry || fc.updatedAt > localEntry.updatedAt) {
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
    if (!localRubric || remoteRubric.updatedAt > (localRubric.timestamp ?? 0)) {
      await saveRubricLocally({ ...remoteRubric.result, folioId }, folioId);
      await saveRubricResultToIdb({ ...remoteRubric.result, folioId }, folioId);
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

  // Everything we merged back into IndexedDB/Lix must be re-read on the next
  // push; otherwise the section cache would ratify stale pre-merge rows.
  for (const section of ALL_PUSH_SECTIONS) state.dirtySections.add(section);
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

/** Save the custom editorial board locally and queue its single sync path. */
export async function saveCustomPersonasLocally(
  personas: Persona[],
): Promise<void> {
  if (typeof window === "undefined") return;
  await savePersonasToIdb(personas);
  markDirty(["customPersonas"]);
}

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
  const current = (await readFileAsJson<PersonaFeedback[]>(path)) ?? [];
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
  if (stored.type === "critique" || stored.type === "suggestion") {
    await createRevisionTask({
      folioId,
      title: stored.feedback.slice(0, 140),
      detail: stored.anchor,
      source: "feedback",
      sourceId: noteId,
    });
  }
  markDirty(["personaNotes"]);
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
  markDirty(["personaNotes"]);
}

export async function addPersonaReplyLocally(
  reply: PersonaReply,
  folioId = reply.folioId ?? "",
): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  const path = folioArtifactPath(folioId, "persona-replies.json");
  const current = (await readFileAsJson<PersonaReply[]>(path)) ?? [];
  current.push({ ...reply, folioId });
  await writeFileAsJson(path, current);
  markDirty(["personaReplies"]);
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
  markDirty(["rubricResults"]);
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
  await createRevisionTask({
    folioId,
    title:
      suggestion.rationale ||
      `Review ${suggestion.personaName}'s proposed edit`,
    detail: suggestion.replacement,
    source: "suggestion",
    sourceId: suggestion.id,
  });
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
export async function strikeRoomLocally(folioId: string): Promise<void> {
  if (typeof window === "undefined" || !folioId) return;
  const notesPath = folioArtifactPath(folioId, "persona-notes.json");
  const repliesPath = folioArtifactPath(folioId, "persona-replies.json");

  // Read the note ids *before* clearing. This used to write `[]` first and
  // then read the file it had just emptied, so the removal loop always saw
  // zero notes and every note survived on the server — a strike that struck
  // nothing. Enumerate, then clear, then tell the server.
  const notes = (await readFileAsJson<PersonaFeedback[]>(notesPath)) ?? [];
  const noteIds = notes.map((n) => n.noteId).filter((id): id is string => !!id);

  await writeFileAsJson(notesPath, []);
  await writeFileAsJson(repliesPath, []);

  if (state.client && state.userId) {
    try {
      await Promise.all(
        noteIds.map((noteId) =>
          state.client!.mutation(api.sync.removePersonaNote, { noteId }),
        ),
      );
    } catch (err) {
      // The local clear stands regardless; the section stays dirty below so
      // the next push reconciles the removals through the deletion channel.
      reportApplicationDiagnostic("twyne:sync:strike-room", err, {
        operation: "strike-room",
      });
    }
  }
  markDirty(["personaNotes", "personaReplies"]);
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
