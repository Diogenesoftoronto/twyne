import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTE_THRESHOLDS,
  FACT_ADHERENCE_LEVELS,
  FEEDBACK_ADHERENCE_LEVELS,
  bestAttempt,
  buildAdherenceQuestions,
  buildNoteQuestions,
  buildNoteState,
  evaluateFeedbackAdherence,
  readNoteVerdict,
  rewriteInstruction,
  type NoteVerdict,
} from "./note-gate";
import type { ScoreAnswer, SystemOneAnswer } from "./system-one";

/** A Score pinned to one level, which is the common case in these tests. */
const at = (
  level: number,
  confidence = 0.8,
  levels?: readonly string[],
): ScoreAnswer => ({
  type: "score",
  score: level,
  legend: levels
    ? Object.fromEntries(levels.map((desc, i) => [String(i), desc]))
    : {
        "0": "Useless — restates the draft",
        "1": "Vague — gestures at a problem without locating it",
        "2": "Fair — names a real issue but shallowly",
        "3": "Helpful — names a real issue and why it matters",
        "4": "Incisive — names something the writer could not have seen alone",
      },
  probabilities: Object.fromEntries(
    [0, 1, 2, 3, 4].map((i) => [String(i), i === level ? 1 : 0]),
  ),
  confidence,
});

const good: Record<string, SystemOneAnswer> = {
  helpful: at(4),
  actionable: at(4),
  servesGoal: at(3),
};

describe("buildNoteQuestions", () => {
  test("always grades the three quality dimensions and checks the quote", () => {
    const q = buildNoteQuestions({
      hasConstraints: false,
    });
    expect(Object.keys(q).sort()).toEqual([
      "actionable",
      "helpful",
      "misquotesPassage",
      "servesGoal",
    ]);
  });

  test("asks about constraints as a Noul, not a Score", () => {
    // A Score would invite the model to rate *how badly* it violates, which is
    // not a question anyone asked.
    const q = buildNoteQuestions({
      hasConstraints: true,
    });
    expect(q.violatesConstraints.type).toBe("noul");
  });

  test("asks about misquotation as a Noul, not a Score", () => {
    const q = buildNoteQuestions({
      hasConstraints: false,
    });
    expect(q.misquotesPassage.type).toBe("noul");
  });

  test("skips the veto question when the brief declares no constraints", () => {
    const q = buildNoteQuestions({
      hasConstraints: false,
    });
    expect(q.violatesConstraints).toBeUndefined();
  });
});

describe("buildNoteState", () => {
  test("separates the note from the passage it judges", () => {
    const state = buildNoteState({ note: "tighten this", quote: "the line" });
    expect(state.note).toBe("tighten this");
    expect(state.passage).toBe("the line");
  });

  test("carries only the brief fields the writer filled in", () => {
    const state = buildNoteState({
      note: "n",
      quote: "q",
      brief: {
        answers: { audience: "tax lawyers", goal: "", constraints: "no jokes" },
      } as never,
    });
    expect(state.audience).toBe("tax lawyers");
    expect(state.constraints).toBe("no jokes");
    expect(state.goal).toBeUndefined();
  });
});

