import { describe, expect, test } from "bun:test";
import {
  completeSentence,
  emptySentenceLedger,
  mapSentenceLedger,
  reconcileSentenceLedger,
  settleSentenceWording,
  sentenceSimilarity,
  type LedgerSpan,
} from "./sentence-ledger";
const span = (text: string, from = 1, blockFrom = 0): LedgerSpan => ({
  text,
  from,
  to: from + text.length,
  blockFrom,
});
const start = (text: string) =>
  reconcileSentenceLedger(emptySentenceLedger(), [span(text)], 0);

describe("settled sentence wordings", () => {
  test("requires punctuation, spelling proof, and leaving the sentence or five seconds", () => {
    const entry = start("The river carries the town's memory.").entries[0];
    expect(settleSentenceWording(entry, 1200, 5, true).wordings).toHaveLength(
      0,
    );
    expect(settleSentenceWording(entry, 5000, 5, false).wordings).toHaveLength(
      0,
    );
    expect(settleSentenceWording(entry, 5000, 5, true).wordings).toHaveLength(
      1,
    );
    expect(settleSentenceWording(entry, 1200, 100, true).wordings).toHaveLength(
      1,
    );
    expect(completeSentence("The river carr")).toBe(false);
    expect(
      settleSentenceWording(
        { ...entry, text: "The river carr" },
        5000,
        null,
        true,
      ).wordings,
    ).toHaveLength(0);
  });
  test("removes prefixes and collapses near spelling edits", () => {
    let entry = settleSentenceWording(
      start("The river carries.").entries[0],
      5000,
      null,
      true,
    );
    entry = settleSentenceWording(
      { ...entry, text: "The river carries the town's memory." },
      6000,
      null,
      true,
    );
    expect(entry.wordings.map((w) => w.text)).toEqual([
      "The river carries the town's memory.",
    ]);
    const edited = settleSentenceWording(
      { ...entry, text: "The river carried the town's memory." },
      7000,
      null,
      true,
    );
    expect(edited.wordings).toHaveLength(1);
  });
});

describe("sentence identity and lineage", () => {
  test("preserves IDs and checked wordings when a sentence moves across paragraphs", () => {
    let ledger = start("The river carries the town's memory.");
    ledger.entries[0] = settleSentenceWording(
      ledger.entries[0],
      5000,
      null,
      true,
    );
    const id = ledger.entries[0].id;
    ledger = reconcileSentenceLedger(
      ledger,
      [span("The river carries the town's memory.", 80, 79)],
      6000,
    );
    expect(ledger.entries[0]).toMatchObject({
      id,
      lineage: "move",
      retired: false,
    });
    expect(ledger.entries[0].wordings).toHaveLength(1);
    expect(ledger.entries[0].placements).toHaveLength(2);
    // Undo returns the same identity, retaining the explicit placement history.
    ledger = reconcileSentenceLedger(
      ledger,
      [span("The river carries the town's memory.")],
      7000,
    );
    expect(ledger.entries[0].id).toBe(id);
    expect(ledger.entries[0].placements).toHaveLength(3);
  });
  test("a mapped shift from typing before a sentence is not a move", () => {
    let ledger = start("The river carries the town's memory.");
    ledger = mapSentenceLedger(
      ledger,
      (p) => p + 10,
      [{ from: 0, to: 0 }],
      1000,
    );
    ledger = reconcileSentenceLedger(
      ledger,
      [span("The river carries the town's memory.", 11, 10)],
      2000,
    );
    expect(ledger.entries[0].placements).toHaveLength(1);
    expect(ledger.entries[0].lineage).toBe("new");
  });
  test("cut then paste recovers the retired ID by exact text", () => {
    let ledger = start("The river carries the town's memory.");
    const id = ledger.entries[0].id;
    ledger = reconcileSentenceLedger(ledger, [], 1000);
    expect(ledger.entries[0].retired).toBe(true);
    ledger = reconcileSentenceLedger(
      ledger,
      [span("The river carries the town's memory.", 101, 100)],
      2000,
    );
    expect(ledger.entries[0]).toMatchObject({
      id,
      retired: false,
      lineage: "move",
    });
  });
  test("split and join expose parent IDs instead of clearing history", () => {
    const text = "The river carried our memory; the bridge carried our hopes.";
    let ledger = start(text);
    ledger.entries[0] = settleSentenceWording(
      ledger.entries[0],
      5000,
      null,
      true,
    );
    const id = ledger.entries[0].id;
    ledger = reconcileSentenceLedger(
      ledger,
      [
        span("The river carried our memory."),
        span("The bridge carried our hopes.", 31),
      ],
      6000,
    );
    const children = ledger.entries.filter((e) => !e.retired);
    expect(children).toHaveLength(2);
    expect(children.some((e) => e.id === id)).toBe(true);
    expect(children.every((e) => e.lineage === "split")).toBe(true);
    expect(children.find((e) => e.id !== id)?.parentIds).toContain(id);
    ledger = reconcileSentenceLedger(ledger, [span(text)], 7000);
    const joined = ledger.entries.find((e) => !e.retired)!;
    expect(joined.lineage).toBe("join");
    expect(joined.parentIds.length).toBeGreaterThan(0);
    expect(joined.wordings.map((w) => w.text)).toContain(text);
  });
  test("exact reservations prevent a changed sentence from stealing a neighbour ID", () => {
    let ledger = reconcileSentenceLedger(
      emptySentenceLedger(),
      [
        span("The river carried our memory."),
        span("The river carried our hopes.", 35),
      ],
      0,
    );
    const neighbour = ledger.entries[1].id;
    ledger = reconcileSentenceLedger(
      ledger,
      [
        span("The river carries our memory."),
        span("The river carried our hopes.", 35),
      ],
      1000,
    );
    expect(ledger.entries[1].id).toBe(neighbour);
    expect(sentenceSimilarity("A cold river.", "A cold river.")).toBe(1);
  });
});
