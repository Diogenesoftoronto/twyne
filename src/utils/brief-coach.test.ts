import { describe, expect, test } from "bun:test";
import type { ProjectBrief, ProjectInterviewAnswers } from "../types";
import {
  BRIEF_FIELDS,
  briefIsLoadBearing,
  buildBriefQuestions,
  buildBriefState,
  enforceableConstraints,
  readBriefAssessment,
  splitConstraints,
  type BriefAssessment,
} from "./brief-coach";
import type { ChoiceAnswer, ScoreAnswer, SystemOneAnswer } from "./system-one";

const SUFFICIENCY = [
  "Missing — there is nothing usable here",
  "Vague — this could describe almost any piece",
  "Partial — a direction, but the key decision is still open",
  "Specific — a writer could act on this without asking a follow-up",
  "Sharp — it rules things out, not just in",
];

const field = (level: number, confidence = 0.8): ScoreAnswer => ({
  type: "score",
  score: level,
  legend: Object.fromEntries(SUFFICIENCY.map((l, i) => [String(i), l])),
  probabilities: Object.fromEntries(
    [0, 1, 2, 3, 4].map((i) => [String(i), i === level ? 1 : 0]),
  ),
  confidence,
});

const HARD =
  "Hard — imposed from outside (legal, contractual, platform, factual) and not the writer's to relax";
const EDITORIAL =
  "Editorial — the writer's own firm decision about what this piece is";
const PREFERENCE =
  "Preference — the writer would rather, but the piece still works if it is broken";
const UNCHECKABLE =
  "Uncheckable — no one could look at a draft and say whether it complies";

const kind = (choice: string, confidence = 0.8): ChoiceAnswer => ({
  type: "choice",
  choice,
  probabilities: { [choice]: confidence },
  confidence,
});

const brief = (answers: Partial<ProjectInterviewAnswers>): ProjectBrief => ({
  answers: {
    workingTitle: "",
    format: "",
    audience: "",
    goal: "",
    tone: "",
    constraints: "",
    successSignal: "",
    ...answers,
  },
  attachments: [],
  completedAt: 0,
  updatedAt: 0,
});

describe("splitConstraints", () => {
  test("one per line, which is how writers type them", () => {
    expect(splitConstraints("No second person\nUnder 1200 words")).toEqual([
      "No second person",
      "Under 1200 words",
    ]);
  });

  test("handles bullets and semicolons", () => {
    expect(
      splitConstraints("- No jokes\n• Cite every claim; British spelling"),
    ).toEqual(["No jokes", "Cite every claim", "British spelling"]);
  });

  test("drops fragments that cannot be a constraint", () => {
    expect(splitConstraints("No jokes\n\n-\nok")).toEqual(["No jokes"]);
  });

  test("caps the list rather than sending 60 questions", () => {
    const many = Array.from({ length: 30 }, (_, i) => `rule ${i}`).join("\n");
    expect(splitConstraints(many).length).toBe(12);
  });

  test("empty means empty", () => {
    expect(splitConstraints("")).toEqual([]);
  });
});

describe("buildBriefQuestions", () => {
  test("only grades fields the writer answered", () => {
    const q = buildBriefQuestions(brief({ audience: "tax lawyers" }));
    expect(q.field_audience).toBeDefined();
    expect(q.field_goal).toBeUndefined();
  });

  test("always asks the two whole-brief questions", () => {
    // Not the mean of the fields: a brief can have seven adequate answers and
    // still not say what the piece is.
    const q = buildBriefQuestions(brief({}));
    expect(q.sufficient.type).toBe("noul");
    expect(q.contradictory.type).toBe("noul");
  });

  test("interrogates each constraint separately", () => {
    const q = buildBriefQuestions(
      brief({ constraints: "No second person\nUnder 1200 words" }),
    );
    expect(q.constraint_0.type).toBe("choice");
    expect(q.constraint_1.type).toBe("choice");
    expect(q.constraint_2).toBeUndefined();
  });

  test("quotes the constraint back so the answer is about that one", () => {
    const q = buildBriefQuestions(brief({ constraints: "No second person" }));
    expect(q.constraint_0.instructions).toContain("No second person");
  });

  test("stays inside the batch cap on a maximal brief", () => {
    const full = Object.fromEntries(
      BRIEF_FIELDS.map((f) => [f, "something"]),
    ) as unknown as ProjectInterviewAnswers;
    const q = buildBriefQuestions(
      brief({
        ...full,
        constraints: Array.from({ length: 30 }, (_, i) => `rule ${i}`).join(
          "\n",
        ),
      }),
    );
    expect(Object.keys(q).length).toBeLessThanOrEqual(64);
  });
});

describe("buildBriefState", () => {
  test("omits fields the writer left blank", () => {
    const state = buildBriefState(brief({ goal: "persuade" }));
    expect(state).toEqual({ goal: "persuade" });
  });

  test("counts attachments as information the brief carries", () => {
    // A thin goal backed by three annotated sources is not a thin goal alone.
    const b = brief({ goal: "persuade" });
    b.attachments = [
      {
        id: "a",
        kind: "link",
        title: "The 2019 ruling",
        why: "the case everything turns on",
        addedAt: 0,
      },
    ];
    expect(buildBriefState(b).attachments).toContain("The 2019 ruling");
  });
});

