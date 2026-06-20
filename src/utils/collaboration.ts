/**
 * Client-side multiplayer helpers.
 *
 * Three flows:
 *
 *   1. Share (owner): serialize the local Lix → call `shareFolio` mutation →
 *      open the returned Lix with sync enabled → poll presence.
 *   2. Join (collaborator): accept any pending invitation → GET the blob via
 *      the LSP `get-v1` endpoint → openLixInMemory with sync enabled →
 *      initSyncProcess keeps the local copy in sync.
 *   3. Presence: heartbeat every 3s with cursor + selection; subscribe to
 *      `getPresence` for the live roster.
 *
 * The Lix SDK's `initSyncProcess` polls the /lsp/push-v1 and /lsp/pull-v1
 * endpoints automatically — we just need to set `lix_server_url` and enable
 * sync. The merge engine (vector clocks + mergeTheirState) handles conflicts
 * without our intervention.
 */
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { getLix, persistToIdb } from "./lix";
import { openLixInMemory, toBlob } from "@lix-js/sdk";

const PRESENCE_INTERVAL_MS = 3000;
const PRESENCE_STALE_MS = 30_000;

let _presenceTimer: ReturnType<typeof setInterval> | null = null;
let _currentLixId: string | null = null;
let _presenceOnHide: (() => void) | null = null;

/**
 * Promote a local folio to a shared, server-hosted Lix instance.
 * Returns the lixId and the server URL clients use for sync.
 */
export async function promoteToShared(
  client: ConvexClient,
  folioId: string,
  folioName: string,
): Promise<{ lixId: string; serverUrl: string }> {
  const lix = await getLix();
  await persistToIdb();
  const blob = await toBlob({ lix });

  // Read the lix_id from the local Lix's key_value.
  const lixIdRow = await lix.db
    .selectFrom("key_value")
    .where("key", "=", "lix_id")
    .select("value")
    .executeTakeFirstOrThrow();
  const lixId = lixIdRow.value;

  await client.action(api.collaboration.shareFolio, {
    folioId,
    folioName,
    lixId,
    blob: await blob.arrayBuffer(),
  });

  // Enable sync on the local instance so the owner's edits flow to the server.
  const baseUrl =
    (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? "";
  const serverUrl = `${baseUrl}/lsp`;

  await lix.db
    .updateTable("key_value")
    .set({ value: "true" })
    .where("key", "=", "lix_sync")
    .execute();

  // The Lix sync process also needs the server URL. Use upsert in case the
  // local blob already has a stale/no value for this key.
  await lix.db
    .insertInto("key_value")
    .values({ key: "lix_server_url", value: serverUrl })
    .onConflict((oc: any) => oc.doUpdateSet({ value: serverUrl }))
    .execute();

  _currentLixId = lixId;
  return { lixId, serverUrl };
}

/**
 * Join a shared Lix document. Fetches the blob from the server and opens it
 * locally with sync enabled. Returns the opened Lix instance.
 */
export async function joinSharedLix(
  client: ConvexClient,
  lixId: string,
): Promise<{ serverUrl: string }> {
  const meta = await client.query(api.collaboration.getSharedLixMeta, {
    lixId,
  });
  if (!meta) throw new Error("Not a collaborator on this document.");

  const baseUrl =
    (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? "";
  if (!baseUrl) throw new Error("CONVEX_SITE_URL not configured");

  // Fetch the blob from the LSP get-v1 endpoint.
  const resp = await fetch(`${baseUrl}/lsp/get-v1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lix_id: lixId }),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch shared Lix (${resp.status})`);
  }
  const blob = await resp.blob();

  // Open the blob locally. The get-v1 route sets lix_sync to "true" so the
  // sync process will start automatically.
  const lix = await openLixInMemory({
    blob,
    providePlugins: [
      (await import("@lix-js/plugin-json")).plugin as unknown as any,
    ],
  });

  // Set the server URL so Lix knows where to sync.
  const serverUrl = `${baseUrl}/lsp`;
  await lix.db
    .insertInto("key_value")
    .values({ key: "lix_server_url", value: serverUrl })
    .onConflict((oc: any) => oc.doUpdateSet({ value: serverUrl }))
    .execute();

  _currentLixId = lixId;
  return { serverUrl };
}

/* ── Remote → local sync ────────────────────────────────────────── */

import type { Editor } from "@tiptap/core";
import { getDraftBlocks } from "./lix";

let _remoteSyncTimer: ReturnType<typeof setInterval> | null = null;
let _lastPolledHtml: string | null = null;

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

  const poll = async () => {
    try {
      const blocks = await getDraftBlocks(folioId);
      if (blocks.length === 0) return;
      const html = blocks.map((b) => b.html).join("");
      if (html === _lastPolledHtml) return;
      _lastPolledHtml = html;
      // Only update if the editor doesn't already have this content (avoids
      // clobbering cursor position when the change was local & already mirrored).
      if (editor.getHTML() !== html) {
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
  if (_remoteSyncTimer) {
    clearInterval(_remoteSyncTimer);
    _remoteSyncTimer = null;
  }
  _lastPolledHtml = null;
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
