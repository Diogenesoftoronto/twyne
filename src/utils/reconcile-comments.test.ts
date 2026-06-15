import { describe, expect, test, beforeAll } from "bun:test";
// @ts-expect-error — jsdom ships JS only; no @types/jsdom is installed.
import { JSDOM } from "jsdom";
import {
  collectCommentMarkIdsFromHtml,
  reconcileCommentAnchors,
} from "./reconcile-comments";
import type { UserComment } from "./user-comments";

/**
 * Bun's test runner doesn't ship a global DOMParser. The
 * HTML-walker tests need one, so we install a JSDOM on the
 * `globalThis` once for the whole file.
 */
beforeAll(() => {
  if (typeof DOMParser === "undefined") {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    (globalThis as { DOMParser?: unknown }).DOMParser =
      dom.window.DOMParser;
  }
});

const sampleThread = (id: string): UserComment => ({
  id,
  folioId: "f-1",
  text: "Thread body",
  author: "You",
  resolved: false,
  createdAt: 1,
  updatedAt: 1,
  replies: [],
});

describe("reconcileCommentAnchors", () => {
  test("a thread with a matching mark is live", () => {
    const result = reconcileCommentAnchors(
      [sampleThread("c-1")],
      ["c-1"],
    );
    expect(result.live.map((c) => c.id)).toEqual(["c-1"]);
    expect(result.ghost).toEqual([]);
    expect(result.headless).toEqual([]);
  });

  test("a thread with no matching mark is a ghost", () => {
    // The marked passage was deleted; the thread body survives
    // in `/user-comments.json` and is now unreachable.
    const result = reconcileCommentAnchors(
      [sampleThread("c-1")],
      [],
    );
    expect(result.live).toEqual([]);
    expect(result.ghost.map((c) => c.id)).toEqual(["c-1"]);
    expect(result.headless).toEqual([]);
  });

  test("a mark with no thread body is headless", () => {
    // The mark was set but persistNewComment hasn't landed
    // yet (or failed). Transient — the editor's own retry
    // should resolve it.
    const result = reconcileCommentAnchors(
      [],
      ["c-pending"],
    );
    expect(result.live).toEqual([]);
    expect(result.ghost).toEqual([]);
    expect(result.headless).toEqual(["c-pending"]);
  });

  test("a mixed document partitions correctly", () => {
    const threads = [
      sampleThread("live-1"),
      sampleThread("live-2"),
      sampleThread("ghost-1"),
      sampleThread("ghost-2"),
    ];
    const result = reconcileCommentAnchors(threads, [
      "live-1",
      "live-2",
      "headless-1",
    ]);
    expect(result.live.map((c) => c.id).sort()).toEqual(["live-1", "live-2"]);
    expect(result.ghost.map((c) => c.id).sort()).toEqual([
      "ghost-1",
      "ghost-2",
    ]);
    expect(result.headless.sort()).toEqual(["headless-1"]);
  });

  test("ghost threads preserve their reply threads", () => {
    // A ghost is still real work the writer did — the UI must
    // not lose replies when surfacing the orphan.
    const orphan: UserComment = {
      ...sampleThread("c-1"),
      replies: [
        {
          id: "r-1",
          author: "You",
          authorKind: "user",
          text: "thinking more about this…",
          createdAt: 2,
        },
      ],
    };
    const result = reconcileCommentAnchors([orphan], []);
    expect(result.ghost[0].replies[0].text).toBe("thinking more about this…");
  });

  test("the primitive is pure: it does not mutate the input arrays", () => {
    const threads = [sampleThread("c-1")];
    const marks = ["c-1"];
    const beforeThreads = threads.slice();
    const beforeMarks = marks.slice();
    reconcileCommentAnchors(threads, marks);
    expect(threads).toEqual(beforeThreads);
    expect(marks).toEqual(beforeMarks);
  });

  test("idempotent under repeated calls", () => {
    const threads = [sampleThread("c-1"), sampleThread("c-2")];
    const marks = ["c-1", "c-2"];
    const a = reconcileCommentAnchors(threads, marks);
    const b = reconcileCommentAnchors(threads, marks);
    expect(a).toEqual(b);
  });

  test("accepts any iterable of mark ids, not just arrays", () => {
    const set = new Set(["c-1"]);
    const result = reconcileCommentAnchors([sampleThread("c-1")], set);
    expect(result.live).toHaveLength(1);
  });

  test("a headless mark can be re-anchored by upserting its body", () => {
    // When the writer's tab dies between setMark and
    // persistNewComment, the reconciliation surfaces the
    // headless id. The fix is to upsert the body with the
    // same id; the mark picks it up on the next reconcile.
    const threads = [sampleThread("c-1")];
    const result1 = reconcileCommentAnchors(threads, ["c-1"]);
    expect(result1.headless).toEqual([]);

    // Pretend the thread was deleted out from under us.
    const result2 = reconcileCommentAnchors([], ["c-1"]);
    expect(result2.headless).toEqual(["c-1"]);
  });
});

describe("collectCommentMarkIdsFromHtml", () => {
  test("collects every distinct data-comment-id in the document", () => {
    const ids = collectCommentMarkIdsFromHtml(
      '<p><span data-comment-id="c-1">a</span> and <span data-comment-id="c-2">b</span> and <span data-comment-id="c-1">again</span></p>',
    );
    expect(ids.sort()).toEqual(["c-1", "c-2"]);
  });

  test("returns an empty array when no marks are present", () => {
    expect(collectCommentMarkIdsFromHtml("<p>plain prose</p>")).toEqual([]);
  });

  test("the document may have only the mark and no body (headless state)", () => {
    const ids = collectCommentMarkIdsFromHtml(
      '<p><span data-comment-id="c-pending">pending</span></p>',
    );
    expect(ids).toEqual(["c-pending"]);
  });
});
