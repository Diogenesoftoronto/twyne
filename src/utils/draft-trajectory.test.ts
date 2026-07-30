import { describe, expect, test } from "bun:test";
import {
  diffParagraphs,
  entryFromDiff,
  paragraphTextFromHtml,
  toParagraphs,
  trajectoryDigest,
  trajectorySummaryLine,
  type TrajectoryEntry,
} from "./draft-trajectory";

const A = "The levy pays for itself in eight years, not the twenty claimed.";
const B = "Ridership projections have been revised twice since the 2019 study.";
const C = "Opponents rely on a cost model that assumes no fare growth at all.";

const doc = (...paras: string[]) => paras.join("\n\n");

describe("paragraphTextFromHtml", () => {
  /**
   * The existing `twyne:content` consumers flatten HTML to a single line,
   * which would make every diff look like one enormous paragraph. Block
   * boundaries have to survive for the trajectory to mean anything.
   */
  test("preserves paragraph boundaries", () => {
    expect(toParagraphs(paragraphTextFromHtml("<p>one</p><p>two</p>"))).toEqual([
      "one",
      "two",
    ]);
  });

  test("treats headings, list items and blockquotes as blocks", () => {
    const html = "<h2>Title</h2><ul><li>a</li><li>b</li></ul><blockquote>q</blockquote>";
    expect(toParagraphs(paragraphTextFromHtml(html))).toEqual([
      "Title",
      "a",
      "b",
      "q",
    ]);
  });

  test("keeps a soft break inside its paragraph", () => {
    expect(
      toParagraphs(paragraphTextFromHtml("<p>one<br>still one</p><p>two</p>")),
    ).toEqual(["one still one", "two"]);
  });

  test("decodes the entities the editor emits", () => {
    expect(paragraphTextFromHtml("<p>a &amp; b &quot;c&quot;&nbsp;d</p>")).toBe(
      'a & b "c" d',
    );
  });

  test("strips inline marks without splitting the paragraph", () => {
    expect(
      toParagraphs(
        paragraphTextFromHtml("<p>a <strong>bold</strong> <em>word</em></p>"),
      ),
    ).toEqual(["a bold word"]);
  });

  test("empty markup yields nothing", () => {
    expect(paragraphTextFromHtml("<p></p>")).toBe("");
  });
});

describe("toParagraphs", () => {
  test("splits on blank lines and normalises internal whitespace", () => {
    expect(toParagraphs("one   line\nstill one\n\ntwo")).toEqual([
      "one line still one",
      "two",
    ]);
  });

  test("drops empty and whitespace-only paragraphs", () => {
    expect(toParagraphs("\n\n  \n\nreal\n\n\n\n")).toEqual(["real"]);
  });

  test("an empty document has no paragraphs", () => {
    expect(toParagraphs("")).toEqual([]);
    expect(toParagraphs("   \n\n  ")).toEqual([]);
  });
});

