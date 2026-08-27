import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const meta = new Map<string, unknown>();

const {
  compareRevisionPassages,
  compareRevisions,
  createRevisionSnapshot,
  loadRevisionHistory,
  createRevisionTask,
  loadRevisionTasks,
  setRevisionTaskStatus,
  __setRevisionStorageForTests,
} = await import("./revision-history");

beforeEach(() => {
  meta.clear();
  __setRevisionStorageForTests({
    load: async <T>(key: string) => (meta.get(key) as T) ?? null,
    save: async (key: string, value: unknown) => {
      meta.set(key, value);
    },
  });
});
afterAll(() => __setRevisionStorageForTests(null));

describe("revision history", () => {
  test("creates folio-scoped checkpoints newest first", async () => {
    await createRevisionSnapshot({
      folioId: "f1",
      html: "<p>First draft</p>",
      label: "Before review",
      now: 1,
    });
    await createRevisionSnapshot({
      folioId: "f1",
      html: "<p>Second draft with evidence</p>",
      source: "feedback",
      now: 2,
    });
    const history = await loadRevisionHistory("f1");
    expect(history.map((entry) => entry.label)).toEqual([
      "Saved revision",
      "Before review",
    ]);
    expect(history[0].wordCount).toBe(4);
  });

  test("coalesces automatic checkpoints and ignores identical content", async () => {
    expect(
      await createRevisionSnapshot({
        folioId: "f1",
        html: "<p>Draft one</p>",
        source: "automatic",
        now: 1,
      }),
    ).not.toBeNull();
    expect(
      await createRevisionSnapshot({
        folioId: "f1",
        html: "<p>Draft two</p>",
        source: "automatic",
        now: 2,
      }),
    ).toBeNull();
    expect(
      await createRevisionSnapshot({
        folioId: "f1",
        html: "<p>Draft one</p>",
        source: "manual",
        now: 3,
      }),
    ).toBeNull();
  });

  test("summarizes before and after without storing manuscript text in metrics", () => {
    expect(
      compareRevisions(
        "<p>A plain opening.</p><p>Needs evidence.</p>",
        "<p>A stronger opening.</p><p>Evidence now cited.</p>",
      ),
    ).toEqual({
      wordsBefore: 5,
      wordsAfter: 6,
      wordsChanged: 5,
      paragraphsBefore: 2,
      paragraphsAfter: 2,
    });
  });

  test("shows rewritten passages without exposing unchanged manuscript text", () => {
    expect(
      compareRevisionPassages(
        "<h1>Opening</h1><p>A plain claim.</p><p>The ending stays.</p>",
        "<h1>Opening</h1><p>A supported claim.</p><p>The ending stays.</p>",
      ),
    ).toEqual([
      {
        before: "A plain claim.",
        after: "A supported claim.",
      },
    ]);
  });

  test("anchors inserted passages so later paragraphs are not marked changed", () => {
    expect(
      compareRevisionPassages(
        "<p>First.</p><p>Third.</p>",
        "<p>First.</p><p>Second &amp; new.</p><p>Third.</p>",
      ),
    ).toEqual([{ before: null, after: "Second & new." }]);
  });

  test("leaves invalid numeric entities intact instead of throwing", () => {
    expect(() =>
      compareRevisionPassages(
        "<p>Before &#99999999;</p>",
        "<p>After &#99999999;</p>",
      ),
    ).not.toThrow();
  });

  test("deduplicates feedback tasks and carries them through completion", async () => {
    const created = await createRevisionTask({
      folioId: "f1",
      title: "Support the central claim",
      source: "feedback",
      sourceId: "note-1",
      now: 1,
    });
    expect(created?.status).toBe("open");
    expect(
      await createRevisionTask({
        folioId: "f1",
        title: "Duplicate",
        sourceId: "note-1",
      }),
    ).toBeNull();
    await setRevisionTaskStatus("f1", created!.id, "done", 2);
    expect(await loadRevisionTasks("f1")).toEqual([
      expect.objectContaining({ status: "done", completedAt: 2 }),
    ]);
  });
});
