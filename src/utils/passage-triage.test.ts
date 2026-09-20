import { describe, expect, test } from "bun:test";
import {
  MAX_PASSAGES_PER_BATCH,
  TRIAGE_ENUM,
  TRIAGE_KINDS,
  buildTriageQuestions,
  buildTriageState,
  readTriage,
  selectForAttention,
  splitPassages,
  triageFromLabels,
  type Passage,
} from "./passage-triage";
import type { SystemOneAnswer } from "./system-one";

/**
 * Long enough to clear MIN_PASSAGE_CHARS (80) once trimmed. Padding would not
 * work here: `splitPassages` trims before it measures, which is the whole
 * point of the threshold.
 */
const para = (seed: string): string =>
  `${seed} carries the argument forward far enough to be a real passage` +
  ` rather than a heading or a one-line transition.`;

const passage = (id: string, text = para(id)): Passage => ({
  id,
  text,
  from: 0,
  to: text.length,
});

/** The five phrasings the model picks between, in TRIAGE_KINDS order. */
const OPTIONS = [
  "Nothing — this passage is fine as it stands",
  "Advice — a specific change would clearly improve it",
  "Question — something is ambiguous that only the writer can resolve",
  "Evidence — it makes a claim that wants a source",
  "Cut — it repeats, pads, or does not earn its space",
];

const picked = (option: string, confidence = 0.8): SystemOneAnswer => ({
  type: "choice",
  choice: option,
  probabilities: Object.fromEntries(
    OPTIONS.map((o) => [o, o === option ? confidence : (1 - confidence) / 4]),
  ),
  confidence,
});

const critical = (noul: number): SystemOneAnswer => ({ type: "noul", noul });

/** Both answers for one passage, as the reader expects to find them. */
const answered = (
  id: string,
  option: string,
  criticality: number,
  confidence = 0.8,
): Record<string, SystemOneAnswer> => ({
  [`${id}_kind`]: picked(option, confidence),
  [`${id}_critical`]: critical(criticality),
});

