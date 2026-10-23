import { loadFolioContentSnapshotFromIdb } from "./idb";
import { reconcileTypstSource } from "./typst/document";
/**
 * Lix-backed document store. The bibliography, the draft blocks, and the
 * change proposals all live inside one in-memory Lix blob that gets
 * persisted to IndexedDB. A single Lix instance is lazily opened per tab;
 * subsequent calls re-use it. A shared folio's draft lives in a separate
 * synced Lix (see "Shared session" below).
 *
 * The heavy work is delegated to `@lix-js/sdk` + `@lix-js/plugin-json`.
 * The file-backed primitives (`readFileAsJson` / `writeFileAsJson`) treat
 * a Lix "file" as a JSON document keyed by path — that's the contract
 * the rest of the app uses.
 */

import {
  closeLix,
  openLixInMemory,
  createVersion,
  switchVersion,
  mergeVersion,
  toBlob,
} from "@lix-js/sdk";
import { plugin as jsonPlugin } from "@lix-js/plugin-json";
import type { LixChangeProposal, LixVersion } from "../types";
import {
  loadLixBlobFromIdb,
  saveLixBlobToIdb,
  loadSharedLixSnapshotFromIdb,
  saveSharedLixSnapshotToIdb,
  type SharedLixSnapshot,
} from "./idb";

export const DRAFT_PATH = "/draft.json";
export const BRIEF_PATH = "/brief.json";
export const COMMENTS_PATH = "/comments.json";

const PROPOSAL_PREFIX = "twyne-proposal";
const AUTOSAVE_INTERVAL_MS = 5_000;

type LixInstance = Awaited<ReturnType<typeof openLixInMemory>>;

let _lix: LixInstance | null = null;
let _lixPromise: Promise<LixInstance> | null = null;
let _autosaveTimer: ReturnType<typeof setInterval> | null = null;
let _dirty = false;

export async function getLix(): Promise<LixInstance> {
  if (_lix) return _lix;
  if (_lixPromise) return _lixPromise;

  const opening: Promise<LixInstance> = (async () => {
    const existingBlob = await loadLixBlobFromIdb();

    const opened = await openLixInMemory({
      blob: existingBlob ?? undefined,
      providePlugins: [jsonPlugin as unknown as any],
      keyValues: [{ key: "lix_sync", value: "false" }],
    });

    _lix = opened;
    startAutosave();

    return opened;
  })();
  _lixPromise = opening;

  opening.catch(() => {
    if (_lixPromise === opening) {
      _lixPromise = null; // allow retry on next call
    }
  });

  return opening;
}

/* ── Shared session: one folio's draft, synced through the relay ──
 *
 * A shared document is its own Lix holding a single folio's manuscript. It
 * lives beside the local store, never in place of it: the local store carries
 * every folio, the bibliography and pending suggestions, so swapping it in
 * would push all of that to collaborators, and persisting the shared copy
 * would overwrite a collaborator's own work. Draft reads and writes for the
 * shared folio route here; everything else stays local and unsynced.
 */

interface SharedSession {
  lixId: string;
  folioId: string;
  lix: LixInstance;
  durable: boolean;
  saving: Promise<void>;
  checkpointDraft: SharedLixSnapshot["draft"];
}

let _shared: SharedSession | null = null;

async function lixFor(folioId: string): Promise<LixInstance> {
  return _shared?.folioId === folioId ? _shared.lix : getLix();
}

function forgetMirror(folioId: string) {
  mirroredBlocks.delete(folioId);
  mirroredSources.delete(folioId);
  mirroredOrder.delete(folioId);
}

export function sharedSessionLixId(): string | null {
  return _shared?.lixId ?? null;
}

