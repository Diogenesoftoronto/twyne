import { expect, test } from "bun:test";
import { reconcileCurrentCommentAnchors } from "./comment-reconciliation";
import type { UserComment } from "./user-comments";

const thread = (id: string, folioId = "folio-a"): UserComment => ({
  id,
  folioId,
  text: "An editorial question about this passage.",
  author: "You",
  resolved: false,
  createdAt: 1,
  updatedAt: 1,
  replies: [],
});

function delayedThreads() {
  let finish!: (threads: UserComment[]) => void;
  const pending = new Promise<UserComment[]>((resolve) => {
    finish = resolve;
  });
  return { pending, finish };
}

test("a new anchored comment survives a storage read started before its mark existed", async () => {
  const storage = delayedThreads();
  const marks = new Set<string>();
  const pending = reconcileCurrentCommentAnchors({
    folioId: "folio-a",
    loadThreads: () => storage.pending,
    isCurrent: () => true,
    currentMarkIds: () => marks,
  });
  // The writer files a fresh source invitation while the earlier read is pending.
  marks.add("new-invitation");
  storage.finish([thread("new-invitation")]);
  const result = await pending;
  expect(result?.live.map((item) => item.id)).toEqual(["new-invitation"]);
  expect(result?.ghost).toEqual([]);
});

test("an undo that restores an anchor during the storage read preserves its thread", async () => {
  const storage = delayedThreads();
  let marks: string[] = [];
  const pending = reconcileCurrentCommentAnchors({
    folioId: "folio-a",
    loadThreads: () => storage.pending,
    isCurrent: () => true,
    currentMarkIds: () => marks,
  });
  marks = ["restored"];
  storage.finish([thread("restored")]);
  expect((await pending)?.ghost).toEqual([]);
});

test("a folio or account change during the storage read cancels reconciliation", async () => {
  for (const change of ["folio", "account"] as const) {
    const storage = delayedThreads();
    let folioId = "folio-a";
    let accountId: string | null = "account-a";
    let markerReads = 0;
    const pending = reconcileCurrentCommentAnchors({
      folioId,
      loadThreads: () => storage.pending,
      isCurrent: () => folioId === "folio-a" && accountId === "account-a",
      currentMarkIds: () => {
        markerReads++;
        return [];
      },
    });
    if (change === "folio") folioId = "folio-b";
    else accountId = null;
    storage.finish([thread("earlier-account-comment")]);
    expect(await pending).toBeNull();
    expect(markerReads).toBe(0);
  }
});

test("a genuinely removed anchor is eligible for pruning only in its captured folio", async () => {
  const result = await reconcileCurrentCommentAnchors({
    folioId: "folio-a",
    loadThreads: async () => [
      thread("removed"),
      thread("still-anchored"),
      thread("other-folio", "folio-b"),
    ],
    isCurrent: () => true,
    currentMarkIds: () => ["still-anchored"],
  });
  expect(result?.ghost.map((item) => item.id)).toEqual(["removed"]);
  expect(result?.live.map((item) => item.id)).toEqual(["still-anchored"]);
});
