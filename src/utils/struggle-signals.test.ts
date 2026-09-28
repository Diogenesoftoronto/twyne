import { describe, expect, test } from "bun:test";
import {
  commitVersion,
  coolDown,
  emptyActivity,
  hedgeCount,
  readStruggle,
  recordEdit,
  splitSentences,
  STRUGGLE_THRESHOLD,
  type BlockActivity,
} from "./struggle-signals";

/** Record an edit and commit it, as a pause after typing would. */
function pass(activity: BlockActivity, text: string, now: number) {
  return commitVersion(recordEdit(activity, text, now));
}

describe("splitSentences", () => {
  test("keeps offsets that map back into the paragraph", () => {
    const text = "First one here.  Second, longer one! Third?";
    const spans = splitSentences(text);
    expect(spans.map((s) => s.text)).toEqual([
      "First one here.",
      "Second, longer one!",
      "Third?",
    ]);
    for (const s of spans) expect(text.slice(s.from, s.to)).toBe(s.text);
  });

  test("keeps a trailing fragment without terminal punctuation", () => {
    expect(splitSentences("Done. And then").map((s) => s.text)).toEqual([
      "Done.",
      "And then",
    ]);
  });
});

describe("recordEdit", () => {
  test("counts only the changed middle of the paragraph", () => {
    const a = emptyActivity("The cat sat on the mat.", 0);
    const b = recordEdit(a, "The dog sat on the mat.", 1);
    expect(b.deleted).toBe(3);
    expect(b.inserted).toBe(3);
  });

  test("marks growth only past a meaningful amount", () => {
    const a = emptyActivity("Short.", 0);
    expect(recordEdit(a, "Short. A", 10).lastGrowthAt).toBe(0);
    expect(
      recordEdit(a, "Short. A whole new clause here.", 10).lastGrowthAt,
    ).toBe(10);
  });
});

describe("readStruggle", () => {
  const base =
    "The committee met on Tuesday. It decided nothing of consequence. Everyone went home. Nobody minded.";

  test("typing forward is not struggle", () => {
    let a = emptyActivity("", 0);
    let text = "";
    for (const word of base.split(" ")) {
      text = text ? `${text} ${word}` : word;
      a = pass(a, text, 1);
    }
    expect(readStruggle(a, 2).score).toBeLessThan(STRUGGLE_THRESHOLD);
  });

  test("starting new sentences at the end is not splitting or joining", () => {
    let a = emptyActivity("", 0);
    const sentences = base.split(/(?<=\.) /);
    let text = "";
    for (const sentence of sentences) {
      text = text ? `${text} ${sentence}` : sentence;
      a = pass(a, text, 1);
    }
    expect(a.sentenceCountChanges).toBe(0);
  });

  test("rewording one sentence three times points at Sentence Lab", () => {
    let a = emptyActivity(base, 0);
    a = pass(
      a,
      base.replace("decided nothing of consequence", "settled nothing at all"),
      1,
    );
    a = pass(
      a,
      base.replace("decided nothing of consequence", "reached no decision"),
      2,
    );
    a = pass(
      a,
      base.replace("decided nothing of consequence", "adjourned undecided"),
      3,
    );
    const reading = readStruggle(a, 4);
    expect(reading.score).toBeGreaterThanOrEqual(STRUGGLE_THRESHOLD);
    expect(reading.hints[0].kind).toBe("sentence-lab");
    expect(reading.sentenceIndex).toBe(1);
    expect(a.attempts[1]).toContain("It decided nothing of consequence.");
  });

  test("hedging back and forth points at Claim Check", () => {
    const plain =
      "Remote work is better for deep focus than any open-plan office ever built.";
    const hedged =
      "Remote work is perhaps better for deep focus than any open-plan office ever built.";
    let a = emptyActivity(plain, 0);
    a = pass(a, hedged, 1);
    a = pass(a, plain, 2);
    a = pass(a, hedged, 3);
    expect(hedgeCount(hedged)).toBe(1);
    expect(readStruggle(a, 4).hints.map((h) => h.kind)).toContain(
      "claim-check",
    );
  });

  test("splitting and joining sentences points at Rhythm Strip", () => {
    let a = emptyActivity(base, 0);
    a = pass(a, base.replace("Tuesday. It", "Tuesday and it"), 1);
    a = pass(a, base, 2);
    a = pass(
      a,
      base.replace("consequence. Everyone", "consequence, so everyone"),
      3,
    );
    expect(readStruggle(a, 4).hints.map((h) => h.kind)).toContain(
      "rhythm-strip",
    );
  });

  test("a stall at the end after cutting points at Reader Questions", () => {
    const long = `${base} ${base} ${base}`;
    let a = emptyActivity(
      `${long} A paragraph of padding that the writer then cut away entirely.`,
      0,
    );
    a = pass(a, long, 1_000);
    const later = 1_000 + 60_000;
    expect(readStruggle(a, later).hints.map((h) => h.kind)).not.toContain(
      "reader-questions",
    );
    expect(
      readStruggle(a, later, { cursorAtEnd: true }).hints.map((h) => h.kind),
    ).toContain("reader-questions");
  });

  test("a cooled-down paragraph stays quiet", () => {
    let a = emptyActivity(base, 0);
    for (let i = 1; i <= 4; i++)
      a = pass(
        a,
        base.replace("nothing of consequence", `nothing, attempt ${i}`),
        i,
      );
    expect(readStruggle(a, 5).score).toBeGreaterThan(0);
    const quiet = coolDown(a, 5, 1000);
    expect(readStruggle(quiet, 6).score).toBe(0);
    expect(readStruggle(quiet, 1006).score).toBeGreaterThan(0);
  });
});
