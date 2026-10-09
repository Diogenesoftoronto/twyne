import { describe, expect, test } from "bun:test";
import {
  checkSentenceCandidates,
  localSentenceCandidates,
  sentenceCandidate,
  sentencePlacementChoices,
  sentenceWordDiff,
  wordAlternatives,
} from "./sentence-bench";
import { completeSentence } from "./sentence-ledger";
import type { GrammarIssue } from "./grammar";
const issue = (problem: string): GrammarIssue => ({
  id: problem,
  start: 0,
  end: problem.length,
  problem,
  kind: "Spelling",
  message: `Unknown word: ${problem}`,
  suggestions: [],
});

describe("local sentence alternatives", () => {
  test("offline alternatives are complete, operation-labelled, and never claim verified meaning", () => {
    const original =
      "We made a decision to leave in order to find a very quiet room.";
    const candidates = localSentenceCandidates(original);
    expect(candidates.map((c) => c.text)).toContain(
      "We decided to leave in order to find a very quiet room.",
    );
    expect(candidates.map((c) => c.text)).toContain(
      "We made a decision to leave to find a very quiet room.",
    );
    expect(
      candidates.every(
        (c) =>
          completeSentence(c.text) &&
          c.source === "rule" &&
          c.operation &&
          !c.meaning,
      ),
    ).toBe(true);
    expect(
      candidates.find((c) => c.operation === "Reduce emphasis")?.caution,
    ).toContain("strength");
    expect(localSentenceCandidates("We made a decision to leav")).toEqual([]);
  });
  test("semicolon and trailing time clause transformations retain every clause", () => {
    expect(
      localSentenceCandidates(
        "The tide carried our boats; the wind carried our voices.",
      ).map((c) => c.text),
    ).toContain("The tide carried our boats. The wind carried our voices.");
    expect(
      localSentenceCandidates(
        "The tide carried our boats, after the storm had passed.",
      ).map((c) => c.text),
    ).toContain("After the storm had passed, the tide carried our boats.");
    expect(
      localSentenceCandidates(
        "Mara found the map, after the storm had passed.",
      ).some((c) => c.operation === "Front the time clause"),
    ).toBe(false);
  });
  test("Harper rejects new problems, including duplicate occurrences of an old problem", async () => {
    const original = "We walked to harbour.";
    const candidates = [
      sentenceCandidate(original, "We strolled to harbour.", "rule", "test"),
      sentenceCandidate(original, "We carr to harbour.", "rule", "test"),
      sentenceCandidate(original, "Harbour meets harbour.", "rule", "test"),
    ];
    const lint = async (s: string) =>
      [...s.matchAll(/harbour|Harbour|carr/g)].map((m) =>
        issue(m[0].toLowerCase()),
      );
    const checked = await checkSentenceCandidates(original, candidates, lint);
    expect(checked).toHaveLength(1);
    expect(checked[0].grammar).toBe("checked");
    expect(checked[0].text).toBe("We strolled to harbour.");
  });
  test("diff reconstructs both full wordings including punctuation and Unicode", () => {
    const before = "“Mara,” she said, “we really need that map.”";
    const after = "“Mara,” she replied, “we need the map.”";
    const diff = sentenceWordDiff(before, after);
    expect(
      diff
        .filter((p) => p.kind !== "added")
        .map((p) => p.text)
        .join(""),
    ).toBe(before);
    expect(
      diff
        .filter((p) => p.kind !== "removed")
        .map((p) => p.text)
        .join(""),
    ).toBe(after);
    expect(
      diff.some((p) => p.kind === "removed" && p.text.includes("really")),
    ).toBe(true);
  });
});
describe("word and placement alternatives", () => {
  test("word alternatives replace only the exact selected use and carry authored nuance", () => {
    const sentence = "She looked where he looked.";
    const choices = wordAlternatives(sentence, 4, 10);
    expect(choices.find((c) => c.replacement === "glanced")?.sentence).toBe(
      "She glanced where he looked.",
    );
    expect(choices.every((c) => c.source === "thesaurus" && c.nuance)).toBe(
      true,
    );
    expect(wordAlternatives(sentence, 5, 10)).toEqual([]);
  });
  test("placements show complete context and omit opening a reference without a predecessor", () => {
    const paragraph =
      "The old map remained. This was our only clue. We followed the river.";
    const from = paragraph.indexOf("This"),
      to = from + "This was our only clue.".length;
    const choices = sentencePlacementChoices(paragraph, from, to);
    expect(choices).toHaveLength(1);
    expect(choices[0].paragraph).toBe(
      "The old map remained. We followed the river. This was our only clue.",
    );
    expect(choices[0].source).toBe("rule");
    expect(choices[0].reason).toContain("antecedent");
  });
});