describe("readNoteVerdict", () => {
  test("passes a strong note", () => {
    const v = readNoteVerdict(good);
    expect(v.pass).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  test("averages the quality dimensions", () => {
    // 10, 10, 7.5 → 9.166…
    expect(readNoteVerdict(good).overall).toBeCloseTo(9.1667, 3);
  });

  test("one weak dimension sinks a note whose mean is fine", () => {
    const v = readNoteVerdict({
      helpful: at(4), // 10
      actionable: at(0), // 0 — the writer cannot act on it
      servesGoal: at(4), // 10
    });
    expect(v.overall).toBeCloseTo(6.667, 2);
    expect(v.overall).toBeGreaterThan(DEFAULT_NOTE_THRESHOLDS.minOverall);
    expect(v.pass).toBe(false);
  });

  test("explains the failure with the level description, not the number", () => {
    const v = readNoteVerdict({ helpful: at(4), actionable: at(1) });
    // "Vague — gestures at a problem…" tells a model what to fix; "2.1" does not.
    expect(v.reasons[0]).toContain("actionable: ");
    expect(v.reasons[0]).toContain("gestures at a problem");
  });

  test("grades on whatever dimensions came back", () => {
    const v = readNoteVerdict({ helpful: at(3) });
    expect(Object.keys(v.dimensions)).toEqual(["helpful"]);
    expect(v.pass).toBe(true);
  });
});

/**
 * The composition rule the writer asked for. Quality dimensions average; the
 * brief's constraints veto. Averaging them would let helpfulness buy off a
 * constraint the writer declared non-negotiable, which is exactly backwards.
 */
describe("the constraint veto", () => {
  test("beats a perfect quality score", () => {
    const v = readNoteVerdict({
      helpful: at(4),
      actionable: at(4),
      servesGoal: at(4),
      violatesConstraints: { type: "noul", noul: 0.92 },
    });
    expect(v.overall).toBe(10);
    expect(v.vetoed).toBe(true);
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toContain("constraint");
  });

  test("does not fire on a coin flip", () => {
    // A Noul at 0.5 means genuinely uncertain. Discarding good advice on a
    // coin flip is worse than showing it and letting the writer judge — they
    // are the one who wrote the constraint.
    const v = readNoteVerdict({
      ...good,
      violatesConstraints: { type: "noul", noul: 0.5 },
    });
    expect(v.vetoed).toBe(false);
    expect(v.pass).toBe(true);
  });

  test("respects a writer who moved the veto threshold", () => {
    const answers = {
      ...good,
      violatesConstraints: { type: "noul" as const, noul: 0.5 },
    };
    const strict = readNoteVerdict(answers, {
      ...DEFAULT_NOTE_THRESHOLDS,
      maxViolationRisk: 0.3,
    });
    expect(strict.vetoed).toBe(true);
  });

  test("cannot fire when the brief declared no constraints", () => {
    expect(readNoteVerdict(good).violationRisk).toBeNull();
    expect(readNoteVerdict(good).vetoed).toBe(false);
  });
});

describe("the misquotation veto", () => {
  test("beats a perfect quality score", () => {
    const v = readNoteVerdict({
      helpful: at(4),
      actionable: at(4),
      servesGoal: at(4),
      misquotesPassage: { type: "noul", noul: 0.9 },
    });
    expect(v.quoteRisk).toBe(0.9);
    expect(v.vetoed).toBe(true);
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toContain("Misquotes");
    expect(v.rewriteKind).toBe("accuracy");
  });

  test("does not fire on a coin flip", () => {
    const v = readNoteVerdict({
      ...good,
      misquotesPassage: { type: "noul", noul: 0.5 },
    });
    expect(v.vetoed).toBe(false);
    expect(v.pass).toBe(true);
  });

  test("constraint beats accuracy in the rewrite routing", () => {
    const v = readNoteVerdict({
      ...good,
      violatesConstraints: { type: "noul", noul: 0.9 },
      misquotesPassage: { type: "noul", noul: 0.9 },
    });
    expect(v.rewriteKind).toBe("constraint");
  });
});

describe("rewriteInstruction", () => {
  test("tells a vetoed note to drop the point rather than soften it", () => {
    const v = readNoteVerdict({
      ...good,
      violatesConstraints: { type: "noul", noul: 0.9 },
    });
    const instruction = rewriteInstruction(v);
    expect(instruction).toContain("stated constraints");
    expect(instruction).toContain("drop it");
  });

  test("tells a vague note where to be specific", () => {
    const v = readNoteVerdict({ helpful: at(1), actionable: at(1) });
    const instruction = rewriteInstruction(v);
    expect(instruction).toContain("specific sentence");
    expect(instruction).toContain("gestures at a problem");
  });

  test("tells a misquoting note to quote exactly", () => {
    const v = readNoteVerdict({
      ...good,
      misquotesPassage: { type: "noul", noul: 0.9 },
    });
    const instruction = rewriteInstruction(v);
    expect(instruction).toContain("exactly as written");
  });
});

describe("bestAttempt", () => {
  const attempt = (
    note: string,
    overall: number,
    vetoed = false,
  ): { note: string; verdict: NoteVerdict } => ({
    note,
    verdict: {
      dimensions: {},
      overall,
      violationRisk: vetoed ? 0.9 : null,
      quoteRisk: null,
      adherence: null,
      breaksAvoidance: null,
      factAdherence: null,
      factViolationRisk: null,
      feedbackAdherence: null,
      preferenceViolationRisk: null,
      vetoed,
      pass: !vetoed && overall >= 5,
      reasons: [],
      rewriteKind: vetoed ? "constraint" : null,
    },
  });

  test("keeps the best, not the last — a rewrite can come back worse", () => {
    const best = bestAttempt([attempt("first", 7), attempt("second", 4)]);
    expect(best?.note).toBe("first");
  });

  test("takes the improvement when the rewrite worked", () => {
    expect(bestAttempt([attempt("first", 3), attempt("second", 8)])?.note).toBe(
      "second",
    );
  });

  test("an un-vetoed attempt beats a vetoed one at any score", () => {
    const best = bestAttempt([
      attempt("breaks a constraint", 10, true),
      attempt("respects it", 5.5),
    ]);
    expect(best?.note).toBe("respects it");
  });

  test("falls back to the least-bad when every attempt was vetoed", () => {
    const best = bestAttempt([
      attempt("worse", 3, true),
      attempt("better", 8, true),
    ]);
    expect(best?.note).toBe("better");
    expect(best?.verdict.vetoed).toBe(true);
  });

  test("returns null rather than inventing a note", () => {
    expect(bestAttempt([])).toBeNull();
  });
});

describe("fact and feedback preference adherence", () => {
  test("buildNoteQuestions includes fact and preference questions when configured", () => {
    const q = buildNoteQuestions({
      hasConstraints: false,
      hasWriterFacts: true,
      hasFeedbackPreferences: true,
    });
    expect(q.violatesWriterFacts.type).toBe("noul");
    expect(q.factAdherence.type).toBe("score");
    expect(q.violatesFeedbackPreferences.type).toBe("noul");
    expect(q.feedbackAdherence.type).toBe("score");
  });

  test("buildNoteState formats writer facts and structured feedback preferences", () => {
    const state = buildNoteState({
      note: "You should reconsider the premise.",
      quote: "My years working in high-energy physics showed me this.",
      writerProfile: {
        displayName: "Ada",
        personalFacts:
          "10 years experience as an experimental particle physicist.\nGrew up in Toronto.",
        feedbackStyle: "direct",
        feedbackNotes: "Question my logic before line edits.",
        primaryGenre: "nonfiction",
        experienceLevel: "published",
        feedbackFocus: ["argument", "evidence"],
        praisePreference: "minimal",
        critiqueTone: "socratic",
        factChecking: "strict",
        feedbackAvoid: "No patronizing praise.",
      },
    });
    expect(state.writerFacts).toContain("experimental particle physicist");
    expect(state.feedbackPreferences).toContain("Feedback pressure: direct");
    expect(state.feedbackPreferences).toContain(
      "Critique delivery tone: socratic",
    );
    expect(state.feedbackPreferences).toContain("Praise preference: minimal");
    expect(state.feedbackPreferences).toContain("Fact adherence mode: strict");
    expect(state.feedbackPreferences).toContain(
      "Priority focus areas: argument, evidence",
    );
    expect(state.feedbackPreferences).toContain(
      "Things to avoid in feedback: No patronizing praise",
    );
  });

  test("vetoes a note that severely violates stated writer facts", () => {
    const answers: Record<string, SystemOneAnswer> = {
      ...good,
      violatesWriterFacts: { type: "noul", noul: 0.95 },
      factAdherence: at(0), // Contradictory
    };
    const v = readNoteVerdict(answers);
    expect(v.vetoed).toBe(true);
    expect(v.pass).toBe(false);
    expect(v.rewriteKind).toBe("facts");
    expect(v.reasons).toContain(
      "Contradicts or misrepresents the writer's stated facts or background context.",
    );
    const instruction = rewriteInstruction(v);
    expect(instruction).toContain(
      "adheres strictly to the writer's stated personal facts",
    );
  });

  test("flags rewrite when feedback preferences are disregarded", () => {
    const answers: Record<string, SystemOneAnswer> = {
      ...good,
      violatesFeedbackPreferences: { type: "noul", noul: 0.85 },
      feedbackAdherence: at(1), // Mismatched
    };
    const v = readNoteVerdict(answers);
    expect(v.pass).toBe(true); // Preference mismatch does not veto completely, but routes a preference rewrite
    expect(v.rewriteKind).toBe("preference");
    expect(
      v.reasons.some(
        (r) => r.includes("feedback style") || r.includes("Disregards"),
      ),
    ).toBe(true);
    const instruction = rewriteInstruction(v);
    expect(instruction).toContain(
      "honours how the writer likes to receive feedback",
    );
  });

  test("buildAdherenceQuestions and evaluateFeedbackAdherence provide standalone verification", () => {
    const questions = buildAdherenceQuestions({
      displayName: "Jane",
      personalFacts: "Writing a biography of Ada Lovelace.",
      feedbackStyle: "direct",
      feedbackNotes: "No patronizing remarks.",
    });
    expect(questions.violatesWriterFacts).toBeDefined();
    expect(questions.factAdherence).toBeDefined();
    expect(questions.violatesFeedbackPreferences).toBeDefined();
    expect(questions.feedbackAdherence).toBeDefined();

    const report = evaluateFeedbackAdherence({
      violatesWriterFacts: { type: "noul", noul: 0.1 },
      factAdherence: at(3, 0.8, FACT_ADHERENCE_LEVELS), // Consistent
      violatesFeedbackPreferences: { type: "noul", noul: 0.05 },
      feedbackAdherence: at(4, 0.8, FEEDBACK_ADHERENCE_LEVELS), // Exemplary
    });
    expect(report.passes).toBe(true);
    expect(report.factAdherence?.level).toContain("Consistent");
    expect(report.feedbackAdherence?.level).toContain("Exemplary");
    expect(report.reasons).toEqual([]);
  });
});
