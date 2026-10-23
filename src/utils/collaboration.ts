/**
 * Client-side multiplayer helpers.
 *
 * Three flows:
 *
 *   1. Share (owner): open a fresh Lix holding only the active folio's
 *      manuscript → upload it through `shareFolio` → enable sync on it.
 *   2. Join (collaborator): accept any pending invitation → GET the blob via
 *      the LSP `get-v1` endpoint → open it as the shared session.
 *   3. Presence: heartbeat every 3s with cursor + selection; subscribe to
 *      `getPresence` for the live roster.
 *
 * The shared Lix is separate from the writer's local store (see the shared
 * session in lix.ts), so other folios, the bibliography and pending
 * suggestions never leave the device. The SDK's sync loop starts with every
 * open Lix and pushes/pulls through /lsp/* once `lix_sync` is "true" and
 * `lix_server_url` is set.
 */
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  closeSharedLix,
  enableSharedSync,
  installSharedLix,
  openCachedSharedLix,
  openShareableLix,
  persistSharedLix,
  sharedLixBlob,
  sharedSessionLixId,
  syncDraftToLix,
  readSharedDraft,
  writeSharedDraft,
} from "./lix";
import { closeLix, openLixInMemory } from "@lix-js/sdk";
import {
  loadFolioContentSnapshotFromIdb,
  saveSharedRecoveryToIdb,
} from "./idb";
import { sameSharedDraft, type SharedDraftCopy } from "./shared-reconciliation";
import type { SharedReviewRequest } from "../components/collaboration/shared-reconciliation-dialog";

