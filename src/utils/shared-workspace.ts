import type { ConvexClient } from "convex/browser";
import { joinSharedLix } from "./collaboration";
import { saveFolioContentToIdb } from "./idb";
import { syncDraftToLix } from "./lix";

interface SharedWorkspace {
  activeFolioId: string | null;
  folioKey: number;
  editorSeed: string;
  sharedLixId: string | null;
  sharedRole: "owner" | "editor" | "commenter" | null;
}

/** Open first, then publish a complete workspace in one synchronous step. */
export async function openOwnedSharedWorkspace(options: {
  client: ConvexClient;
  workspace: SharedWorkspace;
  folioId: string;
  lixId: string;
  getLiveDraft: () => string;
  useLiveDraft: boolean;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const { client, workspace, folioId, lixId, getLiveDraft } = options;
  const folioKey = workspace.folioKey;
  const isCurrent = () =>
    options.isCurrent() &&
    workspace.activeFolioId === folioId &&
    workspace.folioKey === folioKey;
  if (!isCurrent()) return false;
  const initialDraft = getLiveDraft();
  const joined = await joinSharedLix(client, lixId, { isCurrent });
  if (!joined || !isCurrent() || joined.folioId !== folioId) return false;

  let liveDraft = getLiveDraft();
  let seed = joined.html;
  if (
    !joined.reviewedLocal &&
    (options.useLiveDraft || liveDraft !== initialDraft)
  ) {
    // Typing may continue during the request and persistence. Mirror the last
    // live snapshot before remounting; no await separates that read and commit.
    do {
      seed = liveDraft;
      await syncDraftToLix(folioId, seed);
      if (!isCurrent()) return false;
      liveDraft = getLiveDraft();
    } while (liveDraft !== seed);
  }
  workspace.editorSeed = seed;
  workspace.sharedLixId = lixId;
  workspace.sharedRole = joined.role;
  return true;
}

/** Changing the editor key must carry its live manuscript into the new mount. */
export async function stopOwnedSharedWorkspace(
  workspace: SharedWorkspace,
  folioId: string,
  getLiveDraft: () => string,
): Promise<void> {
  if (workspace.activeFolioId !== folioId || workspace.sharedRole !== "owner")
    return;
  const html = getLiveDraft();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("twyne:typst-applying", { detail: { folioId } }),
    );
  }
  workspace.editorSeed = html;
  workspace.sharedLixId = null;
  workspace.sharedRole = null;
  await saveFolioContentToIdb(folioId, html);
}
