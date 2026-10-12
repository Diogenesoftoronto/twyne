import { reconcileCommentAnchors } from "./reconcile-comments";
import type { UserComment } from "./user-comments";

/** Storage may finish after a fresh mark is inserted or the workspace changes. */
export async function reconcileCurrentCommentAnchors(input: {
  folioId: string;
  loadThreads: () => Promise<UserComment[]>;
  isCurrent: () => boolean;
  currentMarkIds: () => Iterable<string>;
}) {
  const threads = await input.loadThreads();
  if (!input.isCurrent()) return null;
  return reconcileCommentAnchors(
    threads.filter((thread) => thread.folioId === input.folioId),
    input.currentMarkIds(),
  );
}