describe("readBriefAssessment", () => {
  const answers = (
    extra: Record<string, SystemOneAnswer> = {},
  ): Record<string, SystemOneAnswer> => ({
    field_audience: field(4),
    field_goal: field(3),
    field_successSignal: field(0),
    sufficient: { type: "noul", noul: 0.7 },
    contradictory: { type: "noul", noul: 0.1 },
    ...extra,
  });

  test("rescales sufficiency onto 0-10", () => {
    const a = readBriefAssessment(brief({}), answers());
    const byField = Object.fromEntries(a.fields.map((f) => [f.field, f]));
    expect(byField.audience.score).toBe(10);
    expect(byField.successSignal.score).toBe(0);
  });

  test("hands back the level as the explanation, not a grade", () => {
    const a = readBriefAssessment(brief({}), answers());
    const weak = a.fields.find((f) => f.field === "successSignal");
    expect(weak?.diagnosis).toContain("nothing usable here");
  });

  test("orders the prompts weakest first", () => {
    const a = readBriefAssessment(brief({}), answers({ field_tone: field(1) }));
    expect(a.weakest.map((f) => f.field)).toEqual(["successSignal", "tone"]);
  });

  test("a strong field is not prompted about", () => {
    const a = readBriefAssessment(brief({}), answers());
    expect(a.weakest.map((f) => f.field)).not.toContain("audience");
  });

  test("carries the whole-brief probabilities through", () => {
    const a = readBriefAssessment(brief({}), answers());
    expect(a.sufficiency).toBe(0.7);
    expect(a.contradiction).toBe(0.1);
  });

  test("reports null rather than zero when a question did not come back", () => {
    const a = readBriefAssessment(brief({}), { field_goal: field(3) });
    expect(a.sufficiency).toBeNull();
    expect(a.contradiction).toBeNull();
  });
});

/**
 * "Is this a real non-negotiable?" — the question the writer asked for. It
 * matters mechanically: the note gate vetoes on these, so a preference recorded
 * as a constraint silently suppresses good advice, and an uncheckable one makes
 * the veto fire at random.
 */
describe("constraint classification", () => {
  const classified = (choice: string): BriefAssessment =>
    readBriefAssessment(brief({ constraints: "No second person" }), {
      constraint_0: kind(choice),
    });

  test("a hard constraint is enforceable and says so plainly", () => {
    const c = classified(HARD).constraints[0];
    expect(c.kind).toBe("hard");
    expect(c.enforceable).toBe(true);
    expect(c.hint).toContain("real non-negotiable");
  });

  test("an editorial constraint is enforced but relaxable", () => {
    const c = classified(EDITORIAL).constraints[0];
    expect(c.enforceable).toBe(true);
    expect(c.hint).toContain("relax it");
  });

  test("a preference is not enforced, and the writer is told why", () => {
    const c = classified(PREFERENCE).constraints[0];
    expect(c.enforceable).toBe(false);
    expect(c.hint).toContain("suppress advice");
  });

  test("an uncheckable constraint is not enforced either", () => {
    const c = classified(UNCHECKABLE).constraints[0];
    expect(c.enforceable).toBe(false);
    expect(c.hint).toContain("observable");
  });

  test("keeps the writer's own wording, not the model's label", () => {
    expect(classified(HARD).constraints[0].text).toBe("No second person");
  });

  test("enforceableConstraints is what the note gate may veto on", () => {
    const a = readBriefAssessment(
      brief({ constraints: "Cite every claim\nIdeally warm\nMake it sing" }),
      {
        constraint_0: kind(HARD),
        constraint_1: kind(PREFERENCE),
        constraint_2: kind(UNCHECKABLE),
      },
    );
    expect(enforceableConstraints(a)).toEqual(["Cite every claim"]);
  });
});

describe("briefIsLoadBearing", () => {
  const assess = (answers: Record<string, SystemOneAnswer>): BriefAssessment =>
    readBriefAssessment(brief({}), answers);

  const solid = {
    field_audience: field(4),
    field_goal: field(4),
    field_successSignal: field(3),
  };

  test("true when the load-bearing fields are specific", () => {
    expect(
      briefIsLoadBearing(
        assess({ ...solid, sufficient: { type: "noul", noul: 0.8 } }),
      ),
    ).toBe(true);
  });

  test("false when one load-bearing field is vague", () => {
    // targetFit and the veto would then be measuring the brief's vagueness
    // rather than the draft's quality.
    expect(briefIsLoadBearing(assess({ ...solid, field_goal: field(1) }))).toBe(
      false,
    );
  });

  test("false when a stranger could not write the piece from it", () => {
    expect(
      briefIsLoadBearing(
        assess({ ...solid, sufficient: { type: "noul", noul: 0.2 } }),
      ),
    ).toBe(false);
  });

  test("false when nothing load-bearing was graded at all", () => {
    expect(briefIsLoadBearing(assess({ field_tone: field(4) }))).toBe(false);
  });
});
