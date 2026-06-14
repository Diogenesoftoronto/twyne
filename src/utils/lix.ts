/**
 * Lix-backed document store. The bibliography, the draft blocks, and the
 * change proposals all live inside one in-memory Lix blob that gets
 * persisted to IndexedDB. A single Lix instance is lazily opened per tab;
 * subsequent calls re-use it.
 *
 * The heavy work is delegated to `@lix-js/sdk` + `@lix-js/plugin-json`.
 * The file-backed primitives (`readFileAsJson` / `writeFileAsJson`) treat
 * a Lix "file" as a JSON document keyed by path — that's the contract
 * the rest of the app uses.
 */

import { openLixInMemory, createVersion, switchVersion, mergeVersion, toBlob } from "@lix-js/sdk";
import { plugin as jsonPlugin } from "@lix-js/plugin-json";
import type { LixChangeProposal, LixVersion } from "../types";
import { loadLixBlobFromIdb, saveLixBlobToIdb } from "./idb";

export const DRAFT_PATH = "/draft.json";
export const BRIEF_PATH = "/brief.json";
export const COMMENTS_PATH = "/comments.json";

const PROPOSAL_PREFIX = "twyne-proposal";
const AUTOSAVE_INTERVAL_MS = 5_000;

let _lix: Awaited<ReturnType<typeof openLixInMemory>> | null = null;
let _lixPromise: Promise<Awaited<ReturnType<typeof openLixInMemory>>> | null = null;
let _autosaveTimer: ReturnType<typeof setInterval> | null = null;
let _dirty = false;

export async function getLix() {
  if (_lix) return _lix;
  if (_lixPromise) return _lixPromise;

  _lixPromise = (async () => {
    const existingBlob = await loadLixBlobFromIdb();

    _lix = await openLixInMemory({
      blob: existingBlob ?? undefined,
      providePlugins: [jsonPlugin as unknown as any],
      keyValues: [{ key: "lix-sync", value: "false" }],
    });

    startAutosave();

    return _lix;
  })();

  _lixPromise.catch(() => {
    _lixPromise = null; // allow retry on next call
  });

  return _lixPromise;
}

function markDirty() {
  _dirty = true;
}

function startAutosave() {
  if (_autosaveTimer) return;
  _autosaveTimer = setInterval(async () => {
    if (!_dirty || !_lix) return;
    _dirty = false;
    await persistToIdb();
  }, AUTOSAVE_INTERVAL_MS);

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      if (_dirty && _lix) {
        _dirty = false;
        void persistToIdb();
      }
    });
  }
}

export async function persistToIdb() {
  if (!_lix) return;
  const blob = await toBlob({ lix: _lix });
  await saveLixBlobToIdb(blob);
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

export async function writeFileAsJson(path: string, data: unknown): Promise<void> {
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
    await lix.db
      .insertInto("file")
      .values({ path, data: encoded })
      .execute();
  }
  markDirty();
}

/* ── key_value primitives ───────────────────────────────────────── */

async function kvGet(key: string): Promise<string | null> {
  const lix = await getLix();
  const row = await lix.db
    .selectFrom("key_value")
    .where("key", "=", key)
    .select("value")
    .executeTakeFirst();
  return row?.value ?? null;
}

async function kvUpsert(key: string, value: string): Promise<void> {
  const lix = await getLix();
  const existing = await lix.db
    .selectFrom("key_value")
    .where("key", "=", key)
    .select("key")
    .executeTakeFirst();
  if (existing) {
    await lix.db.updateTable("key_value").set({ value }).where("key", "=", key).execute();
  } else {
    await lix.db.insertInto("key_value").values({ key, value }).execute();
  }
}

/* ── Draft mirror: one key_value entry per top-level manuscript block ─ */

export interface DraftBlock {
  id: string;
  html: string;
}

const blockKey = (folioId: string, blockId: string) => `tw:draft:${folioId}:block:${blockId}`;
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
 * Mirror the live manuscript into Lix key_value entries on the current
 * version. Called from the editor's debounced autosave. Overwrites all block
 * keys and the order list for the folio.
 */
export async function syncDraftToLix(folioId: string, html: string): Promise<void> {
  if (!folioId) return;
  const blocks = splitBlocks(html);
  for (const b of blocks) await kvUpsert(blockKey(folioId, b.id), b.html);
  await kvUpsert(orderKey(folioId), JSON.stringify(blocks.map((b) => b.id)));
  markDirty();
}

export async function getDraftBlocks(folioId: string): Promise<DraftBlock[]> {
  const order = await kvGet(orderKey(folioId));
  if (!order) return [];
  const ids = JSON.parse(order) as string[];
  const blocks: DraftBlock[] = [];
  for (const id of ids) {
    const html = await kvGet(blockKey(folioId, id));
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
  await kvUpsert(blockKey(folioId, blockId), html);
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
export async function proposeBlockEdit(args: ProposeBlockEditArgs): Promise<string> {
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
  return kvGet(blockKey(folioId, blockId));
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

export async function createAgentVersion(agentName: string): Promise<LixVersion> {
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

export async function mergeAgentChanges(sourceVersionId: string): Promise<void> {
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
  const rows = await lix.db
    .selectFrom("version")
    .selectAll()
    .execute();
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
      { key: `${PROPOSAL_PREFIX}-${proposalId}-source`, value: sourceVersionId },
      { key: `${PROPOSAL_PREFIX}-${proposalId}-target`, value: target.id },
      { key: `${PROPOSAL_PREFIX}-${proposalId}-author`, value: authorName },
      { key: `${PROPOSAL_PREFIX}-${proposalId}-created`, value: String(Date.now()) },
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
    const id = row.key.replace(`${PROPOSAL_PREFIX}-`, "").replace("-status", "");
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

export async function acceptChangeProposal(proposal: LixChangeProposal): Promise<void> {
  const lix = await getLix();
  await mergeAgentChanges(proposal.sourceVersionId);
  await lix.db
    .updateTable("key_value")
    .set({ value: "accepted" })
    .where("key", "=", `${PROPOSAL_PREFIX}-${proposal.id}-status`)
    .execute();
  markDirty();
}

export async function rejectChangeProposal(proposal: LixChangeProposal): Promise<void> {
  const lix = await getLix();
  await lix.db
    .updateTable("key_value")
    .set({ value: "rejected" })
    .where("key", "=", `${PROPOSAL_PREFIX}-${proposal.id}-status`)
    .execute();
  markDirty();
}