describe("diffParagraphs", () => {
  test("detects an appended paragraph", () => {
    const d = diffParagraphs(doc(A), doc(A, B));
    expect(d.added).toEqual([B]);
    expect(d.removed).toEqual([]);
    expect(d.netWords).toBeGreaterThan(0);
  });

  test("detects a removed paragraph", () => {
    const d = diffParagraphs(doc(A, B), doc(A));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([B]);
    expect(d.netWords).toBeLessThan(0);
  });

  test("an edit in place reads as one paragraph out, one in", () => {
    const d = diffParagraphs(doc(A, B), doc(A, `${B} It matters.`));
    expect(d.added).toEqual([`${B} It matters.`]);
    expect(d.removed).toEqual([B]);
  });

  /**
   * Moving a paragraph is not new material — the room has already read it, and
   * surfacing a reorder as "two paragraphs added" would send the editors back
   * over text they just commented on.
   */
  test("a pure reorder is not a change", () => {
    const d = diffParagraphs(doc(A, B, C), doc(C, A, B));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.netWords).toBe(0);
  });

  test("no change at all yields an empty diff", () => {
    const d = diffParagraphs(doc(A, B), doc(A, B));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.netWords).toBe(0);
  });

  /**
   * Multiset, not set. A duplicated paragraph is a real thing writers produce
   * (and one the integrity judge cares about), so removing only one copy must
   * register as a removal rather than being swallowed.
   */
  test("tracks duplicate paragraphs by count", () => {
    const added = diffParagraphs(doc(A), doc(A, A));
    expect(added.added).toEqual([A]);

    const removed = diffParagraphs(doc(A, A), doc(A));
    expect(removed.removed).toEqual([A]);
  });

  test("writing into an empty document counts every paragraph as new", () => {
    const d = diffParagraphs("", doc(A, B));
    expect(d.added).toEqual([A, B]);
    expect(d.removed).toEqual([]);
  });

  test("whitespace-only reformatting is not a change", () => {
    const d = diffParagraphs(doc(A, B), doc(A, B.replace(/ /g, "  ")));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe("entryFromDiff", () => {
  test("returns null when nothing changed, so no empty entry is logged", () => {
    expect(entryFromDiff(diffParagraphs(doc(A), doc(A)))).toBeNull();
  });

  test("records counts and truncated excerpts of the new material", () => {
    const long = "word ".repeat(200).trim();
    const entry = entryFromDiff(diffParagraphs(doc(A), doc(A, long)), 1000);
    expect(entry).not.toBeNull();
    expect(entry!.at).toBe(1000);
    expect(entry!.addedCount).toBe(1);
    expect(entry!.removedCount).toBe(0);
    expect(entry!.excerpts[0].length).toBeLessThan(200);
    expect(entry!.excerpts[0].endsWith("…")).toBe(true);
  });

  test("a pure deletion is logged with no excerpts", () => {
    const entry = entryFromDiff(diffParagraphs(doc(A, B), doc(A)));
    expect(entry!.removedCount).toBe(1);
    expect(entry!.excerpts).toEqual([]);
  });
});

describe("trajectoryDigest", () => {
  const now = 10_000_000;
  const entries: TrajectoryEntry[] = [
    {
      at: now - 40 * 60_000,
      netWords: 320,
      addedCount: 2,
      removedCount: 0,
      excerpts: [A],
    },
    {
      at: now - 10 * 60_000,
      netWords: -80,
      addedCount: 0,
      removedCount: 1,
      excerpts: [],
    },
    {
      at: now - 2 * 60_000,
      netWords: 210,
      addedCount: 1,
      removedCount: 0,
      excerpts: [B],
    },
  ];

  test("is empty when there is no history, so callers can concatenate freely", () => {
    expect(trajectoryDigest([], now)).toBe("");
  });

  test("reports net movement, additions and cuts", () => {
    const digest = trajectoryDigest(entries, now);
    expect(digest).toContain("+450 words net");
    expect(digest).toContain("3 paragraphs added");
    expect(digest).toContain("1 cut");
  });

  test("quotes the most recent new material", () => {
    const digest = trajectoryDigest(entries, now);
    expect(digest).toContain(B);
  });

  test("summarises entries beyond the window instead of dropping them", () => {
    const many: TrajectoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      at: now - (20 - i) * 60_000,
      netWords: 10,
      addedCount: 1,
      removedCount: 0,
      excerpts: [`para ${i}`],
    }));
    const digest = trajectoryDigest(many, now, 5);
    expect(digest).toContain("15 earlier revisions");
  });

  test("describes a net deletion without claiming words were added", () => {
    const digest = trajectoryDigest(
      [
        {
          at: now - 60_000,
          netWords: -200,
          addedCount: 0,
          removedCount: 3,
          excerpts: [],
        },
      ],
      now,
    );
    expect(digest).toContain("−200 words net");
    expect(digest).not.toContain("+");
  });
});

describe("trajectorySummaryLine", () => {
  test("is empty with no history", () => {
    expect(trajectorySummaryLine([])).toBe("");
  });

  test("describes the most recent change", () => {
    const line = trajectorySummaryLine([
      {
        at: Date.now() - 4 * 60_000,
        netWords: 300,
        addedCount: 3,
        removedCount: 1,
        excerpts: [A],
      },
    ]);
    expect(line).toContain("3 new paragraphs");
    expect(line).toContain("1 cut");
    expect(line).toContain("4m ago");
  });
});