/** Open an empty Lix that will hold only `folioId`'s manuscript. */
export async function openShareableLix(
  folioId: string,
  isCurrent: () => boolean = () => true,
): Promise<string | null> {
  const lix = await openLixInMemory({
    providePlugins: [jsonPlugin as unknown as any],
    keyValues: [{ key: "lix_sync", value: "false" }],
  });
  const row = await lix.db
    .selectFrom("key_value")
    .where("key", "=", "lix_id")
    .select("value")
    .executeTakeFirstOrThrow();
  if (
    !(await installSharedLix(row.value, folioId, lix, {
      durable: false,
      isCurrent,
    }))
  ) {
    await closeLix({ lix });
    return null;
  }
  return row.value;
}

/** Make `lix` the shared document for `folioId`, closing any previous one. */
export async function installSharedLix(
  lixId: string,
  folioId: string,
  lix: LixInstance,
  options: { isCurrent?: () => boolean; durable?: boolean } = {},
): Promise<boolean> {
  if (options.isCurrent?.() === false) return false;
  const next: SharedSession = {
    lixId,
    folioId,
    lix,
    durable: options.durable ?? true,
    saving: Promise.resolve(),
    checkpointDraft: await loadFolioContentSnapshotFromIdb(folioId),
  };
  await persistSharedSession(next);
  if (options.isCurrent?.() === false) return false;
  await closeSharedLix();
  if (options.isCurrent?.() === false) return false;
  _shared = next;
  forgetMirror(folioId);
  startAutosave();
  return true;
}

/** Restore the document's vector clock and unsent changes before pulling. */
export async function openCachedSharedLix(
  lixId: string,
  folioId: string,
): Promise<LixInstance | null> {
  const cached = await loadSharedLixSnapshotFromIdb(lixId);
  if (!cached || cached.folioId !== folioId) return null;
  const lix = await openLixInMemory({
    blob: cached.blob,
    providePlugins: [jsonPlugin as unknown as any],
    keyValues: [{ key: "lix_sync", value: "false" }],
  });
  try {
    const draft = await loadFolioContentSnapshotFromIdb(folioId);
    // The editor can commit to IndexedDB before its Lix debounce runs. Only
    // replay content changed since this checkpoint; an older unchanged local
    // snapshot must not roll back remote changes already in the cached Lix.
    if (
      draft &&
      (draft.html !== cached.draft?.html ||
        draft.typstSource !== cached.draft?.typstSource)
    ) {
      const blocks = splitBlocks(draft.html);
      await lix.db.transaction().execute(async (db) => {
        await db
          .deleteFrom("key_value")
          .where("key", "like", `tw:draft:${folioId}:%`)
          .execute();
        await db
          .insertInto("key_value")
          .values([
            ...blocks.map((block) => ({
              key: blockKey(folioId, block.id),
              value: block.html,
            })),
            {
              key: orderKey(folioId),
              value: JSON.stringify(blocks.map((block) => block.id)),
            },
            ...(draft.typstSource !== undefined
              ? [{ key: sourceKey(folioId), value: draft.typstSource }]
              : []),
          ])
          .execute();
      });
    }
    return lix;
  } catch (error) {
    await closeLix({ lix });
    throw error;
  }
}

/** Prepare a reviewed copy while sync is still disabled. */
export async function writeSharedDraft(
  lix: LixInstance,
  folioId: string,
  draft: import("./shared-reconciliation").SharedDraftCopy,
): Promise<void> {
  const blocks = splitBlocks(draft.html);
  await lix.db.transaction().execute(async (db) => {
    await db
      .deleteFrom("key_value")
      .where("key", "like", `tw:draft:${folioId}:%`)
      .execute();
    await db
      .insertInto("key_value")
      .values([
        ...blocks.map((block) => ({
          key: blockKey(folioId, block.id),
          value: block.html,
        })),
        {
          key: orderKey(folioId),
          value: JSON.stringify(blocks.map((block) => block.id)),
        },
        ...(draft.typstSource !== undefined
          ? [{ key: sourceKey(folioId), value: draft.typstSource }]
          : []),
      ])
      .execute();
  });
}

export async function readSharedDraft(lix: LixInstance, folioId: string) {
  const blocks = await getDraftBlocks(folioId, lix);
  const source = await kvGet(lix, sourceKey(folioId));
  return {
    html: blocks.map((block) => block.html).join(""),
    ...(source !== null ? { typstSource: source } : {}),
  };
}

