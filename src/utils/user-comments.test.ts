import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

/**
 * Writer comments live in the Lix file `/user-comments.json` and survive
 * reloads. The tests stub the Lix layer so the persistence path can be
 * exercised end-to-end without a browser.
 */

// Minimal browser global so the local-first guards (`typeof window`)
// inside user-comments.ts pass and writes actually fire.
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};

const files: { path: string; data: Uint8Array }[] = [];

mock.module("./lix", () => ({
  readFileAsJson: async <T>(path: string): Promise<T | null> => {
    const row = files.find((r) => r.path === path);
    if (!row) return null;
    return JSON.parse(new TextDecoder().decode(row.data)) as T;
  },
  writeFileAsJson: async (path: string, data: unknown) => {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const existing = files.find((r) => r.path === path);
    if (existing) existing.data = encoded;
    else files.push({ path, data: encoded });
  },
}));

const {
  appendUserCommentReply,
  loadUserComments,
  toggleUserCommentResolved,
  upsertUserComment,
  deleteUserComment,
} = await import("./user-comments");

afterEach(() => {
  files.length = 0;
});

afterAll(() => {
  releaseBrowserGlobalsLock();
});

describe("user-comments persistence", () => {
  test("appends a reply to an existing comment", async () => {
    await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "First pass note",
      author: "You",
      resolved: false,
      createdAt: 1,
      updatedAt: 1,
      replies: [],
    });

    const all = await appendUserCommentReply("c-1", {
      id: "r-1",
      author: "You",
      authorKind: "user",
      text: "Reply text",
      createdAt: 2,
    });
    const updated = all.find((x) => x.id === "c-1");
    expect(updated?.replies).toHaveLength(1);
    expect(updated?.replies[0].text).toBe("Reply text");

    // Reload from the same store — replies must survive a re-read.
    const reloaded = await loadUserComments();
    expect(reloaded[0].replies).toHaveLength(1);
    expect(reloaded[0].replies[0].text).toBe("Reply text");
  });

  test("appends a second reply without losing the first", async () => {
    await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "First pass note",
      author: "You",
      resolved: false,
      createdAt: 1,
      updatedAt: 1,
      replies: [],
    });
    await appendUserCommentReply("c-1", {
      id: "r-1",
      author: "You",
      authorKind: "user",
      text: "First reply",
      createdAt: 2,
    });
    const all = await appendUserCommentReply("c-1", {
      id: "r-2",
      author: "You",
      authorKind: "user",
      text: "Second reply",
      createdAt: 3,
    });
    const updated = all.find((x) => x.id === "c-1");
    expect(updated?.replies.map((r) => r.text)).toEqual([
      "First reply",
      "Second reply",
    ]);
  });

  test("creates a placeholder comment when the parent is still syncing", async () => {
    // The editor opens the popover the moment a comment is filed. If the
    // writer fires a reply before the parent comment is in the Lix file,
    // we must not silently drop the reply.
    const reply: import("./user-comments").UserCommentReply = {
      id: "r-1",
      author: "You",
      authorKind: "user",
      text: "I see your point — but…",
      createdAt: Date.now(),
    };
    const all = await appendUserCommentReply("missing-c", reply);
    const created = all.find((x) => x.id === "missing-c");
    expect(created).toBeDefined();
    expect(created?.replies).toHaveLength(1);
    expect(created?.replies[0].text).toBe(reply.text);
  });

  test("preserves the parent comment body when a late reply arrives", async () => {
    await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "Original thread",
      author: "You",
      anchor: "« the long sentence »",
      resolved: false,
      createdAt: 1,
      updatedAt: 1,
      replies: [],
    });

    // Concurrent reply path that the editor may hit before the upsert
    // lands in the Lix file.
    const all = await appendUserCommentReply("c-1", {
      id: "r-1",
      author: "You",
      authorKind: "user",
      text: "Looks right",
      createdAt: 2,
    });
    const updated = all.find((x) => x.id === "c-1");
    expect(updated?.text).toBe("Original thread");
    expect(updated?.anchor).toBe("« the long sentence »");
    expect(updated?.replies).toHaveLength(1);
  });

  test("toggle and delete round-trip through the store", async () => {
    await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "Note",
      author: "You",
      resolved: false,
      createdAt: 1,
      updatedAt: 1,
      replies: [],
    });

    const after = await toggleUserCommentResolved("c-1");
    expect(after.find((x) => x.id === "c-1")?.resolved).toBe(true);

    const afterDelete = await deleteUserComment("c-1");
    expect(afterDelete.find((x) => x.id === "c-1")).toBeUndefined();
  });

  test("upsert preserves replies filed before the parent body lands", async () => {
    // The writer fires a reply before the parent body has been written
    // (placeholder created by appendUserCommentReply), then the editor's
    // persistNewComment runs with the full body. The reply must survive.
    await appendUserCommentReply("c-1", {
      id: "r-1",
      author: "You",
      authorKind: "user",
      text: "Race reply",
      createdAt: 2,
    });
    const merged = await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "Body filled in late",
      author: "You",
      resolved: false,
      createdAt: 1,
      updatedAt: 3,
      replies: [],
    });
    const c = merged.find((x) => x.id === "c-1");
    expect(c?.text).toBe("Body filled in late");
    expect(c?.replies).toHaveLength(1);
    expect(c?.replies[0].text).toBe("Race reply");
  });

  test("upsert replaces the body but keeps the thread when the caller passes no replies", async () => {
    await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "Original",
      author: "You",
      resolved: false,
      createdAt: 1,
      updatedAt: 1,
      replies: [],
    });
    await appendUserCommentReply("c-1", {
      id: "r-1",
      author: "You",
      authorKind: "user",
      text: "Original reply",
      createdAt: 2,
    });
    const merged = await upsertUserComment({
      id: "c-1",
      folioId: "f-1",
      text: "Edited body",
      author: "You",
      resolved: false,
      createdAt: 1,
      updatedAt: 3,
      replies: [],
    });
    const c = merged.find((x) => x.id === "c-1");
    expect(c?.text).toBe("Edited body");
    expect(c?.replies.map((r) => r.text)).toEqual(["Original reply"]);
  });
});
