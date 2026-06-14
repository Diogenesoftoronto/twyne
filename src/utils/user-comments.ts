/**
 * Writer-authored inline comments — local persistence. The CommentMark
 * in the manuscript holds the id; the body, replies, and resolve state
 * live in Lix at `/user-comments.json`. The same shape gets pushed to
 * Convex via `convex-sync.ts:pushLocalSnapshot`, so the cross-device
 * sync is automatic.
 *
 * The shape is deliberately flat — comments and replies are denormalised
 * so the editor can render without a join.
 *
 * This is the single source of truth for "the room's comments on the
 * manuscript" — the inline CommentMark popover and the right-rail
 * Marginalia panel both read and write here. The legacy `/comments.json`
 * shape is migrated on first load.
 */

import { readFileAsJson, writeFileAsJson } from "./lix";

export type UserCommentAuthor = "user" | "persona";

export interface UserCommentReply {
  id: string;
  author: string;
  /** user = the writer; persona = an editor answering the thread. */
  authorKind: UserCommentAuthor;
  /** Set when authorKind === "persona". */
  personaId?: string;
  /** Color swatch to render the reply in (mirrors the persona's accent). */
  color?: string;
  text: string;
  createdAt: number;
}

export interface UserComment {
  id: string;
  folioId: string;
  text: string;
  author: string;
  /** The passage the comment was pinned to (for scroll-to + display). */
  anchor?: string;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
  replies: UserCommentReply[];
}

const COMMENTS_PATH = "/user-comments.json";
const LEGACY_COMMENTS_PATH = "/comments.json";

export async function loadUserComments(): Promise<UserComment[]> {
  if (typeof window === "undefined") return [];
  try {
    const data = await readFileAsJson<UserComment[]>(COMMENTS_PATH);
    if (data && data.length > 0) return data;
  } catch {
    // fall through to migration
  }
  // One-time migration from the legacy `/comments.json` panel model into
  // the unified UserComment store. New comments are anchored by selection;
  // legacy ones had no anchor, so we keep `selectedText` as the anchor.
  try {
    const legacy = await readFileAsJson<LegacyComment[]>(LEGACY_COMMENTS_PATH);
    if (Array.isArray(legacy) && legacy.length > 0) {
      const migrated: UserComment[] = legacy.map((c) => ({
        id: c.id,
        folioId: "", // legacy comments had no folio scope
        text: c.text,
        author: c.author,
        anchor: c.selectedText || undefined,
        resolved: c.resolved,
        createdAt: c.timestamp,
        updatedAt: c.timestamp,
        replies: (c.replies ?? []).map((r) => ({
          id: r.id,
          author: r.author,
          authorKind: "user",
          text: r.text,
          createdAt: r.timestamp,
        })),
      }));
      await writeFileAsJson(COMMENTS_PATH, migrated);
      // Wipe the legacy path so we don't re-migrate next time.
      try {
        await writeFileAsJson(LEGACY_COMMENTS_PATH, []);
      } catch {
        // best-effort
      }
      return migrated;
    }
  } catch {
    // no legacy file
  }
  return [];
}

export async function saveUserComments(comments: UserComment[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await writeFileAsJson(COMMENTS_PATH, comments);
  } catch {
    // lix unavailable
  }
}

export async function upsertUserComment(
  c: UserComment,
): Promise<UserComment[]> {
  const all = await loadUserComments();
  const idx = all.findIndex((x) => x.id === c.id);
  if (idx >= 0) {
    all[idx] = c;
  } else {
    all.push(c);
  }
  await saveUserComments(all);
  return all;
}

export async function appendUserCommentReply(
  commentId: string,
  reply: UserCommentReply,
): Promise<UserComment[]> {
  const all = await loadUserComments();
  const idx = all.findIndex((x) => x.id === commentId);
  if (idx < 0) return all;
  all[idx] = {
    ...all[idx],
    replies: [...all[idx].replies, reply],
    updatedAt: Date.now(),
  };
  await saveUserComments(all);
  return all;
}

export async function toggleUserCommentResolved(
  commentId: string,
): Promise<UserComment[]> {
  const all = await loadUserComments();
  const idx = all.findIndex((x) => x.id === commentId);
  if (idx < 0) return all;
  all[idx] = {
    ...all[idx],
    resolved: !all[idx].resolved,
    updatedAt: Date.now(),
  };
  await saveUserComments(all);
  return all;
}

export async function deleteUserComment(
  commentId: string,
): Promise<UserComment[]> {
  const all = await loadUserComments();
  const next = all.filter((x) => x.id !== commentId);
  await saveUserComments(next);
  return next;
}

/* ── Legacy shape, used only for the one-time migration ───────── */

interface LegacyCommentReply {
  id: string;
  text: string;
  author: string;
  timestamp: number;
}

interface LegacyComment {
  id: string;
  text: string;
  selectedText: string;
  from: number;
  to: number;
  author: string;
  timestamp: number;
  resolved: boolean;
  replies: LegacyCommentReply[];
}