async function persistSharedSession(session: SharedSession): Promise<void> {
  if (!session.durable) return;
  const saving = session.saving
    .catch(() => undefined)
    .then(async () => {
      const draft = await loadFolioContentSnapshotFromIdb(session.folioId);
      const blocks = await getDraftBlocks(session.folioId, session.lix);
      const source = await kvGet(session.lix, sourceKey(session.folioId));
      if (
        draft &&
        draft.html === blocks.map((block) => block.html).join("") &&
        (draft.typstSource ?? null) === source
      ) {
        session.checkpointDraft = {
          html: draft.html,
          typstSource: draft.typstSource,
        };
      }
      const blob = await toBlob({ lix: session.lix });
      await saveSharedLixSnapshotToIdb(session.lixId, {
        folioId: session.folioId,
        blob,
        draft: session.checkpointDraft,
      });
    });
  session.saving = saving;
  await saving;
}

export async function persistSharedLix(): Promise<void> {
  if (_shared) await persistSharedSession(_shared);
}

export async function sharedLixBlob(): Promise<Blob> {
  if (!_shared) throw new Error("No shared document is open.");
  return toBlob({ lix: _shared.lix });
}

/** Point the shared document at the relay and let the SDK start syncing. */
export async function enableSharedSync(
  serverUrl: string,
  lix: LixInstance | null = _shared?.lix ?? null,
): Promise<void> {
  if (!lix) throw new Error("No shared document is open.");
  for (const [key, value] of [
    ["lix_server_url", serverUrl],
    ["lix_sync", "true"],
  ]) {
    await kvUpsert(lix, key, value);
  }
  if (_shared?.lix === lix) {
    _shared.durable = true;
    await persistSharedSession(_shared);
  }
}

/**
 * Close the shared document. Closing its database stops the sync loop. With
 * `lixId`, only that document is closed, so a late close cannot tear down a
 * session opened for the next folio.
 */
export async function closeSharedLix(lixId?: string): Promise<void> {
  const previous = _shared;
  if (!previous || (lixId && previous.lixId !== lixId)) return;
  _shared = null;
  forgetMirror(previous.folioId);
  try {
    await persistSharedSession(previous);
  } finally {
    await closeLix({ lix: previous.lix });
  }
}

function markDirty() {
  _dirty = true;
}

function startAutosave() {
  if (_autosaveTimer) return;
  _autosaveTimer = setInterval(async () => {
    if (!_dirty || (!_lix && !_shared)) return;
    _dirty = false;
    await persistToIdb();
  }, AUTOSAVE_INTERVAL_MS);

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      if (_dirty && (_lix || _shared)) {
        _dirty = false;
        void persistToIdb();
      }
    });
  }
}

export async function persistToIdb() {
  await persistSharedLix();
  if (_lix) {
    const blob = await toBlob({ lix: _lix });
    await saveLixBlobToIdb(blob);
  }
}

export async function readFileAsJson<T>(path: string): Promise<T | null> {
  const lix = await getLix();
  const row = await lix.db
    .selectFrom("file")
    .where("path", "=", path)
    .select("data")
    .executeTakeFirst();
  if (!row) return null;
  const parsed = JSON.parse(new TextDecoder().decode(row.data));
  return parsed as T | null;
}

export async function writeFileAsJson(
  path: string,
  data: unknown,
): Promise<void> {
  const lix = await getLix();
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const existing = await lix.db
    .selectFrom("file")
    .where("path", "=", path)
    .select("id")
    .executeTakeFirst();

  if (existing) {
    await lix.db
      .updateTable("file")
      .set({ data: encoded })
      .where("path", "=", path)
      .execute();
  } else {
    await lix.db.insertInto("file").values({ path, data: encoded }).execute();
  }
  markDirty();
}

/* ── key_value primitives ───────────────────────────────────────── */