describe("splitPassages", () => {
  test("splits on blank lines, which is how Tiptap serialises blocks", () => {
    const draft = `${para("first")}\n\n${para("second")}`;
    expect(splitPassages(draft).map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  test("drops headings and one-line transitions", () => {
    const draft = `## A heading\n\n${para("body")}\n\nBut then.`;
    const out = splitPassages(draft);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("body");
  });

  test("offsets map back into the original draft", () => {
    const draft = `${para("first")}\n\n${para("second")}`;
    for (const p of splitPassages(draft)) {
      expect(draft.slice(p.from, p.to).trim()).toBe(p.text);
    }
  });

  test("ids stay stable across a run so answers can be matched back", () => {
    const draft = `${para("first")}\n\n${para("second")}`;
    expect(splitPassages(draft)).toEqual(splitPassages(draft));
  });

  test("an empty draft asks nothing", () => {
    expect(splitPassages("")).toEqual([]);
    expect(splitPassages("\n\n   \n\n")).toEqual([]);
  });
});

describe("buildTriageQuestions", () => {
  test("two questions per passage: what it needs, and whether it matters", () => {
    const q = buildTriageQuestions([passage("p0"), passage("p1")]);
    expect(Object.keys(q).sort()).toEqual([
      "p0_critical",
      "p0_kind",
      "p1_critical",
      "p1_kind",
    ]);
    expect(q.p0_kind.type).toBe("choice");
    expect(q.p0_critical.type).toBe("noul");
  });

  test("the kind question offers exactly the five labels", () => {
    const kind = buildTriageQuestions([passage("p0")]).p0_kind;
    if (kind.type !== "choice") throw new Error("expected a Choice question");
    expect(kind.criteria).toEqual(OPTIONS);
    expect(kind.criteria).toHaveLength(TRIAGE_KINDS.length);
  });

  test("questions name the passage, since state carries it by key", () => {
    const q = buildTriageQuestions([passage("p3")]);
    expect(q.p3_kind.instructions).toContain("p3");
    expect(q.p3_critical.instructions).toContain("p3");
  });

  test("a full batch stays inside the 64-question cap", () => {
    const many = Array.from({ length: MAX_PASSAGES_PER_BATCH }, (_, i) =>
      passage(`p${i}`),
    );
    expect(Object.keys(buildTriageQuestions(many)).length).toBeLessThanOrEqual(
      64,
    );
  });
});

describe("buildTriageState", () => {
  test("carries the whole draft alongside each passage", () => {
    const state = buildTriageState([passage("p0"), passage("p1")], "the draft");
    expect(state.draft).toBe("the draft");
    expect(state.p0).toContain("p0");
    expect(state.p1).toContain("p1");
  });

  test("the draft is present even when nothing cleared the threshold", () => {
    expect(buildTriageState([], "the draft")).toEqual({ draft: "the draft" });
  });
});

describe("readTriage", () => {
  test("maps the chosen phrasing back to a kind", () => {
    const p = passage("p0");
    const out = readTriage([p], answered("p0", OPTIONS[3], 0.5));
    expect(out[0].kind).toBe("evidence");
  });

  test("a load-bearing weak spot outranks a broken aside", () => {
    const ps = [passage("aside"), passage("thesis")];
    const out = readTriage(ps, {
      ...answered("aside", OPTIONS[1], 0.05, 0.95),
      ...answered("thesis", OPTIONS[1], 0.95, 0.7),
    });
    expect(out.map((t) => t.passage.id)).toEqual(["thesis", "aside"]);
  });

  test("`nothing` scores zero however confident the model is", () => {
    const out = readTriage([passage("p0")], answered("p0", OPTIONS[0], 0.9, 1));
    expect(out[0].kind).toBe("nothing");
    expect(out[0].priority).toBe(0);
  });

  test("an unscored criticality sorts mid-pack rather than vanishing", () => {
    const out = readTriage([passage("p0")], {
      p0_kind: picked(OPTIONS[1], 0.8),
    });
    expect(out[0].criticality).toBeNull();
    expect(out[0].priority).toBeCloseTo(0.4, 5);
  });

  test("a passage with no kind answer is skipped, not guessed at", () => {
    const out = readTriage([passage("p0"), passage("p1")], {
      ...answered("p1", OPTIONS[2], 0.6),
    });
    expect(out.map((t) => t.passage.id)).toEqual(["p1"]);
  });

  test("an unrecognised option falls back to `nothing`", () => {
    const out = readTriage([passage("p0")], {
      p0_kind: picked("Something the model invented", 0.9),
      p0_critical: critical(0.9),
    });
    expect(out[0].kind).toBe("nothing");
  });
});

describe("selectForAttention", () => {
  const triaged = readTriage(
    [passage("a"), passage("b"), passage("c"), passage("d")],
    {
      ...answered("a", OPTIONS[1], 0.9, 0.9), // 0.81
      ...answered("b", OPTIONS[3], 0.6, 0.8), // 0.48
      ...answered("c", OPTIONS[1], 0.1, 0.5), // 0.05 — below the floor
      ...answered("d", OPTIONS[0], 0.9, 0.9), // nothing
    },
  );

  test("spends the budget on the highest-priority passages", () => {
    expect(selectForAttention(triaged, 2).map((t) => t.passage.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("never returns a passage that needs nothing", () => {
    const all = selectForAttention(triaged, 99);
    expect(all.some((t) => t.kind === "nothing")).toBe(false);
  });

  test("drops passages under the floor even when the budget is spare", () => {
    expect(selectForAttention(triaged, 99).map((t) => t.passage.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("a zero budget spends nothing", () => {
    expect(selectForAttention(triaged, 0)).toEqual([]);
  });

  test("the floor is the caller's to lower", () => {
    expect(selectForAttention(triaged, 99, 0).map((t) => t.passage.id)).toEqual(
      ["a", "b", "c"],
    );
  });
});

describe("triageFromLabels (offline)", () => {
  test("the enum Needle picks from is the same label set", () => {
    expect(TRIAGE_ENUM).toEqual([...TRIAGE_KINDS]);
  });

  test("accepts a bare label, since Needle returns no distribution", () => {
    const out = triageFromLabels([passage("p0")], { p0: "evidence" });
    expect(out[0].kind).toBe("evidence");
  });

  test("reports null rather than inventing a confidence", () => {
    const [only] = triageFromLabels([passage("p0")], { p0: "advice" });
    expect(only.confidence).toBeNull();
    expect(only.criticality).toBeNull();
  });

  test("an unknown or missing label degrades to `nothing`", () => {
    const out = triageFromLabels([passage("p0"), passage("p1")], {
      p0: "not-a-kind",
    });
    expect(out.map((t) => t.kind)).toEqual(["nothing", "nothing"]);
    expect(out.every((t) => t.priority === 0)).toBe(true);
  });

  test("offline still filters `nothing`, even though it cannot rank", () => {
    const out = triageFromLabels([passage("p0"), passage("p1")], {
      p0: "cut",
      p1: "nothing",
    });
    expect(selectForAttention(out, 99).map((t) => t.passage.id)).toEqual([
      "p0",
    ]);
  });
});