/** The SDK appends `/lsp/<route>` itself, so this is the bare site origin. */
function lixServerUrl(): string {
  const baseUrl = (
    (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? ""
  ).replace(/\/$/, "");
  if (!baseUrl) throw new Error("CONVEX_SITE_URL not configured");
  return baseUrl;
}

const PRESENCE_INTERVAL_MS = 3000;
const PRESENCE_STALE_MS = 30_000;

let _presenceTimer: ReturnType<typeof setInterval> | null = null;
let _currentLixId: string | null = null;
let _presenceOnHide: (() => void) | null = null;

export const DRAFT_SNAPSHOT_REQUEST = "twyne:request-draft-snapshot";

export interface DraftSnapshotRequest {
  folioId: string;
  html?: string;
}

/** Read the canonical HTML directly from the mounted Tiptap editor. */
export function requestActiveDraftSnapshot(folioId: string): string {
  if (typeof window === "undefined") {
    throw new Error("The manuscript editor is not available.");
  }
  const detail: DraftSnapshotRequest = { folioId };
  window.dispatchEvent(
    new CustomEvent<DraftSnapshotRequest>(DRAFT_SNAPSHOT_REQUEST, { detail }),
  );
  if (detail.html === undefined) {
    throw new Error("The manuscript is still opening. Try sharing again.");
  }
  return detail.html;
}

/**
 * Promote a local folio to a shared, server-hosted Lix instance containing
 * only that folio's manuscript. Returns the new document's lixId.
 */
export async function promoteToShared(
  client: ConvexClient,
  folioId: string,
  folioName: string,
  draftHtml: string,
  options: { isCurrent?: () => boolean } = {},
): Promise<{ lixId: string; alreadyShared: boolean } | null> {
  const isCurrent = options.isCurrent ?? (() => true);
  const serverUrl = lixServerUrl();
  const draftLixId = await openShareableLix(folioId, isCurrent);
  if (!draftLixId) return null;
  let result: { lixId: string; alreadyShared: boolean };
  try {
    await syncDraftToLix(folioId, draftHtml);
    const blob = await sharedLixBlob();
    if (!isCurrent()) {
      await closeSharedLix(draftLixId);
      return null;
    }
    result = await client.action(api.collaboration.shareFolio, {
      folioId,
      folioName,
      lixId: draftLixId,
      blob: await blob.arrayBuffer(),
    });
    if (!isCurrent()) {
      await closeSharedLix(draftLixId);
      return null;
    }
    if (!result.alreadyShared) await enableSharedSync(serverUrl);
  } catch (error) {
    await closeSharedLix(draftLixId);
    throw error;
  }
  if (result.alreadyShared) {
    // Another tab shared this folio first. Open that document instead of
    // the copy just built, which the server discarded.
    await closeSharedLix(draftLixId);
    if (!(await joinSharedLix(client, result.lixId, { isCurrent })))
      return null;
    return { lixId: result.lixId, alreadyShared: true };
  }
  _currentLixId = draftLixId;
  return { lixId: draftLixId, alreadyShared: false };
}

/**
 * Open a shared document: fetch its blob from the relay, open it as the
 * shared session for its folio, and start syncing. Owners reopening their
 * own share use this too, so their edits keep flowing after a reload.
 */
export async function joinSharedLix(
  client: ConvexClient,
  lixId: string,
  options: {
    isCurrent?: () => boolean;
    getLocalDraft?: () => Promise<SharedDraftCopy | null>;
    review?: (
      request: SharedReviewRequest,
    ) => Promise<SharedDraftCopy | "retry" | null>;
  } = {},
): Promise<{
  folioId: string;
  role: "owner" | "editor" | "commenter";
  html: string;
  reviewedLocal?: SharedDraftCopy;
} | null> {
  const generation = ++_joinGeneration;
  const initialPath =
    typeof window === "undefined" ? null : window.location.pathname;
  const isCurrent = () =>
    generation === _joinGeneration &&
    options.isCurrent?.() !== false &&
    (initialPath === null || window.location.pathname === initialPath);
  const meta = await client.query(api.collaboration.getSharedLixMeta, {
    lixId,
  });
  if (!isCurrent()) return null;
  if (!meta) throw new Error("Not a collaborator on this document.");
  if (sharedSessionLixId() === lixId) {
    const blocks = await getDraftBlocks(meta.folioId);
    return isCurrent()
      ? {
          folioId: meta.folioId,
          role: meta.role,
          html: blocks.map((b) => b.html).join(""),
        }
      : null;
  }

  const serverUrl = lixServerUrl();
  // Both candidates stay unsynced until the writer has reviewed differences.
  // The cached copy (including an unmirrored IndexedDB tail) remains intact.
  const cached = await openCachedSharedLix(lixId, meta.folioId);
  const cachedDraft = cached
    ? await readSharedDraft(cached, meta.folioId)
    : null;
  if (cached) await closeLix({ lix: cached });
  const getLocal =
    options.getLocalDraft ??
    (async () => {
      let draft =
        cachedDraft ?? (await loadFolioContentSnapshotFromIdb(meta.folioId));
      // Read the live editor too: its debounce may not have reached IndexedDB.
      try {
        const html = requestActiveDraftSnapshot(meta.folioId);
        const source: { folioId: string; source?: string } = {
          folioId: meta.folioId,
        };
        window.dispatchEvent(
          new CustomEvent("twyne:request-typst-source", { detail: source }),
        );
        draft = {
          html,
          ...(source.source !== undefined
            ? { typstSource: source.source }
            : {}),
        };
      } catch {
        /* This shared folio is not mounted. Use its durable copy. */
      }
      return draft;
    });
  const review =
    options.review ??
    (async (request: SharedReviewRequest) =>
      (
        await import("../components/collaboration/shared-reconciliation-dialog")
      ).requestSharedReview(request));
  const fetchCopy = async () => {
    const resp = await fetch(`${serverUrl}/lsp/get-v1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lix_id: lixId }),
    });
    if (!isCurrent()) return null;
    if (!resp.ok)
      throw new Error(`Failed to fetch shared Lix (${resp.status})`);
    return openLixInMemory({
      blob: await resp.blob(),
      keyValues: [{ key: "lix_sync", value: "false" }],
      providePlugins: [
        (await import("@lix-js/plugin-json")).plugin as unknown as any,
      ],
    });
  };
  let changedSinceReview = false;
  while (isCurrent()) {
    const local = await getLocal();
    if (!isCurrent()) return null;
    let lix: Awaited<ReturnType<typeof openLixInMemory>> | null = null;
    let installed = false;
    let releaseReview: (() => void) | undefined;
    try {
      try {
        lix = await fetchCopy();
      } catch (error) {
        if (!isCurrent()) return null;
        // Authentication/transport failures cannot silently replace local work
        // or enable a background push. Retry is explicit (or on reconnect).
        if (!local) throw error;
        const retry = await review({
          local,
          shared: null,
          role: meta.role,
          isCurrent,
        });
        if (retry === "retry") continue;
        return null;
      }
      if (!lix || !isCurrent()) return null;
      const shared = await readSharedDraft(lix, meta.folioId);
      let chosen = shared;
      if (local && !sameSharedDraft(local, shared)) {
        const recovery = {
          lixId,
          folioId: meta.folioId,
          createdAt: Date.now(),
          local,
          shared,
        };
        // Resolve only after a committed transaction. A full disk must block
        // replacement, not leave the promise of a recovery copy unfulfilled.
        await saveSharedRecoveryToIdb(recovery);
        if (!isCurrent()) return null;
        const settled = new Promise<void>((resolve) => {
          releaseReview = resolve;
        });
        const decision = await review({
          local,
          shared,
          role: meta.role,
          isCurrent,
          changedSinceReview,
          settled,
        });
        if (!decision || decision === "retry" || !isCurrent()) return null;
        chosen = meta.role === "commenter" ? shared : decision;
        const latestLocal = await getLocal();
        let latest: Awaited<ReturnType<typeof fetchCopy>>;
        try {
          latest = await fetchCopy();
        } catch {
          changedSinceReview = true;
          continue;
        }
        if (!latest) return null;
        let latestShared: SharedDraftCopy;
        try {
          latestShared = await readSharedDraft(latest, meta.folioId);
        } finally {
          await closeLix({ lix: latest });
        }
        if (
          !latestLocal ||
          !sameSharedDraft(local, latestLocal) ||
          !sameSharedDraft(shared, latestShared)
        ) {
          changedSinceReview = true;
          continue;
        }
        await saveSharedRecoveryToIdb({ ...recovery, result: chosen });
        if (!sameSharedDraft(chosen, shared))
          await writeSharedDraft(lix, meta.folioId, chosen);
      }
      if (!isCurrent()) return null;
      // Typing can continue while the network or durable writes are pending.
      const latestLocal = await getLocal();
      if (local && latestLocal && !sameSharedDraft(local, latestLocal)) {
        changedSinceReview = true;
        continue;
      }
      if (!(await installSharedLix(lixId, meta.folioId, lix, { isCurrent })))
        return null;
      installed = true;
      if (!isCurrent()) {
        await closeSharedLix(lixId);
        return null;
      }
      window.dispatchEvent(
        new CustomEvent("twyne:typst-applying", {
          detail: { folioId: meta.folioId },
        }),
      );
      await saveFolioTypstToIdb(
        meta.folioId,
        chosen.typstSource ?? htmlToTypst(chosen.html),
        chosen.html,
        undefined,
        "remote",
      );
      if (!isCurrent()) {
        await closeSharedLix(lixId);
        return null;
      }
      await enableSharedSync(serverUrl, lix);
      _currentLixId = lixId;
      return {
        folioId: meta.folioId,
        role: meta.role,
        html: chosen.html,
        ...(local ? { reviewedLocal: local } : {}),
      };
    } catch (error) {
      if (installed) await closeSharedLix(lixId);
      throw error;
    } finally {
      releaseReview?.();
      if (lix && !installed) await closeLix({ lix });
    }
  }
  return null;
}

let _joinGeneration = 0;

/** Leave a shared document; its folio falls back to the local store. */
export async function leaveSharedLix(lixId: string): Promise<void> {
  if (sharedSessionLixId() !== lixId) return;
  await closeSharedLix(lixId);
}

/* ── Remote → local sync ────────────────────────────────────────── */

import type { Editor } from "@tiptap/core";
import { getDraftBlocks, getDraftTypstSource } from "./lix";
import { saveFolioTypstToIdb } from "./idb";
import { htmlToTypst, reconcileTypstSource } from "./typst/document";

let _remoteSyncTimer: ReturnType<typeof setInterval> | null = null;
let _lastPolledHtml: string | null = null;
let _lastPolledSource: string | null = null;
let _remoteSyncGeneration = 0;

/**
 * Poll the local Lix instance for remote changes and reflect them into the
 * Tiptap editor. `initSyncProcess` (from the Lix SDK) pulls remote change-sets
 * into the in-memory Lix in the background; this function reads the resulting
 * draft blocks every ~1.5 s and, when they differ from the last poll, updates
 * the editor content with `emitUpdate: false` so the change doesn't re-trigger
 * `syncDraftToLix`.
 *
 * Race-free by design:
 *   • When the local editor types, `syncDraftToLix` mirrors HTML→Lix (debounced).
 *     The next poll sees the same content, updates `_lastPolledHtml` to match,
 *     and skips the editor update — the editor already has this content.
 *   • Only a *remote* change (arrived via pull→merge) will make the polled HTML
 *     differ from `_lastPolledHtml`, triggering an editor update.
 */
export function watchRemoteChanges(editor: Editor, folioId: string): void {
  stopWatchingRemote();
  const generation = _remoteSyncGeneration;
  const isCurrent = () =>
    generation === _remoteSyncGeneration && !editor.isDestroyed;

  const poll = async () => {
    try {
      const blocks = await getDraftBlocks(folioId);
      const rawSource = await getDraftTypstSource(folioId);
      if (!isCurrent()) return;
      if (blocks.length === 0 && rawSource === null) return;
      const html = blocks.map((b) => b.html).join("");
      const source =
        rawSource === null ? null : reconcileTypstSource(rawSource, html);
      if (html === _lastPolledHtml && source === _lastPolledSource) return;
      _lastPolledHtml = html;
      _lastPolledSource = source;
      if (source !== null) {
        // This is a collaborator's snapshot, never an acknowledgement of
        // the writer's pending visual save or source draft.
        await saveFolioTypstToIdb(folioId, source, html, undefined, "remote");
        await persistSharedLix();
        if (!isCurrent()) return;
        window.dispatchEvent(
          new CustomEvent("twyne:typst-remote-change", {
            detail: { folioId, source, html },
          }),
        );
      }
      // Only update if the editor doesn't already have this content (avoids
      // clobbering cursor position when the change was local & already mirrored).
      const sourceDraft: { folioId: string; pending?: boolean } = { folioId };
      window.dispatchEvent(
        new CustomEvent("twyne:request-typst-source", { detail: sourceDraft }),
      );
      if (!sourceDraft.pending && editor.getHTML() !== html) {
        window.dispatchEvent(
          new CustomEvent("twyne:typst-applying", { detail: { folioId } }),
        );
        editor.commands.setContent(html, { emitUpdate: false });
      }
    } catch {
      // Lix not ready or transient — best-effort.
    }
  };

  void poll();
  _remoteSyncTimer = setInterval(poll, 1500);
}

export function stopWatchingRemote(): void {
  _remoteSyncGeneration += 1;
  if (_remoteSyncTimer) {
    clearInterval(_remoteSyncTimer);
    _remoteSyncTimer = null;
  }
  _lastPolledHtml = null;
  _lastPolledSource = null;
}

/* ── Presence ───────────────────────────────────────────────────── */

export function startPresence(
  client: ConvexClient,
  lixId: string,
  displayName?: string,
): void {
  stopPresence();
  _currentLixId = lixId;

  const beat = async () => {
    if (!_currentLixId) return;
    try {
      await client.mutation(api.collaboration.heartbeat, {
        lixId: _currentLixId,
        displayName,
      });
    } catch {
      // Non-fatal — presence is best-effort.
    }
  };

  void beat();
  _presenceTimer = setInterval(beat, PRESENCE_INTERVAL_MS);

  // Stop presence when the tab is hidden/closed. Track the listener so it
  // can be removed in stopPresence (prevents leaking across folio switches).
  if (typeof window !== "undefined") {
    _presenceOnHide = () => void beat();
    document.addEventListener("visibilitychange", _presenceOnHide);
    window.addEventListener("beforeunload", _presenceOnHide);
  }
}

export function stopPresence(): void {
  if (_presenceTimer) {
    clearInterval(_presenceTimer);
    _presenceTimer = null;
  }
  if (_presenceOnHide && typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", _presenceOnHide);
    window.removeEventListener("beforeunload", _presenceOnHide);
    _presenceOnHide = null;
  }
  _currentLixId = null;
}

export function updateCursor(
  client: ConvexClient,
  cursorPos: number | undefined,
  selectionAnchor?: number,
  selectionHead?: number,
): void {
  if (!_currentLixId) return;
  void client.mutation(api.collaboration.heartbeat, {
    lixId: _currentLixId,
    cursorPos,
    selectionAnchor,
    selectionHead,
  });
}

export const PRESENCE_STALE = PRESENCE_STALE_MS;