async function kvGet(lix: LixInstance, key: string): Promise<string | null> {
  const row = await lix.db
    .selectFrom("key_value")
    .where("key", "=", key)
    .select("value")
    .executeTakeFirst();
  return row?.value ?? null;
}

async function kvUpsert(
  lix: LixInstance,
  key: string,
  value: string,
): Promise<void> {
  const existing = await lix.db
    .selectFrom("key_value")
    .where("key", "=", key)
    .select("key")
    .executeTakeFirst();
  if (existing) {
    await lix.db
      .updateTable("key_value")
      .set({ value })
      .where("key", "=", key)
      .execute();
  } else {
    await lix.db.insertInto("key_value").values({ key, value }).execute();
  }
}

/* ── Draft mirror: one key_value entry per top-level manuscript block ─ */

export interface DraftBlock {
  id: string;
  html: string;
}

const blockKey = (folioId: string, blockId: string) =>
  `tw:draft:${folioId}:block:${blockId}`;
const orderKey = (folioId: string) => `tw:draft:${folioId}:order`;

/**
 * Split manuscript html into top-level blocks. Block ids are positional
 * (`b0`, `b1`, …) and re-derived on every mirror; proposals reference a block
 * by id captured at propose time, which is stable for the short window
 * between proposing and accepting/striking.
 */
export function splitBlocks(html: string): DraftBlock[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.body.children).map((el, i) => ({
    id: `b${i}`,
    html: el.outerHTML,
  }));
}

/**
 * What we last wrote to Lix, per folio: block id → html, plus the serialized
 * order. Lets a mirror skip blocks the writer did not touch.
 *
 * Session changes clear this folio's caches. If a remote change-set
 * overwrites a block underneath us, the local html is by definition unchanged
 * too, so skipping the write is the correct outcome — the remote value wins,
 * which is the point of pulling it.
 */
const mirroredBlocks = new Map<string, Map<string, string>>();
const mirroredOrder = new Map<string, string>();
const mirroredSources = new Map<string, string>();
const sourceKey = (folioId: string) => `tw:draft:${folioId}:typst`;

export async function getDraftTypstSource(
  folioId: string,
): Promise<string | null> {
  return kvGet(await lixFor(folioId), sourceKey(folioId));
}

/**
 * Mirror the live manuscript into Lix key_value entries on the current
 * version, writing only what actually moved.
 *
 * This used to `await` a SELECT-then-UPDATE per top-level block, in sequence.
 * Lix is SQLite compiled to WASM running on the main thread, and the JSON
 * change-control plugin records a change row per write — so a 300-paragraph
 * manuscript cost 600 serialized statements and 300 change records on every
 * autosave. `await` yielded to the microtask queue between them but the CPU
 * work stayed on the main thread, which is what made typing stutter after a
 * pause. Now it is one DELETE plus one batched INSERT covering only the
 * changed blocks, and it returns without touching the database at all when
 * nothing changed.
 */
export async function syncDraftToLix(
  folioId: string,
  html: string,
  typstSource?: string,
): Promise<void> {
  if (!folioId) return;
  const saved = await loadFolioContentSnapshotFromIdb(folioId);
  const source =
    typstSource ??
    (saved?.typstSource !== undefined
      ? saved.html === html
        ? saved.typstSource
        : reconcileTypstSource(saved.typstSource, html)
      : undefined);
  const sourceChanged =
    source !== undefined && mirroredSources.get(folioId) !== source;
  const blocks = splitBlocks(html);
  const next = new Map(blocks.map((b) => [b.id, b.html]));
  const previous = mirroredBlocks.get(folioId);
  const order = JSON.stringify(blocks.map((b) => b.id));

  const changed = previous
    ? blocks.filter((b) => previous.get(b.id) !== b.html)
    : blocks;
  const removed = previous
    ? [...previous.keys()].filter((id) => !next.has(id))
    : [];
  const orderChanged = mirroredOrder.get(folioId) !== order;

  if (!changed.length && !removed.length && !orderChanged && !sourceChanged)
    return;

  const lix = await lixFor(folioId);
  const staleKeys = [
    ...changed.map((b) => blockKey(folioId, b.id)),
    ...removed.map((id) => blockKey(folioId, id)),
    ...(orderChanged ? [orderKey(folioId)] : []),
    ...(sourceChanged ? [sourceKey(folioId)] : []),
  ];
  await lix.db.deleteFrom("key_value").where("key", "in", staleKeys).execute();

  const rows = [
    ...changed.map((b) => ({ key: blockKey(folioId, b.id), value: b.html })),
    ...(orderChanged ? [{ key: orderKey(folioId), value: order }] : []),
    ...(sourceChanged ? [{ key: sourceKey(folioId), value: source! }] : []),
  ];
  if (rows.length) {
    await lix.db.insertInto("key_value").values(rows).execute();
  }

  if (source !== undefined) mirroredSources.set(folioId, source);
  mirroredBlocks.set(folioId, next);
  mirroredOrder.set(folioId, order);
  markDirty();
  if (_shared?.lix === lix) await persistSharedSession(_shared);
}

