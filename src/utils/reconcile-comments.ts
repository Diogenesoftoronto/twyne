import type { UserComment, UserCommentReply } from "./user-comments";

/**
 * Reconcile writer-authored comment threads against the marks
 * currently in the document. The mark is the *anchor* of a thread;
 * the thread body lives in `/user-comments.json`. They drift
 * apart in three ways and the reconciliation partitions threads
 * into three buckets so the UI can show a writer what happened.
 *
 *   live      — the mark is in the doc and the body is in the
 *               store. The default state; nothing to do.
 *   ghost     — the body is in the store but no mark references
 *               it (the marked passage was deleted, the mark was
 *               struck off, or the folio was wiped). The thread
 *               is unreachable from the manuscript and needs an
 *               explicit decision: re-anchor, strike, or keep as
 *               a folio-level note.
 *   headless  — the mark is in the doc but the body never made
 *               it to the store (the writer's tab died between
 *               setMark and persistNewComment, the upsert
 *               failed, etc.). Usually transient — the
 *               reconciliation primitive should NOT surface
 *               these aggressively, since the editor's own
 *               retry will land them in the store.
 *
 * Inputs are pre-extracted so the primitive is pure: callers
 * walk the editor doc once and pull out the set of comment
 * ids present in the document; the store is a flat array. Both
 * are cheap to compute. Splitting the work this way keeps the
 * reconciliation testable without a Tiptap editor or a Lix
 * store.
 */
export interface ReconciledComments {
  live: UserComment[];
  ghost: UserComment[];
  headless: string[];
}

export function reconcileCommentAnchors(
  threads: UserComment[],
  markIds: Iterable<string>,
): ReconciledComments {
  const present = new Set<string>();
  for (const id of markIds) present.add(id);

  const live: UserComment[] = [];
  const ghost: UserComment[] = [];
  const threadIds = new Set<string>();
  for (const t of threads) {
    threadIds.add(t.id);
    if (present.has(t.id)) live.push(t);
    else ghost.push(t);
  }

  // Headless: marks in the doc with no body in the store. We
  // don't filter by age here — the caller decides whether to
  // show a "still syncing…" affordance or to wait silently.
  const headless: string[] = [];
  for (const id of present) {
    if (!threadIds.has(id)) headless.push(id);
  }

  return { live, ghost, headless };
}

/**
 * Walk a serialized ProseMirror document and collect every
 * `data-comment-id` it carries. Used by the editor's
 * onUpdate to feed the reconciliation primitive. Lives here
 * (not in user-comments) because it's a DOM/ProseMirror
 * concern, not a thread concern.
 */
export function collectCommentMarkIdsFromHtml(html: string): string[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const seen = new Set<string>();
  const els = doc.querySelectorAll("[data-comment-id]");
  for (const el of Array.from(els)) {
    const id = el.getAttribute("data-comment-id");
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export type { UserComment, UserCommentReply };