export async function getDraftBlocks(
  folioId: string,
  lix?: LixInstance,
): Promise<DraftBlock[]> {
  lix ??= await lixFor(folioId);
  const rows = await lix.db
    .selectFrom("key_value")
    .where("key", "like", `tw:draft:${folioId}:%`)
    .select(["key", "value"])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const order = values.get(orderKey(folioId));
  if (!order) return [];
  const ids = JSON.parse(order) as string[];
  const blocks: DraftBlock[] = [];
  for (const id of ids) {
    const html = values.get(blockKey(folioId, id));
    if (html != null) blocks.push({ id, html });
  }
  return blocks;
}

/**
 * Apply a block edit on an agent's branch, then return to the writer's
 * version so their working copy is untouched until they accept. Replaces the
 * broken file-based `writeDraftInVersion` — key_value isolates correctly.
 */
export async function writeBlockInVersion(
  versionId: string,
  folioId: string,
  blockId: string,
  html: string,
): Promise<void> {
  const lix = await getLix();
  const current = await getCurrentVersion();
  await switchVersion({ lix, to: { id: versionId } });
  await kvUpsert(lix, blockKey(folioId, blockId), html);
  await switchVersion({ lix, to: { id: current.id } });
  markDirty();
}

export interface ProposeBlockEditArgs {
  folioId: string;
  personaName: string;
  blockId: string;
  /** The block's full html with the editor's replacement applied. */
  html: string;
}

/**
 * Open an editor's proposed block edit as an isolated branch. Returns the
 * branch (version) id, which the suggestion carries until accept/strike.
 */
export async function proposeBlockEdit(
  args: ProposeBlockEditArgs,
): Promise<string> {
  const version = await createAgentVersion(args.personaName);
  await writeBlockInVersion(version.id, args.folioId, args.blockId, args.html);
  return version.id;
}

/**
 * Accept a proposal: merge its branch into the writer's current version and
 * return the merged block html so the caller can reflect it into the editor.
 */
export async function acceptBlockEdit(
  versionId: string,
  folioId: string,
  blockId: string,
): Promise<string | null> {
  await mergeAgentChanges(versionId);
  return kvGet(await getLix(), blockKey(folioId, blockId));
}

export async function getCurrentVersion(): Promise<LixVersion> {
  const lix = await getLix();
  const row = await lix.db
    .selectFrom("current_version")
    .innerJoin("version", "version.id", "current_version.id")
    .selectAll("version")
    .executeTakeFirstOrThrow();
  return { id: row.id, name: row.name };
}

export async function createAgentVersion(
  agentName: string,
): Promise<LixVersion> {
  const lix = await getLix();
  const current = await getCurrentVersion();
  const version = await createVersion({
    lix,
    from: { id: current.id },
    name: agentName,
  });
  markDirty();
  return { id: version.id, name: version.name };
}

export async function switchToVersion(versionId: string): Promise<void> {
  const lix = await getLix();
  await switchVersion({ lix, to: { id: versionId } });
  markDirty();
}

export async function mergeAgentChanges(
  sourceVersionId: string,
): Promise<void> {
  const lix = await getLix();
  const current = await getCurrentVersion();
  const sourceVersion = await lix.db
    .selectFrom("version")
    .where("id", "=", sourceVersionId)
    .selectAll()
    .executeTakeFirstOrThrow();

  await mergeVersion({
    lix,
    sourceVersion,
    targetVersion: { id: current.id, name: current.name } as any,
  });
  markDirty();
}

export async function listVersions(): Promise<LixVersion[]> {
  const lix = await getLix();
  const rows = await lix.db.selectFrom("version").selectAll().execute();
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function createChangeProposal(
  authorName: string,
  sourceVersionId: string,
): Promise<LixChangeProposal> {
  const lix = await getLix();
  const target = await getCurrentVersion();
  const proposalId = crypto.randomUUID();

  await lix.db
    .insertInto("key_value")
    .values([
      { key: `${PROPOSAL_PREFIX}-${proposalId}-status`, value: "open" },
      {
        key: `${PROPOSAL_PREFIX}-${proposalId}-source`,
        value: sourceVersionId,
      },
      { key: `${PROPOSAL_PREFIX}-${proposalId}-target`, value: target.id },
      { key: `${PROPOSAL_PREFIX}-${proposalId}-author`, value: authorName },
      {
        key: `${PROPOSAL_PREFIX}-${proposalId}-created`,
        value: String(Date.now()),
      },
    ])
    .execute();

  markDirty();
  return {
    id: proposalId,
    sourceVersionId,
    targetVersionId: target.id,
    status: "open",
    authorName,
    createdAt: Date.now(),
  };
}

export async function listChangeProposals(): Promise<LixChangeProposal[]> {
  const lix = await getLix();
  const rows = await lix.db
    .selectFrom("key_value")
    .where("key", "like", `${PROPOSAL_PREFIX}-%-status`)
    .selectAll()
    .execute();

  const proposals: LixChangeProposal[] = [];
  for (const row of rows) {
    const id = row.key
      .replace(`${PROPOSAL_PREFIX}-`, "")
      .replace("-status", "");
    const sourceRow = await lix.db
      .selectFrom("key_value")
      .where("key", "=", `${PROPOSAL_PREFIX}-${id}-source`)
      .select("value")
      .executeTakeFirst();
    const targetRow = await lix.db
      .selectFrom("key_value")
      .where("key", "=", `${PROPOSAL_PREFIX}-${id}-target`)
      .select("value")
      .executeTakeFirst();
    const authorRow = await lix.db
      .selectFrom("key_value")
      .where("key", "=", `${PROPOSAL_PREFIX}-${id}-author`)
      .select("value")
      .executeTakeFirst();
    const createdRow = await lix.db
      .selectFrom("key_value")
      .where("key", "=", `${PROPOSAL_PREFIX}-${id}-created`)
      .select("value")
      .executeTakeFirst();

    proposals.push({
      id,
      sourceVersionId: sourceRow?.value ?? "",
      targetVersionId: targetRow?.value ?? "",
      status: (row.value as LixChangeProposal["status"]) ?? "open",
      authorName: authorRow?.value ?? "unknown",
      createdAt: Number(createdRow?.value ?? 0),
    });
  }

  return proposals;
}

export async function acceptChangeProposal(
  proposal: LixChangeProposal,
): Promise<void> {
  const lix = await getLix();
  await mergeAgentChanges(proposal.sourceVersionId);
  await lix.db
    .updateTable("key_value")
    .set({ value: "accepted" })
    .where("key", "=", `${PROPOSAL_PREFIX}-${proposal.id}-status`)
    .execute();
  markDirty();
}

export async function rejectChangeProposal(
  proposal: LixChangeProposal,
): Promise<void> {
  const lix = await getLix();
  await lix.db
    .updateTable("key_value")
    .set({ value: "rejected" })
    .where("key", "=", `${PROPOSAL_PREFIX}-${proposal.id}-status`)
    .execute();
  markDirty();
}
